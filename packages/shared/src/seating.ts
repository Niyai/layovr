import { z } from "zod";

/**
 * Seating: blocks of numbered seats inside plan areas (theatres, arenas, halls).
 *
 * A block is described the way a venue's seating chart is: rows A, B, C… from
 * the front, seats numbered across each row, aisles, and the door (portal) you
 * enter it by. Seat positions are generated from that, never stored one by one.
 * Tickets name a seat as block + row + seat number, so guests can be guided to
 * it with directions that are exact without needing indoor positioning:
 * entrance → stairs → portal → row → seat.
 */

// Same convention as plan.ts (kept local so plan.ts can import this file without a cycle).
const polar = (cx: number, cy: number, r: number, angle: number): [number, number] => [
  cx + r * Math.sin((angle * Math.PI) / 180),
  cy - r * Math.cos((angle * Math.PI) / 180),
];

const code = (max: number) =>
  z.string().trim().toUpperCase().regex(new RegExp(`^[A-Z0-9][A-Z0-9-]{0,${max - 1}}$`), "Codes use letters, numbers and dashes");

export const seatLayoutSchema = z.discriminatedUnion("type", [
  /** Straight rows in a box. `front` is the side the stage (or screen) is on. */
  z.object({
    type: z.literal("rows"),
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
    front: z.enum(["top", "bottom", "left", "right"]).default("top"),
  }),
  /** Curved rows around a stage at (cx, cy): front row at radius r0, back row at r1, from angle a0 to a1. */
  z.object({
    type: z.literal("arc"),
    cx: z.number(),
    cy: z.number(),
    r0: z.number().positive(),
    r1: z.number().positive(),
    a0: z.number(),
    a1: z.number(),
  }),
]);
export type SeatLayout = z.infer<typeof seatLayoutSchema>;

export const seatBlockSchema = z.object({
  /** What tickets call this block or section, e.g. "C", "BLK-104", "VIP-L". */
  code: code(12),
  name: z.string().min(1).max(60),
  /** The plan area the block sits in. */
  area: code(12),
  /** Floor the block is entered from; defaults to the area's level. */
  level: z.number().int().optional(),
  layout: seatLayoutSchema,
  /** Number of rows (labelled A, B, C… from the front) or the row labels, front row first. */
  rows: z.union([z.number().int().min(1).max(200), z.array(z.string().trim().toUpperCase().min(1).max(4)).min(1).max(200)]),
  /** Seats in every row, or per row (front row first). */
  seatsPerRow: z.union([z.number().int().min(1).max(200), z.array(z.number().int().min(1).max(200)).min(1).max(200)]),
  firstSeat: z.number().int().min(0).max(1000).default(1),
  /** Which way seat numbers run, as seen by someone sitting facing the stage. */
  numbering: z.enum(["ltr", "rtl"]).default("ltr"),
  /** Seat numbers that have an aisle straight after them. */
  aisleAfter: z.array(z.number().int()).max(50).default([]),
  /** Label of the marker (usually a portal) guests enter this block by. */
  portal: z.string().max(80).optional(),
  /** Ticket type sold for this block, e.g. "VIP". Seat moves within a ticket type can be approved automatically. */
  tier: z.string().trim().max(40).optional(),
  /** Wheelchair spaces, as "row-seat", e.g. "A-1". */
  accessible: z.array(z.string().trim().toUpperCase().max(10)).max(200).default([]),
});
export type SeatBlock = z.infer<typeof seatBlockSchema>;
export type SeatBlockInput = z.input<typeof seatBlockSchema>;

export type SeatPos = {
  block: string;
  row: string;
  /** 0 = front row. */
  rowIndex: number;
  seat: number;
  x: number;
  y: number;
  accessible: boolean;
};

/** "A".."Z", "AA".. for numbered rows. */
export function rowLabel(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function rowLabels(b: Pick<SeatBlock, "rows">): string[] {
  return typeof b.rows === "number" ? Array.from({ length: b.rows }, (_, i) => rowLabel(i)) : b.rows;
}

export function seatsInRow(b: Pick<SeatBlock, "seatsPerRow">, rowIndex: number): number {
  if (typeof b.seatsPerRow === "number") return b.seatsPerRow;
  return b.seatsPerRow[rowIndex] ?? b.seatsPerRow[b.seatsPerRow.length - 1] ?? 0;
}

export function seatCount(b: SeatBlock): number {
  return rowLabels(b).reduce((n, _r, i) => n + seatsInRow(b, i), 0);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Every seat in a block with its position on the plan canvas.
 * Seats are spread evenly across each row, with half a seat's gap at each aisle.
 */
export function seatsOf(b: SeatBlock): SeatPos[] {
  const rows = rowLabels(b);
  const out: SeatPos[] = [];
  const accessible = new Set(b.accessible);
  rows.forEach((row, ri) => {
    const n = seatsInRow(b, ri);
    // Slots from the left end (facing the stage), with aisle gaps.
    const numbers = Array.from({ length: n }, (_, i) => b.firstSeat + i);
    const leftToRight = b.numbering === "ltr" ? numbers : [...numbers].reverse();
    const slots: number[] = [];
    let pos = 0;
    for (const [i, seat] of leftToRight.entries()) {
      slots.push(pos);
      const next = leftToRight[i + 1];
      const aisle =
        next !== undefined &&
        ((b.numbering === "ltr" && b.aisleAfter.includes(seat)) || (b.numbering === "rtl" && b.aisleAfter.includes(next)));
      pos += aisle ? 1.5 : 1;
    }
    const span = Math.max(pos - 1, 1);
    // 0..1 across the row from the left end, 0..1 from the front row back.
    const depth = rows.length === 1 ? 0.5 : (ri + 0.5) / rows.length;
    leftToRight.forEach((seat, i) => {
      const across = n === 1 ? 0.5 : 0.04 + 0.92 * (slots[i]! / span);
      const [x, y] = place(b.layout, across, depth);
      out.push({ block: b.code, row, rowIndex: ri, seat, x: round2(x), y: round2(y), accessible: accessible.has(`${row}-${seat}`) });
    });
  });
  return out;
}

/** A point in the layout: `across` 0..1 from the left end (facing the stage), `depth` 0..1 from the front. */
function place(l: SeatLayout, across: number, depth: number): [number, number] {
  if (l.type === "arc") {
    // Facing the stage at the centre, your left is the larger angle (angles run clockwise).
    const angle = l.a1 - (l.a1 - l.a0) * across;
    return polar(l.cx, l.cy, l.r0 + (l.r1 - l.r0) * depth, angle);
  }
  const { x, y, w, h } = l;
  switch (l.front) {
    case "top": // facing up: left is west
      return [x + w * across, y + h * depth];
    case "bottom": // facing down: left is east
      return [x + w * (1 - across), y + h * (1 - depth)];
    case "left": // facing west: left is south
      return [x + w * depth, y + h * (1 - across)];
    case "right": // facing east: left is north
      return [x + w * (1 - depth), y + h * across];
  }
}

/** Where the stage is, for drawing a block: the arc centre, or the middle of the front edge. */
export function stagePoint(l: SeatLayout): [number, number] {
  if (l.type === "arc") return [l.cx, l.cy];
  switch (l.front) {
    case "top":
      return [l.x + l.w / 2, l.y];
    case "bottom":
      return [l.x + l.w / 2, l.y + l.h];
    case "left":
      return [l.x, l.y + l.h / 2];
    case "right":
      return [l.x + l.w, l.y + l.h / 2];
  }
}

export const normRow = (row: string) => row.trim().toUpperCase();
export const seatKey = (block: string, row: string, seat: number) => `${block.toUpperCase()}/${normRow(row)}/${seat}`;

export function findSeat(blocks: SeatBlock[], block: string, row: string, seat: number): { block: SeatBlock; pos: SeatPos } | null {
  const b = blocks.find((x) => x.code === block.trim().toUpperCase());
  if (!b) return null;
  const ri = rowLabels(b).indexOf(normRow(row));
  if (ri < 0) return null;
  if (seat < b.firstSeat || seat >= b.firstSeat + seatsInRow(b, ri)) return null;
  const pos = seatsOf(b).find((p) => p.rowIndex === ri && p.seat === seat);
  return pos ? { block: b, pos } : null;
}

/** Why a seat reference doesn't exist, in words a guest or organiser understands. */
export function seatProblem(blocks: SeatBlock[], block: string, row: string, seat: number): string | null {
  const b = blocks.find((x) => x.code === block.trim().toUpperCase());
  if (!b) return `There's no block "${block}" on the seating plan`;
  const rows = rowLabels(b);
  const ri = rows.indexOf(normRow(row));
  if (ri < 0) return `Block ${b.code} has rows ${rows[0]}–${rows[rows.length - 1]}, not "${row}"`;
  const n = seatsInRow(b, ri);
  if (seat < b.firstSeat || seat >= b.firstSeat + n) return `Row ${rows[ri]} in block ${b.code} has seats ${b.firstSeat}–${b.firstSeat + n - 1}`;
  return null;
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** Where in its row a seat is: from the nearer end or aisle, facing the stage. */
export function seatInRow(b: SeatBlock, rowIndex: number, seat: number): string {
  const n = seatsInRow(b, rowIndex);
  const numbers = Array.from({ length: n }, (_, i) => b.firstSeat + i);
  const leftToRight = b.numbering === "ltr" ? numbers : [...numbers].reverse();
  const i = leftToRight.indexOf(seat);
  // Segments between aisles, left to right.
  const breaks = new Set<number>();
  leftToRight.forEach((s, k) => {
    const next = leftToRight[k + 1];
    if (next === undefined) return;
    if ((b.numbering === "ltr" && b.aisleAfter.includes(s)) || (b.numbering === "rtl" && b.aisleAfter.includes(next))) breaks.add(k);
  });
  let start = 0;
  for (let k = 0; k < i; k++) if (breaks.has(k)) start = k + 1;
  let end = n - 1;
  for (let k = n - 2; k >= i; k--) if (breaks.has(k)) end = k;
  const fromLeft = i - start + 1;
  const fromRight = end - i + 1;
  const leftEdge = start === 0 ? "left-hand end of the row" : "aisle on your left";
  const rightEdge = end === n - 1 ? "right-hand end of the row" : "aisle on your right";
  if (fromLeft <= fromRight) return fromLeft === 1 ? `the first seat in from the ${leftEdge}` : `the ${ordinal(fromLeft)} seat in from the ${leftEdge}`;
  return fromRight === 1 ? `the first seat in from the ${rightEdge}` : `the ${ordinal(fromRight)} seat in from the ${rightEdge}`;
}

type Marker = { kind: string; label: string; level?: number | undefined; x: number; y: number; status?: string };
type Level = { level: number; name: string };

export type SeatGuide = {
  /** "Block C · Row F · Seat 14". */
  title: string;
  steps: string[];
  /** The seat's position on the plan, for maps. */
  pos: SeatPos;
  /** Floor the block is entered from, if known. */
  level?: number;
};

/**
 * Step-by-step directions to a seat. Exact without indoor positioning: they
 * start from a known place (the gate a ticket was scanned at, or a sign the
 * guest scanned) and end with rows and seat numbers the guest can read.
 */
export function seatDirections(
  plan: { levels: Level[]; markers: Marker[] },
  areaName: string,
  areaLevel: number | undefined,
  b: SeatBlock,
  row: string,
  seat: number,
  from?: string,
): SeatGuide | null {
  const found = findSeat([b], b.code, row, seat);
  if (!found) return null;
  const { pos } = found;
  const rows = rowLabels(b);
  const steps: string[] = [];
  const levelName = (l: number) => plan.levels.find((x) => x.level === l)?.name ?? `level ${l}`;
  const portal = b.portal ? plan.markers.find((m) => m.label === b.portal) : undefined;
  const target = b.level ?? portal?.level ?? areaLevel;
  const start = from ? plan.markers.find((m) => m.label === from) : undefined;

  if (start?.status === "blocked") steps.push(`${start.label} is closed today. Use another entrance and follow signs for ${areaName}.`);
  else if (start && start.label !== portal?.label) steps.push(`You're at ${start.label}.`);
  const startLevel = start?.level ?? (start ? undefined : 0);

  if (!portal || start?.label !== portal.label) {
    if (target !== undefined && target !== startLevel) {
      // Stairs or a lift that reaches the target floor: the shortest walk from where
      // the guest is, up, and on to the portal (or the block).
      const [tx, ty] = portal ? [portal.x, portal.y] : [pos.x, pos.y];
      const cost = (m: Marker) => Math.hypot(m.x - tx, m.y - ty) + (start ? Math.hypot(m.x - start.x, m.y - start.y) : 0);
      const ways = plan.markers
        .filter((m) => ["stairs", "lift", "escalator"].includes(m.kind) && m.status !== "blocked" && (m.level === undefined || m.level === target))
        .sort((a, c) => cost(a) - cost(c));
      const way = ways[0];
      steps.push(way ? `Take the ${way.label} to the ${levelName(target).toLowerCase()}.` : `Go up to the ${levelName(target).toLowerCase()}.`);
    }
    if (portal && portal.status === "blocked") steps.push(`${portal.label} is closed. Ask an usher for the nearest way into ${b.name}.`);
    else if (portal) steps.push(`Follow the signs to ${portal.label} and go into ${areaName}.`);
    else steps.push(`Go into ${areaName} and find ${b.name}.`);
  } else {
    steps.push(`Go through ${portal.label} into ${areaName}.`);
  }

  // Count rows from the end nearer the portal.
  const ri = pos.rowIndex;
  let rowStep = `Find Row ${pos.row} in ${b.name}: it's the ${ri === 0 ? "front row" : `${ordinal(ri + 1)} row from the front`}`;
  if (portal && rows.length > 1) {
    const [sx, sy] = stagePoint(b.layout);
    const front = seatsOf(b).filter((p) => p.rowIndex === 0);
    const back = seatsOf(b).filter((p) => p.rowIndex === rows.length - 1);
    const dist = (ps: SeatPos[]) => Math.min(...ps.map((p) => Math.hypot(p.x - portal.x, p.y - portal.y)));
    const fromBack = rows.length - ri;
    if (dist(back) < dist(front) && Math.hypot(portal.x - sx, portal.y - sy) > 0) {
      rowStep =
        ri === 0
          ? `Find Row ${pos.row} in ${b.name}: it's the front row, nearest the stage, so walk all the way down`
          : `Find Row ${pos.row} in ${b.name}: from the back, it's ${fromBack === 1 ? "the back row" : `the ${ordinal(fromBack)} row down`}`;
    }
  }
  steps.push(`${rowStep}. Row letters are on the end of each row.`);
  steps.push(`Seat ${pos.seat} is ${seatInRow(b, ri, pos.seat)} (facing the stage).${pos.accessible ? " It's a wheelchair space." : ""}`);

  return {
    title: `${b.name} · Row ${pos.row} · Seat ${pos.seat}`,
    steps,
    pos,
    ...(target === undefined ? {} : { level: target }),
  };
}

/* ------------------------------------------------------------------ ticket files */

export type TicketInput = {
  number: string;
  barcode?: string;
  name?: string;
  block: string;
  row: string;
  seat: number;
  tier?: string;
  checkedIn?: boolean;
  gate?: string;
};

export const ticketInputSchema = z.object({
  number: z.string().trim().min(1).max(64).describe("Ticket number printed on the ticket"),
  barcode: z.string().trim().max(256).optional().describe("What the ticket's barcode/QR contains, if different from the number"),
  name: z.string().trim().max(120).optional().describe("Ticket holder"),
  block: z.string().trim().toUpperCase().min(1).max(12).describe("Block or section code, as on the seating plan"),
  row: z.string().trim().toUpperCase().min(1).max(4),
  seat: z.coerce.number().int().min(0).max(10_000),
  tier: z.string().trim().max(40).optional().describe("Ticket type, e.g. VIP"),
  checkedIn: z.boolean().optional(),
  gate: z.string().trim().max(80).optional().describe("Entrance the ticket was scanned at (a marker label)"),
});

const HEADER_ALIASES: Record<string, keyof TicketInput> = {
  ticket: "number",
  ticket_number: "number",
  ticketnumber: "number",
  ticket_no: "number",
  number: "number",
  barcode: "barcode",
  qr: "barcode",
  name: "name",
  holder: "name",
  holder_name: "name",
  attendee: "name",
  block: "block",
  section: "block",
  row: "row",
  seat: "seat",
  seat_number: "seat",
  tier: "tier",
  ticket_type: "tier",
  type: "tier",
  checked_in: "checkedIn",
  checkedin: "checkedIn",
  gate: "gate",
  entrance: "gate",
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Reads a ticket export (CSV with a header row). Column names are matched
 * loosely (ticket_number / ticket / number, section / block, …) so files from
 * most ticketing systems work as they are.
 */
export function parseTicketCsv(text: string): { tickets: TicketInput[]; errors: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = [];
  if (lines.length < 2) return { tickets: [], errors: ["The file needs a header row and at least one ticket"] };
  const header = splitCsvLine(lines[0]!).map((h) => HEADER_ALIASES[h.toLowerCase().replace(/[\s-]+/g, "_")]);
  for (const need of ["number", "block", "row", "seat"] as const) {
    if (!header.includes(need)) errors.push(`Missing a "${need === "number" ? "ticket_number" : need}" column`);
  }
  if (errors.length) return { tickets: [], errors };
  const tickets: TicketInput[] = [];
  for (const [i, line] of lines.slice(1).entries()) {
    const cells = splitCsvLine(line);
    const raw: Record<string, unknown> = {};
    header.forEach((key, c) => {
      const v = cells[c];
      if (!key || v === undefined || v === "") return;
      raw[key] = key === "checkedIn" ? /^(1|y|yes|true)$/i.test(v) : v;
    });
    const parsed = ticketInputSchema.safeParse(raw);
    if (!parsed.success) {
      if (errors.length < 20) errors.push(`Line ${i + 2}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
      continue;
    }
    tickets.push(stripUndefined(parsed.data) as TicketInput);
  }
  return { tickets, errors };
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export const TICKET_CSV_EXAMPLE = `ticket_number,barcode,name,section,row,seat,ticket_type,checked_in,gate
MS-200001,MS-200001,Ada Obi,C,F,106,VIP,yes,Zone B entrance
MS-200002,,Tunde Bello,C,F,107,VIP,,
`;

/* ------------------------------------------------------------------ test data */

const FIRST = ["Ada", "Chidi", "Bisi", "Tunde", "Ngozi", "Emeka", "Funmi", "Yusuf", "Kemi", "Segun", "Amaka", "Ibrahim", "Zainab", "Femi", "Halima", "Uche", "Tolu", "Bola", "Musa", "Ifeoma"];
const LAST = ["Obi", "Bello", "Adeyemi", "Okafor", "Balogun", "Eze", "Abubakar", "Okeke", "Lawal", "Nwosu", "Ogunleye", "Danjuma", "Ibe", "Salami", "Akande"];

/**
 * Made-up tickets that fill `share` of every block's seats (deterministic, so
 * test runs and demos repeat). Ticket numbers look like "<prefix>-100001".
 */
export function makeTestTickets(blocks: SeatBlock[], opts: { prefix: string; share?: number; gates?: string[] }): TicketInput[] {
  const share = opts.share ?? 0.6;
  const out: TicketInput[] = [];
  let n = 0;
  let k = 0;
  for (const b of blocks) {
    for (const s of seatsOf(b)) {
      k++;
      // A simple hash keeps the pattern stable and spread out.
      if (((k * 2654435761) >>> 0) % 1000 >= share * 1000) continue;
      n++;
      const name = `${FIRST[(n * 7) % FIRST.length]} ${LAST[(n * 11) % LAST.length]}`;
      const number = `${opts.prefix}-${100000 + n}`;
      const checkedIn = n % 3 !== 0;
      const gate = opts.gates?.length ? opts.gates[n % opts.gates.length] : undefined;
      out.push({
        number,
        barcode: number,
        name,
        block: b.code,
        row: s.row,
        seat: s.seat,
        ...(b.tier ? { tier: b.tier } : {}),
        ...(checkedIn ? { checkedIn } : {}),
        ...(checkedIn && gate ? { gate } : {}),
      });
    }
  }
  return out;
}

/** Named demo tickets for Moonshot (local demo data; see README). */
export const DEMO_TICKETS: (TicketInput & { id: string; group?: boolean; shareSeat?: boolean })[] = [
  { id: "tkt_demo_ada", number: "MOON-0001", barcode: "MOON-0001", name: "Ada Obi", block: "C", row: "F", seat: 106, tier: "VIP", checkedIn: true, gate: "Zone B entrance", group: true },
  { id: "tkt_demo_chidi", number: "MOON-0002", barcode: "MOON-0002", name: "Chidi Eze", block: "C", row: "F", seat: 108, tier: "VIP", checkedIn: true, gate: "Zone B entrance", group: true },
  { id: "tkt_demo_bisi", number: "MOON-0003", barcode: "MOON-0003", name: "Bisi Lawal", block: "L", row: "K", seat: 2, tier: "Regular", group: true, shareSeat: false },
  { id: "tkt_demo_kunle", number: "MOON-0004", barcode: "MOON-0004", name: "Kunle Adeyemi", block: "R", row: "A", seat: 8, tier: "Regular", checkedIn: true, gate: "Zone D entrance" },
];
