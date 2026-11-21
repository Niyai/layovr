import { parseTicketCsv } from "@layovr/shared";
import { z } from "zod";
import { staffScope, type Ctx } from "../context";
import { param, requireStaff, type Router } from "../http";
import { bad } from "../lib/errors";
import { limit } from "../lib/ratelimit";
import * as seating from "../services/seating";
import { body, clean, ip, partnerSchemas, schemas } from "../schemas";
import { audited, eventFor } from "./partner";

/**
 * Seated events.
 * - Guests: find a ticket by number or barcode, then use its unguessable id
 *   for directions, friend groups and seat change requests.
 * - Organisers (dashboard, API key, MCP): import tickets, record check-ins,
 *   decide seat change requests.
 * - On-site admin and dispatch: decide seat change requests.
 */
export function seatingRoutes(r: Router, ctx: Ctx) {
  /* ---------------------------------------------------------- guests */

  r.post(
    "/tickets/find",
    {
      tag: "Guests",
      summary: "Find my ticket by its number or barcode",
      description: "Returns the ticket id to keep on the guest's phone. Rate-limited.",
      access: "public",
      body: schemas.findTicket,
      returns: "{ ticketId, venueId }",
    },
    async (c) => {
      limit(`ticket:${ip(c)}`, 20, 10 * 60_000);
      return c.json(await seating.findTicket(ctx, clean(await body(c, schemas.findTicket))));
    },
  );

  r.patch(
    "/tickets/:id",
    { tag: "Guests", summary: "Choose whether my friend group sees my exact seat", access: "public", body: schemas.shareSeat, returns: "{ ok }" },
    async (c) => {
      const { shareSeat } = await body(c, schemas.shareSeat);
      await seating.setShareSeat(ctx, param(c, "id"), shareSeat);
      return c.json({ ok: true });
    },
  );

  r.get(
    "/tickets/:id/taken",
    { tag: "Guests", summary: "Seats that already have a ticket (no names), for picking a new seat", access: "public", returns: "string[] of BLOCK/ROW/SEAT" },
    async (c) => {
      limit(`taken:${ip(c)}`, 60, 10 * 60_000);
      return c.json(await seating.takenFor(ctx, param(c, "id")));
    },
  );

  r.post(
    "/tickets/:id/requests",
    {
      tag: "Guests",
      summary: "Ask to change seats",
      description: "A specific seat, any seat in a block, or a seat next to my friend group. Organisers decide, unless the event approves free seats with the same ticket type automatically.",
      access: "public",
      body: schemas.seatRequest,
      returns: "SeatRequest",
    },
    async (c) => {
      const ticketId = param(c, "id");
      limit(`seatreq:${ticketId}`, 10, 60 * 60_000);
      return c.json(await seating.requestSeat(ctx, ticketId, clean(await body(c, schemas.seatRequest))));
    },
  );

  r.post("/tickets/:id/requests/:rid/cancel", { tag: "Guests", summary: "Cancel my waiting seat change", access: "public", returns: "{ ok }" }, async (c) => {
    await seating.cancelRequest(ctx, param(c, "id"), param(c, "rid"));
    return c.json({ ok: true });
  });

  r.post(
    "/tickets/:id/group",
    { tag: "Guests", summary: "Start a friend group (get a link to share)", access: "public", body: schemas.groupCreate, returns: "{ code }" },
    async (c) => c.json(await seating.createGroup(ctx, param(c, "id"), (await body(c, schemas.groupCreate)).name)),
  );

  r.post(
    "/tickets/:id/group/join",
    { tag: "Guests", summary: "Join a friend group from its link", access: "public", body: schemas.groupJoin, returns: "{ code }" },
    async (c) => {
      limit(`gjoin:${ip(c)}`, 30, 10 * 60_000);
      return c.json(await seating.joinGroup(ctx, param(c, "id"), (await body(c, schemas.groupJoin)).code));
    },
  );

  r.post("/tickets/:id/group/leave", { tag: "Guests", summary: "Leave my friend group", access: "public", returns: "{ ok }" }, async (c) => {
    await seating.leaveGroup(ctx, param(c, "id"));
    return c.json({ ok: true });
  });

  r.get(
    "/groups/:code",
    { tag: "Guests", summary: "What a friend group link shows before joining", description: "The event and how many people are in it; no names.", access: "public", returns: "{ code, name, eventCode, eventName, members }" },
    async (c) => {
      limit(`group:${ip(c)}`, 60, 10 * 60_000);
      return c.json(await seating.groupPreview(ctx, param(c, "code")));
    },
  );

  /* ---------------------------------------------------------- organisers */

  r.get(
    "/partner/events/:id/tickets",
    {
      tag: "Seating",
      summary: "Tickets and seats (first 100, searchable)",
      access: "partner",
      query: z.object({ q: z.string().optional().describe("Ticket number, name or seat, e.g. 'C F106'") }),
      returns: "{ total, checkedIn, seats, tickets }",
    },
    async (c) => {
      const { event } = await eventFor(c, ctx);
      return c.json(await seating.listTickets(ctx, event.id, c.req.query("q") ?? ""));
    },
  );

  r.post(
    "/partner/events/:id/tickets/import",
    {
      tag: "Seating",
      summary: "Check or import tickets from your ticketing system",
      description:
        "Send a CSV export (csv) or JSON (tickets). Matched by ticket number, so importing again updates seats. dryRun=1 checks only.",
      access: "partner",
      body: partnerSchemas.ticketImport,
      query: z.object({ dryRun: z.enum(["0", "1"]).optional() }),
      returns: "{ ok, applied, errors, warnings, total, added, updated, removed }",
    },
    async (c) => {
      const { auth, event } = await eventFor(c, ctx);
      const input = await body(c, partnerSchemas.ticketImport);
      const parsed = input.csv ? parseTicketCsv(input.csv) : { tickets: (input.tickets ?? []).map(clean), errors: [] };
      if (!input.csv && !input.tickets) throw bad("Send a CSV export as csv, or the tickets as JSON");
      const dryRun = c.req.query("dryRun") === "1";
      if (parsed.errors.length) {
        return c.json({ ok: false, applied: false, errors: parsed.errors, warnings: [], total: parsed.tickets.length, added: 0, updated: 0, removed: 0 });
      }
      const run = () => seating.importTickets(ctx, event.id, parsed.tickets, { dryRun, replace: input.replace });
      return c.json(dryRun ? await run() : await audited(ctx, auth, "tickets.import", event.id, run));
    },
  );

  r.post(
    "/partner/events/:id/tickets/test",
    {
      tag: "Seating",
      summary: "Fill free seats with made-up test tickets",
      description: "For trying seat guidance before the real import. Ticket numbers look like <EVENT>-TEST-100001.",
      access: "partner",
      body: partnerSchemas.testTickets,
      returns: "{ ok, applied, total, added }",
    },
    async (c) => {
      const { auth, event } = await eventFor(c, ctx);
      const { share } = await body(c, partnerSchemas.testTickets);
      return c.json(await audited(ctx, auth, "tickets.test", event.id, () => seating.generateTestTickets(ctx, event.id, share)));
    },
  );

  r.post(
    "/partner/events/:id/tickets/checkin",
    {
      tag: "Seating",
      summary: "Record a check-in at a gate",
      description: "Call this from your ticketing system or gate scanners. Guests' directions then start from that gate.",
      access: "partner",
      body: partnerSchemas.checkIn,
      returns: "{ ticketNumber, seat, checkedInAt, gate }",
    },
    async (c) => {
      const { auth, event } = await eventFor(c, ctx);
      const input = clean(await body(c, partnerSchemas.checkIn));
      return c.json(await audited(ctx, auth, "tickets.checkin", event.id, () => seating.checkIn(ctx, event.id, input)));
    },
  );

  r.get(
    "/partner/events/:id/seat-requests",
    { tag: "Seating", summary: "Guests' seat change requests (waiting first)", access: "partner", returns: "SeatRequest[]" },
    async (c) => {
      const { event } = await eventFor(c, ctx);
      return c.json(await seating.listRequests(ctx.db, event.id, { all: true }));
    },
  );

  r.post(
    "/partner/events/:id/seat-requests/:rid",
    {
      tag: "Seating",
      summary: "Approve (move the ticket) or decline a seat change",
      access: "partner",
      body: schemas.seatDecision,
      returns: "SeatRequest",
    },
    async (c) => {
      const { auth, scope } = await eventFor(c, ctx);
      const rid = param(c, "rid");
      const input = clean(await body(c, schemas.seatDecision));
      return c.json(await audited(ctx, auth, "seats.decide", rid, () => seating.decideRequest(ctx, scope, rid, input)));
    },
  );

  /* ---------------------------------------------------------- on-site staff */

  r.post(
    "/seat-requests/:rid",
    { tag: "On-site admin", summary: "Approve or decline a seat change (admin, dispatch)", access: "staff", body: schemas.seatDecision, returns: "SeatRequest" },
    async (c) => {
      const staff = requireStaff(c, "admin", "dispatch");
      const input = clean(await body(c, schemas.seatDecision));
      return c.json(await seating.decideRequest(ctx, staffScope(staff), param(c, "rid"), input));
    },
  );
}
