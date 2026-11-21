import {
  TICKET_CSV_EXAMPLE,
  checkPlan,
  moonshotPlan,
  parseTicketCsv,
  seatDirections,
  seatsOf,
  type GuestTicket,
  type SeatRequest,
  type Snapshot,
  type VenuePlanInput,
} from "@layovr/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { openDb, type Db } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { resetData } from "../src/db/seed";
import type { Env } from "../src/lib/env";
import { resetLimits } from "../src/lib/ratelimit";
import { TOOLS } from "../src/mcp/tools";
import type { PartnerAuth } from "../src/context";

/** Seated events: seat blocks, ticket import, guests finding their seat, friend groups, seat changes. */

const env: Env = {
  production: false,
  port: 0,
  databaseUrl: undefined,
  dataDir: undefined,
  sessionSecret: "test-secret",
  flwSecretKey: undefined,
  flwSecretHash: "hash123",
  publicAppUrl: "http://app.test",
  showDemoPins: false,
  allowReset: true,
  seedOnEmpty: true,
  geoUserAgent: "Layovr tests",
  showDemoLogins: true,
};

const db: Db = await openDb({});
await migrate(db);
const app = createApp({ db, env, gateway: null });

async function call<T = any>(method: string, path: string, body?: unknown, cookie?: string): Promise<{ status: number; json: T; cookie?: string }> {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const setCookie = res.headers.get("set-cookie")?.split(";")[0];
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T, ...(setCookie ? { cookie: setCookie } : {}) };
}

const staff = async (pin: string) => (await call("POST", "/auth/login", { code: "MOONSHOT", pin })).cookie!;
const planner = async () => (await call("POST", "/partner/login", { email: "planner@demo.layovr.app", password: "layovr-demo" })).cookie!;
const find = async (ticket: string) => (await call<{ ticketId: string }>("POST", "/tickets/find", { ticket })).json.ticketId;
const mine = async (ticketId: string) =>
  (await call<Snapshot>("GET", `/snapshot?tickets=${ticketId}`)).json.tickets.find((t) => t.id === ticketId) as GuestTicket;
const EVENT = "/partner/events/v_moonshot";

beforeEach(async () => {
  await resetData(db);
  resetLimits();
});
afterAll(() => db.close());

describe("seat blocks in the plan", () => {
  it("checks seat blocks and writes directions from the gate to the seat", () => {
    const check = checkPlan(moonshotPlan);
    expect(check.ok).toBe(true);
    const plan = check.plan!;
    const c = plan.seating.find((b) => b.code === "C")!;
    expect(seatsOf(c)).toHaveLength(150);

    const guide = seatDirections(plan, "Main Bowl", undefined, c, "F", 106, "Zone B entrance")!;
    expect(guide.title).toBe("Block C · Row F · Seat 106");
    expect(guide.level).toBe(5);
    expect(guide.steps.join(" ")).toMatch(/Zone B stairs to the fifth floor.*Bowl doors D5.*6th row from the front.*Seat 106 is the 6th seat in from the left-hand end/);

    // Entering at the back of a block counts rows from the back.
    const l = plan.seating.find((b) => b.code === "L")!;
    expect(seatDirections(plan, "Main Bowl", undefined, l, "K", 2)!.steps.join(" ")).toMatch(/from the back, it's the 2nd row down/);
    expect(seatDirections(plan, "Main Bowl", undefined, l, "Z", 2)).toBeNull();

    const broken = structuredClone(moonshotPlan) as VenuePlanInput & { seating: { portal?: string; area: string }[] };
    broken.seating[0]!.portal = "No such door";
    broken.seating[1]!.area = "NOPE";
    const bad = checkPlan(broken);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(" ")).toMatch(/enters by "No such door".*unknown area NOPE/);
  });

  it("reads ticket exports with loose column names", () => {
    const { tickets, errors } = parseTicketCsv(TICKET_CSV_EXAMPLE);
    expect(errors).toEqual([]);
    expect(tickets[0]).toMatchObject({ number: "MS-200001", block: "C", row: "F", seat: 106, tier: "VIP", checkedIn: true, gate: "Zone B entrance" });
    expect(parseTicketCsv("ticket,seat\n1,2").errors.join(" ")).toMatch(/section|block/);
  });

  it("keeps seat blocks when the plan is exported and saved again", async () => {
    const cookie = await planner();
    const plan = (await call("GET", `${EVENT}/plan`, undefined, cookie)).json;
    expect(plan.seating).toHaveLength(3);
    expect((await call("PUT", `${EVENT}/plan?prune=1`, plan, cookie)).json.applied).toBe(true);
    const snap = (await call<Snapshot>("GET", "/snapshot")).json;
    expect(snap.venues.find((v) => v.id === "v_moonshot")!.plan!.seating).toHaveLength(3);
  });
});

describe("guests", () => {
  it("finds a ticket by number or barcode and sees friends without other people's details", async () => {
    const ada = await find("moon-0001");
    expect(ada).toBe("tkt_demo_ada");
    expect((await call("POST", "/tickets/find", { ticket: "NOPE-1" })).status).toBe(404);

    const t = await mine(ada);
    expect(t).toMatchObject({ firstName: "Ada", seat: { block: "C", row: "F", seat: 106 }, gate: "Zone B entrance", tier: "VIP" });
    expect(t.checkedInAt).toBeTruthy();
    const members = t.group!.members;
    expect(members.map((m) => m.firstName).sort()).toEqual(["Ada", "Bisi", "Chidi"]);
    // Bisi chose not to share her exact seat; nobody's surname or ticket number is sent.
    expect(members.find((m) => m.firstName === "Bisi")).toEqual({ firstName: "Bisi", block: "L", checkedIn: false, isMe: false });
    expect(JSON.stringify(t.group)).not.toMatch(/Lawal|MOON-0003/);

    // Without the id, nothing about tickets is visible.
    expect((await call<Snapshot>("GET", "/snapshot")).json.tickets).toEqual([]);
    expect((await call<Snapshot>("GET", "/snapshot")).json.seatRequests).toEqual([]);
  });

  it("starts, previews, joins and leaves friend groups", async () => {
    const kunle = await find("MOON-0004");
    const { code } = (await call("POST", `/tickets/${kunle}/group`, { name: "Row A gang" })).json;
    expect(code).toMatch(/^[A-Z0-9]{6,}$/);
    const preview = (await call("GET", `/groups/${code}`)).json;
    expect(preview).toMatchObject({ name: "Row A gang", eventCode: "MOONSHOT", members: 1 });
    expect(JSON.stringify(preview)).not.toMatch(/Kunle/);

    const [row] = await db.query("select id from tickets where ticket_number like 'MS-%' and group_id is null limit 1");
    expect((await call("POST", `/tickets/${row!.id}/group/join`, { code })).status).toBe(200);
    expect((await mine(kunle)).group!.members).toHaveLength(2);

    expect((await call("POST", `/tickets/${kunle}/group`, {})).status).toBe(409);
    await call("POST", `/tickets/${kunle}/group/leave`);
    await call("POST", `/tickets/${row!.id}/group/leave`);
    expect((await call("GET", `/groups/${code}`)).status).toBe(404);

    expect((await call("PATCH", `/tickets/${kunle}`, { shareSeat: false })).status).toBe(200);
    expect((await mine(kunle)).shareSeat).toBe(false);
  });
});

describe("seat change requests", () => {
  it("waits for organisers, who see it with a suggestion and can move the guest", async () => {
    const kunle = await find("MOON-0004");
    const [free] = await freeSeats("R", 1);
    const req = (await call<SeatRequest>("POST", `/tickets/${kunle}/requests`, { want: "seat", ...free, note: "Closer to the aisle" })).json;
    expect(req.status).toBe("pending");
    expect((await call("POST", `/tickets/${kunle}/requests`, { want: "block", block: "C" })).status).toBe(409);

    // Dispatch and admin see requests; runners and guests don't.
    const dispatch = await staff("2222");
    const forDispatch = (await call<Snapshot>("GET", "/snapshot", undefined, dispatch)).json.seatRequests;
    const mineReq = forDispatch.find((r) => r.id === req.id)!;
    expect(mineReq).toMatchObject({ guestName: "Kunle Adeyemi", ticketNumber: "MOON-0004", suggestion: free });
    expect((await call<Snapshot>("GET", "/snapshot", undefined, await staff("3333"))).json.seatRequests).toEqual([]);
    expect((await call("POST", `/seat-requests/${req.id}`, { decision: "approve" }, await staff("3333"))).status).toBe(403);

    // Bisi's "sit with my friends" request comes with a free seat next to them.
    const bisi = forDispatch.find((r) => r.id === "srq_demo")!;
    expect(bisi.friends).toHaveLength(2);
    expect(bisi.suggestion?.block).toBe("C");

    const done = (await call<SeatRequest>("POST", `/seat-requests/${req.id}`, { decision: "approve" }, dispatch)).json;
    expect(done).toMatchObject({ status: "approved", to: free });
    expect((await mine(kunle)).seat).toEqual(free);
    expect((await call("POST", `/seat-requests/${req.id}`, { decision: "decline" }, dispatch)).status).toBe(409);
  });

  it("can't take someone else's seat, and organisers can decline with a note", async () => {
    const kunle = await find("MOON-0004");
    expect((await call("POST", `/tickets/${kunle}/requests`, { want: "seat", block: "C", row: "F", seat: 106 })).status).toBe(409);
    expect((await call("POST", `/tickets/${kunle}/requests`, { want: "seat", block: "C", row: "Z", seat: 1 })).status).toBe(400);
    expect((await call("POST", `/tickets/${kunle}/requests`, { want: "friends" })).status).toBe(400);

    const cookie = await planner();
    const list = (await call<SeatRequest[]>("GET", `${EVENT}/seat-requests`, undefined, cookie)).json;
    expect(list[0]!.id).toBe("srq_demo");
    // Approving onto a taken seat fails; declining tells the guest why.
    expect((await call("POST", `${EVENT}/seat-requests/srq_demo`, { decision: "approve", block: "C", row: "F", seat: 108 }, cookie)).status).toBe(409);
    await call("POST", `${EVENT}/seat-requests/srq_demo`, { decision: "decline", note: "Block C is VIP only" }, cookie);
    const bisi = await mine("tkt_demo_bisi");
    expect(bisi.requests[0]).toMatchObject({ status: "declined", decisionNote: "Block C is VIP only" });
  });

  it("approves free seats with the same ticket type automatically when the event allows it", async () => {
    const cookie = await planner();
    expect((await call("PATCH", EVENT, { seatChanges: "auto" }, cookie)).json.seatChanges).toBe("auto");
    const kunle = await find("MOON-0004");
    const [sameTier] = await freeSeats("L", 1);
    const auto = (await call<SeatRequest>("POST", `/tickets/${kunle}/requests`, { want: "seat", ...sameTier })).json;
    expect(auto).toMatchObject({ status: "approved", to: sameTier });

    // VIP seats still need a person to decide.
    const [vip] = await freeSeats("C", 1);
    expect((await call<SeatRequest>("POST", `/tickets/${kunle}/requests`, { want: "seat", ...vip })).json.status).toBe("pending");

    await call("PATCH", EVENT, { seatChanges: "off" }, cookie);
    const ada = await find("MOON-0001");
    expect((await call("POST", `/tickets/${ada}/requests`, { want: "block", block: "C" })).status).toBe(400);
  });
});

describe("organisers' tickets", () => {
  it("checks, imports, updates and replaces tickets, and records check-ins", async () => {
    const cookie = await planner();
    const stats = (await call(`GET`, `${EVENT}/tickets?q=moon-000`, undefined, cookie)).json;
    expect(stats.tickets).toHaveLength(4);
    expect(stats.seats).toBe(402);

    const csv = `ticket,section,row,seat,name\nNEW-1,C,A,103,Femi Ade\nNEW-2,Q,A,1,Nobody\nNEW-3,C,F,106,Clash`;
    const dry = (await call(`POST`, `${EVENT}/tickets/import?dryRun=1`, { csv }, cookie)).json;
    expect(dry.ok).toBe(false);
    expect(dry.errors.join(" ")).toMatch(/no block "Q".*C F106 already belongs to ticket MOON-0001/);

    const [a, b] = await freeSeats("C", 2);
    const good = `ticket,section,row,seat,name,gate\nNEW-1,${a!.block},${a!.row},${a!.seat},Femi Ade,Zone A entrance\nNEW-2,${b!.block},${b!.row},${b!.seat},Halima,Back door`;
    const check = (await call(`POST`, `${EVENT}/tickets/import?dryRun=1`, { csv: good }, cookie)).json;
    expect(check).toMatchObject({ ok: true, applied: false, added: 2 });
    expect(check.warnings.join(" ")).toMatch(/Back door/);
    expect((await call(`POST`, `${EVENT}/tickets/import`, { csv: good }, cookie)).json).toMatchObject({ applied: true, added: 2 });

    // Re-import swaps the two seats (allowed inside one import) and updates in place.
    const swapped = `ticket,section,row,seat\nNEW-1,${b!.block},${b!.row},${b!.seat}\nNEW-2,${a!.block},${a!.row},${a!.seat}`;
    expect((await call(`POST`, `${EVENT}/tickets/import`, { csv: swapped }, cookie)).json).toMatchObject({ applied: true, updated: 2, added: 0 });
    const femi = await mine(await find("NEW-1"));
    expect(femi.seat).toEqual(b);
    expect(femi.firstName).toBe("Femi");

    const checkin = (await call(`POST`, `${EVENT}/tickets/checkin`, { ticket: "NEW-1", gate: "Zone D entrance" }, cookie)).json;
    expect(checkin).toMatchObject({ ticketNumber: "NEW-1", gate: "Zone D entrance" });
    expect((await call(`POST`, `${EVENT}/tickets/checkin`, { ticket: "NOPE" }, cookie)).status).toBe(404);

    expect((await call(`POST`, `${EVENT}/tickets/import`, { tickets: [{ number: "ONLY-1", block: "R", row: "L", seat: 1 }], replace: true }, cookie)).json).toMatchObject({ applied: true });
    expect((await call(`GET`, `${EVENT}/tickets`, undefined, cookie)).json.total).toBe(1);
    expect((await call(`POST`, `${EVENT}/tickets/test`, { share: 0.5 }, cookie)).json.added).toBeGreaterThan(100);

    // Other partners can't see this event's tickets.
    const other = (await call("POST", "/partner/signup", { name: "Bisi", organisation: "Other", email: "b@other.ng", password: "correct horse" })).cookie!;
    expect((await call(`GET`, `${EVENT}/tickets`, undefined, other)).status).toBe(404);
  });

  it("offers the same through MCP tools, previewing writes", async () => {
    const [pu] = await db.query("select * from partner_users where email = 'planner@demo.layovr.app'");
    const auth: PartnerAuth = { partnerId: pu!.partner_id, partnerName: "TechCabal (demo)", userId: pu!.id, userName: "Demo Planner", role: "owner", scope: "write", channel: "mcp" };
    const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
    const ctx = { db, env, gateway: null };
    const list = (await tool("seat_requests_list").run(ctx, auth, { eventId: "v_moonshot" })) as SeatRequest[];
    expect(list[0]!.id).toBe("srq_demo");
    const preview = (await tool("seat_requests_decide").run(ctx, auth, { eventId: "v_moonshot", requestId: "srq_demo", decision: "decline" })) as { preview: boolean };
    expect(preview.preview).toBe(true);
    const [a] = await freeSeats("C", 1);
    const imp = (await tool("tickets_import").run(ctx, auth, { eventId: "v_moonshot", tickets: [{ number: "MCP-1", ...a }] })) as { preview: boolean; summary: string };
    expect(imp.summary).toMatch(/Import 1 tickets/);
    await tool("tickets_import").run(ctx, auth, { eventId: "v_moonshot", tickets: [{ number: "MCP-1", ...a }], confirm: true });
    expect(await find("MCP-1")).toBeTruthy();
  });
});

/** Free seats in a block, front rows first. */
async function freeSeats(block: string, n: number) {
  const plan = checkPlan(moonshotPlan).plan!;
  const b = plan.seating.find((x) => x.code === block)!;
  const taken = new Set(
    (await db.query("select row_label, seat_number from tickets where block = $1", [block])).map((r) => `${r.row_label}${r.seat_number}`),
  );
  return seatsOf(b)
    .filter((s) => !taken.has(`${s.row}${s.seat}`))
    .slice(0, n)
    .map((s) => ({ block, row: s.row, seat: s.seat }));
}
