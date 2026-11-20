import {
  findSeat,
  makeTestTickets,
  seatKey,
  seatProblem,
  seatsOf,
  uid,
  type FriendSeat,
  type GuestTicket,
  type PlanMeta,
  type SeatBlock,
  type SeatChanges,
  type SeatRef,
  type SeatRequest,
  type SeatRequestWant,
  type TicketInput,
} from "@layovr/shared";
import type { Ctx, Scope } from "../context";
import type { Queryable, Row } from "../db/client";
import { bad, conflict, notFound } from "../lib/errors";
import { notify } from "../lib/events";

/**
 * Seated events: tickets (imported from the organiser's ticketing system),
 * check-in, friend groups and seat change requests. Seat blocks live in the
 * venue plan; a ticket names its seat as block + row + seat number.
 *
 * Guests reach their ticket by its unguessable id (saved on their phone after
 * looking it up by ticket number or barcode), the same way buyers reach orders.
 */

const iso = (v: unknown) => new Date(v as string).toISOString();
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "Guest";
const refOf = (t: Row): SeatRef => ({ block: t.block, row: t.row_label, seat: t.seat_number });

export async function blocksFor(q: Queryable, venueId: string): Promise<{ venue: Row; blocks: SeatBlock[]; markers: string[] }> {
  const [venue] = await q.query("select * from venues where id = $1", [venueId]);
  if (!venue) throw notFound("Event not found");
  const meta = (venue.plan ?? null) as PlanMeta | null;
  return { venue, blocks: meta?.seating ?? [], markers: (meta?.markers ?? []).map((m) => m.label) };
}

/* ------------------------------------------------------------------ import */

export type TicketImportResult = {
  ok: boolean;
  applied: boolean;
  errors: string[];
  warnings: string[];
  total: number;
  added: number;
  updated: number;
  removed: number;
};

/**
 * Checks tickets against the seating plan and, unless dryRun, saves them.
 * Tickets are matched by ticket number, so re-importing updates seats in place.
 * With `replace`, tickets missing from the file are removed.
 */
export async function importTickets(
  ctx: Ctx,
  venueId: string,
  tickets: TicketInput[],
  opts: { dryRun?: boolean; replace?: boolean } = {},
): Promise<TicketImportResult> {
  const { blocks, markers } = await blocksFor(ctx.db, venueId);
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (m: string) => {
    if (errors.length < 30) errors.push(m);
  };
  if (!blocks.length) err("This event has no seat blocks yet. Add them in the Seating tab (or the plan's \"seating\" list) first.");
  if (!tickets.length) err("No tickets in the file");

  const numbers = new Map<string, number>();
  const seats = new Map<string, string>();
  const barcodes = new Set<string>();
  for (const [i, t] of tickets.entries()) {
    const line = `Ticket ${t.number}`;
    if (numbers.has(t.number)) err(`${line} appears twice`);
    numbers.set(t.number, i);
    if (t.barcode) {
      if (barcodes.has(t.barcode)) err(`${line}: barcode ${t.barcode} is used twice`);
      barcodes.add(t.barcode);
    }
    const problem = blocks.length ? seatProblem(blocks, t.block, t.row, t.seat) : null;
    if (problem) err(`${line}: ${problem}`);
    const key = seatKey(t.block, t.row, t.seat);
    const other = seats.get(key);
    if (other) err(`${line} and ${other} both have ${t.block} ${t.row}${t.seat}`);
    seats.set(key, t.number);
    if (t.gate && !markers.includes(t.gate)) warnings.push(`${line}: gate "${t.gate}" isn't a marker on the plan, so directions start from the venue`);
  }

  // Seats held by tickets that aren't in this file (and stay, unless replacing).
  const existing = await ctx.db.query("select ticket_number, block, row_label, seat_number from tickets where venue_id = $1", [venueId]);
  const existingNumbers = new Set(existing.map((r) => r.ticket_number as string));
  if (!opts.replace) {
    for (const r of existing) {
      if (numbers.has(r.ticket_number)) continue;
      const holder = seats.get(seatKey(r.block, r.row_label, r.seat_number));
      if (holder) err(`Ticket ${holder}: ${r.block} ${r.row_label}${r.seat_number} already belongs to ticket ${r.ticket_number}`);
    }
  }
  const added = tickets.filter((t) => !existingNumbers.has(t.number)).length;
  const removed = opts.replace ? existing.filter((r) => !numbers.has(r.ticket_number)).length : 0;
  const result: TicketImportResult = {
    ok: errors.length === 0,
    applied: false,
    errors,
    warnings: warnings.slice(0, 20),
    total: tickets.length,
    added,
    updated: tickets.length - added,
    removed,
  };
  if (!result.ok || opts.dryRun) return result;

  await ctx.db.tx(async (q) => {
    if (opts.replace) {
      await q.query("delete from tickets where venue_id = $1 and not (ticket_number = any($2))", [venueId, [...numbers.keys()]]);
    }
    for (const t of tickets) {
      await q.query(
        `insert into tickets (id, venue_id, ticket_number, barcode, holder_name, tier, block, row_label, seat_number, checked_in_at, gate)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, case when $10 then now() end, $11)
         on conflict on constraint tickets_number_key do update set
           -- Columns the file leaves out keep what we had.
           barcode = coalesce(excluded.barcode, tickets.barcode),
           holder_name = coalesce(nullif(excluded.holder_name, ''), tickets.holder_name),
           tier = coalesce(excluded.tier, tickets.tier),
           block = excluded.block, row_label = excluded.row_label, seat_number = excluded.seat_number,
           checked_in_at = coalesce(tickets.checked_in_at, excluded.checked_in_at),
           gate = coalesce(excluded.gate, tickets.gate), updated_at = now()`,
        [
          uid("tkt", 16), venueId, t.number, t.barcode ?? null, t.name ?? "", t.tier ?? null,
          t.block.toUpperCase(), t.row.toUpperCase(), t.seat, Boolean(t.checkedIn), t.gate ?? null,
        ],
      );
    }
  });
  notify({ venueId });
  return { ...result, applied: true };
}

/** Made-up tickets for the free seats, so organisers can try seat guidance before their real import. */
export async function generateTestTickets(ctx: Ctx, venueId: string, share = 0.6): Promise<TicketImportResult> {
  const { venue, blocks, markers } = await blocksFor(ctx.db, venueId);
  if (!blocks.length) throw bad("Add seat blocks first, then generate test tickets");
  const rows = await ctx.db.query("select ticket_number, block, row_label, seat_number from tickets where venue_id = $1", [venueId]);
  const taken = new Set(rows.map((r) => seatKey(r.block, r.row_label, r.seat_number)));
  const used = new Set(rows.map((r) => r.ticket_number as string));
  const gates = markers.filter((m) => /entrance|gate/i.test(m));
  const fresh = makeTestTickets(blocks, { prefix: `${venue.code}-TEST`, share, gates })
    .filter((t) => !taken.has(seatKey(t.block, t.row, t.seat)))
    .map((t, i) => ({ ...t, number: `${venue.code}-TEST-${100000 + rows.length + i + 1}`, barcode: `${venue.code}-TEST-${100000 + rows.length + i + 1}` }))
    .filter((t) => !used.has(t.number));
  if (!fresh.length) throw bad("Every seat already has a ticket");
  return importTickets(ctx, venueId, fresh);
}

/* ------------------------------------------------------------------ organiser views */

export type TicketRow = {
  id: string;
  number: string;
  name: string;
  tier: string | null;
  seat: SeatRef;
  checkedInAt: string | null;
  gate: string | null;
  inGroup: boolean;
};

export async function listTickets(
  ctx: Ctx,
  venueId: string,
  search = "",
): Promise<{ total: number; checkedIn: number; seats: number; tickets: TicketRow[] }> {
  const { blocks } = await blocksFor(ctx.db, venueId);
  const [counts] = await ctx.db.query(
    "select count(*)::int as total, count(checked_in_at)::int as checked_in from tickets where venue_id = $1",
    [venueId],
  );
  const q = `%${search.trim().toLowerCase()}%`;
  const rows = await ctx.db.query(
    `select * from tickets where venue_id = $1
       and ($2 = '%%' or lower(ticket_number) like $2 or lower(holder_name) like $2
            or lower(block || ' ' || row_label || seat_number) like $2)
     order by block, row_label, seat_number limit 100`,
    [venueId, q],
  );
  return {
    total: counts?.total ?? 0,
    checkedIn: counts?.checked_in ?? 0,
    seats: blocks.reduce((n, b) => n + seatsOf(b).length, 0),
    tickets: rows.map((t) => ({
      id: t.id,
      number: t.ticket_number,
      name: t.holder_name,
      tier: t.tier,
      seat: refOf(t),
      checkedInAt: t.checked_in_at ? iso(t.checked_in_at) : null,
      gate: t.gate,
      inGroup: Boolean(t.group_id),
    })),
  };
}

/** The organiser's ticketing system (or a gate scanner) reports a check-in. */
export async function checkIn(ctx: Ctx, venueId: string, input: { ticket: string; gate?: string | undefined }) {
  const value = input.ticket.trim();
  const [t] = await ctx.db.query(
    `update tickets set checked_in_at = coalesce(checked_in_at, now()), gate = coalesce($3, gate), updated_at = now()
     where venue_id = $1 and (ticket_number = $2 or barcode = $2) returning *`,
    [venueId, value, input.gate ?? null],
  );
  if (!t) throw notFound("No ticket with that number or barcode at this event");
  notify({ venueId });
  return { ticketNumber: t.ticket_number, seat: refOf(t), checkedInAt: iso(t.checked_in_at), gate: t.gate };
}

/* ------------------------------------------------------------------ guests */

/** Finds a ticket by its number or barcode; returns the id the guest's phone keeps. */
export async function findTicket(ctx: Ctx, input: { ticket: string; event?: string | undefined }) {
  const value = input.ticket.trim();
  const rows = await ctx.db.query(
    `select t.id, t.venue_id, v.code from tickets t join venues v on v.id = t.venue_id
     where v.status = 'live' and (upper(t.ticket_number) = upper($1) or t.barcode = $1)
       and ($2::text is null or v.code = $2)`,
    [value, input.event?.trim().toUpperCase() || null],
  );
  if (!rows.length) throw notFound("We couldn't find that ticket. Check the number on your ticket, or ask an usher.");
  if (rows.length > 1) throw conflict("That ticket number is used at more than one event. Choose your event and try again.");
  return { ticketId: rows[0]!.id as string, venueId: rows[0]!.venue_id as string };
}

async function ticketById(q: Queryable, ticketId: string): Promise<Row> {
  const [t] = await q.query("select * from tickets where id = $1", [ticketId]);
  if (!t) throw notFound("Ticket not found");
  return t;
}

const toRequest = (r: Row): SeatRequest => ({
  id: r.id,
  venueId: r.venue_id,
  ticketId: r.ticket_id,
  want: r.want,
  ...(r.want_block ? { wantBlock: r.want_block } : {}),
  ...(r.want_row ? { wantRow: r.want_row } : {}),
  ...(r.want_seat === null ? {} : { wantSeat: r.want_seat }),
  ...(r.note ? { note: r.note } : {}),
  status: r.status,
  from: r.from_seat,
  ...(r.to_seat ? { to: r.to_seat } : {}),
  ...(r.decision_note ? { decisionNote: r.decision_note } : {}),
  createdAt: iso(r.created_at),
  ...(r.decided_at ? { decidedAt: iso(r.decided_at) } : {}),
});

/** Tickets as their holders see them: own seat, own requests, and friends (first names; seats only if shared). */
export async function guestTickets(q: Queryable, ids: string[]): Promise<GuestTicket[]> {
  if (!ids.length) return [];
  const tickets = await q.query("select * from tickets where id = any($1)", [ids]);
  if (!tickets.length) return [];
  const groupIds = [...new Set(tickets.map((t) => t.group_id).filter(Boolean))];
  const [groups, members, requests] = await Promise.all([
    groupIds.length ? q.query("select * from ticket_groups where id = any($1)", [groupIds]) : Promise.resolve([] as Row[]),
    groupIds.length
      ? q.query("select * from tickets where group_id = any($1) order by holder_name", [groupIds])
      : Promise.resolve([] as Row[]),
    q.query("select * from seat_requests where ticket_id = any($1) order by created_at desc", [tickets.map((t) => t.id)]),
  ]);
  return tickets.map((t) => {
    const g = groups.find((x) => x.id === t.group_id);
    const friends: FriendSeat[] = members
      .filter((m) => m.group_id === t.group_id)
      .map((m) => ({
        firstName: firstName(m.holder_name),
        block: m.block,
        ...(m.share_seat || m.id === t.id ? { row: m.row_label, seat: m.seat_number } : {}),
        checkedIn: Boolean(m.checked_in_at),
        isMe: m.id === t.id,
      }));
    return {
      id: t.id,
      venueId: t.venue_id,
      ticketNumber: t.ticket_number,
      firstName: firstName(t.holder_name),
      ...(t.tier ? { tier: t.tier } : {}),
      seat: refOf(t),
      ...(t.checked_in_at ? { checkedInAt: iso(t.checked_in_at) } : {}),
      ...(t.gate ? { gate: t.gate } : {}),
      shareSeat: t.share_seat,
      ...(g ? { group: { code: g.code, name: g.name, members: friends } } : {}),
      requests: requests.filter((r) => r.ticket_id === t.id).map(toRequest),
    };
  });
}

/** Seats with a ticket at the guest's event, as "BLOCK/ROW/SEAT" keys (no names), for picking a new seat. */
export async function takenFor(ctx: Ctx, ticketId: string): Promise<string[]> {
  const t = await ticketById(ctx.db, ticketId);
  return [...(await takenSeats(ctx.db, t.venue_id))];
}

export async function setShareSeat(ctx: Ctx, ticketId: string, share: boolean) {
  const t = await ticketById(ctx.db, ticketId);
  await ctx.db.query("update tickets set share_seat = $2, updated_at = now() where id = $1", [t.id, share]);
  notify({ venueId: t.venue_id });
}

/* ------------------------------------------------------------------ friend groups */

const groupCode = () => uid("g", 8).slice(2).toUpperCase();

export async function createGroup(ctx: Ctx, ticketId: string, name?: string) {
  const t = await ticketById(ctx.db, ticketId);
  if (t.group_id) throw conflict("You're already in a friend group. Leave it first to start a new one.");
  const id = uid("grp", 12);
  const code = groupCode();
  await ctx.db.tx(async (q) => {
    await q.query("insert into ticket_groups (id, venue_id, code, name) values ($1,$2,$3,$4)", [
      id, t.venue_id, code, name?.trim() || `${firstName(t.holder_name)}'s group`,
    ]);
    await q.query("update tickets set group_id = $2, updated_at = now() where id = $1", [t.id, id]);
  });
  notify({ venueId: t.venue_id });
  return { code };
}

/** What a group link shows before joining: no names, just the event and how many are in it. */
export async function groupPreview(ctx: Ctx, code: string) {
  const [g] = await ctx.db.query(
    `select g.code, g.name, g.venue_id, v.code as event_code, v.name as event_name,
       (select count(*)::int from tickets t where t.group_id = g.id) as members
     from ticket_groups g join venues v on v.id = g.venue_id where g.code = $1`,
    [code.trim().toUpperCase()],
  );
  if (!g) throw notFound("That group link has expired or is wrong");
  return { code: g.code, name: g.name, venueId: g.venue_id, eventCode: g.event_code, eventName: g.event_name, members: g.members };
}

export async function joinGroup(ctx: Ctx, ticketId: string, code: string) {
  const t = await ticketById(ctx.db, ticketId);
  const [g] = await ctx.db.query("select * from ticket_groups where code = $1", [code.trim().toUpperCase()]);
  if (!g) throw notFound("That group link has expired or is wrong");
  if (g.venue_id !== t.venue_id) throw bad("That group is for a different event");
  const [{ n }] = (await ctx.db.query("select count(*)::int as n from tickets where group_id = $1", [g.id])) as [{ n: number }];
  if (n >= 30) throw bad("That group is full (30 people)");
  await ctx.db.tx(async (q) => {
    await q.query("update tickets set group_id = $2, updated_at = now() where id = $1", [t.id, g.id]);
    if (t.group_id && t.group_id !== g.id) await dropIfEmpty(q, t.group_id);
  });
  notify({ venueId: t.venue_id });
  return { code: g.code };
}

export async function leaveGroup(ctx: Ctx, ticketId: string) {
  const t = await ticketById(ctx.db, ticketId);
  if (!t.group_id) return;
  await ctx.db.tx(async (q) => {
    await q.query("update tickets set group_id = null, updated_at = now() where id = $1", [t.id]);
    await dropIfEmpty(q, t.group_id);
  });
  notify({ venueId: t.venue_id });
}

async function dropIfEmpty(q: Queryable, groupId: string) {
  await q.query("delete from ticket_groups g where id = $1 and not exists (select 1 from tickets t where t.group_id = g.id)", [groupId]);
}

/* ------------------------------------------------------------------ seat change requests */

export type RequestInput = {
  want: SeatRequestWant;
  block?: string | undefined;
  row?: string | undefined;
  seat?: number | undefined;
  note?: string | undefined;
};

async function takenSeats(q: Queryable, venueId: string, except?: string): Promise<Set<string>> {
  const rows = await q.query("select id, block, row_label, seat_number from tickets where venue_id = $1", [venueId]);
  return new Set(rows.filter((r) => r.id !== except).map((r) => seatKey(r.block, r.row_label, r.seat_number)));
}

const blockTier = (blocks: SeatBlock[], code: string) => blocks.find((b) => b.code === code)?.tier;

/** A guest asks to move. Approved straight away when the event allows it and the seat is free at the same ticket type. */
export async function requestSeat(ctx: Ctx, ticketId: string, input: RequestInput): Promise<SeatRequest> {
  const t = await ticketById(ctx.db, ticketId);
  const { venue, blocks } = await blocksFor(ctx.db, t.venue_id);
  const mode = venue.seat_changes as SeatChanges;
  if (mode === "off") throw bad("Seat changes aren't available at this event. Please ask an usher.");
  const [open] = await ctx.db.query("select id from seat_requests where ticket_id = $1 and status = 'pending'", [t.id]);
  if (open) throw conflict("You already have a seat change waiting. Cancel it to ask for something else.");

  let wantBlock: string | null = null;
  let wantRow: string | null = null;
  let wantSeat: number | null = null;
  if (input.want === "seat") {
    if (!input.block || !input.row || input.seat === undefined) throw bad("Choose the block, row and seat you'd like");
    const problem = seatProblem(blocks, input.block, input.row, input.seat);
    if (problem) throw bad(problem);
    [wantBlock, wantRow, wantSeat] = [input.block.toUpperCase(), input.row.toUpperCase(), input.seat];
    if (seatKey(wantBlock, wantRow, wantSeat) === seatKey(t.block, t.row_label, t.seat_number)) throw bad("That's already your seat");
    if ((await takenSeats(ctx.db, t.venue_id, t.id)).has(seatKey(wantBlock, wantRow, wantSeat))) {
      throw conflict("Someone already has that seat. Pick another, or ask for any seat in the block.");
    }
  } else if (input.want === "block") {
    if (!input.block || !blocks.some((b) => b.code === input.block!.toUpperCase())) throw bad("Choose a block from the seating plan");
    wantBlock = input.block.toUpperCase();
  } else if (!t.group_id) {
    throw bad("Join or start a friend group first, so we know who you'd like to sit with");
  }

  const id = uid("srq", 12);
  await ctx.db.query(
    `insert into seat_requests (id, venue_id, ticket_id, want, want_block, want_row, want_seat, note, from_seat)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, t.venue_id, t.id, input.want, wantBlock, wantRow, wantSeat, input.note?.trim() || null, JSON.stringify(refOf(t))],
  );
  const sameTier = wantBlock !== null && (blockTier(blocks, wantBlock) ?? null) === (t.tier ?? blockTier(blocks, t.block) ?? null);
  if (mode === "auto" && input.want === "seat" && sameTier) {
    await decide(ctx, t.venue_id, id, { decision: "approve" }, "auto");
  }
  notify({ venueId: t.venue_id });
  const [row] = await ctx.db.query("select * from seat_requests where id = $1", [id]);
  return toRequest(row!);
}

export async function cancelRequest(ctx: Ctx, ticketId: string, requestId: string) {
  const [r] = await ctx.db.query(
    "update seat_requests set status = 'cancelled', decided_at = now() where id = $1 and ticket_id = $2 and status = 'pending' returning venue_id",
    [requestId, ticketId],
  );
  if (!r) throw notFound("No waiting request to cancel");
  notify({ venueId: r.venue_id });
}

/** A free seat that fits the request: the one asked for, the best in a block, or the closest to friends. */
function suggest(blocks: SeatBlock[], taken: Set<string>, r: Row, friends: SeatRef[]): SeatRef | undefined {
  const free = (b: SeatBlock) => seatsOf(b).filter((p) => !taken.has(seatKey(b.code, p.row, p.seat)));
  if (r.want === "seat") {
    return taken.has(seatKey(r.want_block, r.want_row, r.want_seat)) ? undefined : { block: r.want_block, row: r.want_row, seat: r.want_seat };
  }
  if (r.want === "block") {
    const b = blocks.find((x) => x.code === r.want_block);
    if (!b) return undefined;
    // Nearest the front, then nearest the middle of the row.
    const mid = (row: number) => {
      const all = seatsOf(b).filter((p) => p.rowIndex === row);
      return all[Math.floor(all.length / 2)];
    };
    const best = free(b).sort((a, c) => {
      if (a.rowIndex !== c.rowIndex) return a.rowIndex - c.rowIndex;
      const m = mid(a.rowIndex)!;
      return Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(c.x - m.x, c.y - m.y);
    })[0];
    return best ? { block: b.code, row: best.row, seat: best.seat } : undefined;
  }
  const spots = friends
    .map((f) => findSeat(blocks, f.block, f.row, f.seat))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  if (!spots.length) return undefined;
  let best: SeatRef | undefined;
  let bestD = Infinity;
  for (const b of blocks.filter((x) => spots.some((s) => s.block.code === x.code))) {
    for (const p of free(b)) {
      // Same row next to a friend beats a seat behind them.
      const d = Math.min(...spots.map((s) => Math.hypot(p.x - s.pos.x, p.y - s.pos.y) + (s.block.code === b.code && s.pos.row === p.row ? 0 : 0.5)));
      if (d < bestD) {
        bestD = d;
        best = { block: b.code, row: p.row, seat: p.seat };
      }
    }
  }
  return best;
}

/** Requests for organisers and on-site staff, with the guest's name, ticket and a suggested seat. */
export async function listRequests(q: Queryable, venueId: string, opts: { all?: boolean } = {}): Promise<SeatRequest[]> {
  const rows = await q.query(
    `select r.*, t.holder_name, t.ticket_number, t.tier, t.group_id from seat_requests r join tickets t on t.id = r.ticket_id
     where r.venue_id = $1 ${opts.all ? "" : "and (r.status = 'pending' or r.decided_at > now() - interval '1 day')"}
     order by (r.status = 'pending') desc, r.created_at desc limit 200`,
    [venueId],
  );
  if (!rows.length) return [];
  const { blocks } = await blocksFor(q, venueId);
  const taken = await takenSeats(q, venueId);
  const groupIds = [...new Set(rows.map((r) => r.group_id).filter(Boolean))];
  const members = groupIds.length ? await q.query("select * from tickets where group_id = any($1)", [groupIds]) : [];
  return rows.map((r) => {
    const friends = members.filter((m) => m.group_id === r.group_id && m.id !== r.ticket_id).map(refOf);
    const suggestion = r.status === "pending" ? suggest(blocks, taken, r, friends) : undefined;
    return {
      ...toRequest(r),
      guestName: r.holder_name,
      ticketNumber: r.ticket_number,
      ...(r.tier ? { tier: r.tier } : {}),
      ...(friends.length ? { friends } : {}),
      ...(suggestion ? { suggestion } : {}),
    };
  });
}

export type Decision = { decision: "approve" | "decline"; block?: string | undefined; row?: string | undefined; seat?: number | undefined; note?: string | undefined };

/** Approve (moving the ticket to a free seat) or decline a request. The caller checks permission for the venue. */
export async function decideRequest(ctx: Ctx, scope: Scope, requestId: string, input: Decision): Promise<SeatRequest> {
  await decide(ctx, scope.venueId, requestId, input, scope.actorName);
  notify({ venueId: scope.venueId });
  const [row] = await listRequests(ctx.db, scope.venueId, { all: true }).then((all) => all.filter((r) => r.id === requestId));
  return row!;
}

async function decide(ctx: Ctx, venueId: string, requestId: string, input: Decision, by: string) {
  await ctx.db.tx(async (q) => {
    const [r] = await q.query("select * from seat_requests where id = $1 and venue_id = $2 for update", [requestId, venueId]);
    if (!r) throw notFound("Seat request not found");
    if (r.status !== "pending") throw conflict(`This request was already ${r.status}`);
    if (input.decision === "decline") {
      await q.query(
        "update seat_requests set status = 'declined', decided_by = $2, decision_note = $3, decided_at = now() where id = $1",
        [r.id, by, input.note?.trim() || null],
      );
      return;
    }
    const { blocks } = await blocksFor(q, venueId);
    const block = (input.block ?? r.want_block ?? "").toUpperCase();
    const row = (input.row ?? r.want_row ?? "").toUpperCase();
    const seat = input.seat ?? r.want_seat;
    if (!block || !row || seat === null || seat === undefined) throw bad("Choose the seat to move them to");
    const problem = seatProblem(blocks, block, row, seat);
    if (problem) throw bad(problem);
    if ((await takenSeats(q, venueId, r.ticket_id)).has(seatKey(block, row, seat))) {
      throw conflict(`${block} ${row}${seat} already has a ticket. Choose another seat.`);
    }
    const to: SeatRef = { block, row, seat };
    await q.query("update tickets set block = $2, row_label = $3, seat_number = $4, updated_at = now() where id = $1", [
      r.ticket_id, block, row, seat,
    ]);
    await q.query(
      "update seat_requests set status = 'approved', to_seat = $2, decided_by = $3, decision_note = $4, decided_at = now() where id = $1",
      [r.id, JSON.stringify(to), by, input.note?.trim() || null],
    );
  });
}
