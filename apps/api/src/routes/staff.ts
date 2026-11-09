import { z } from "zod";
import { staffScope, type Ctx, type StaffRow } from "../context";
import { resetData } from "../db/seed";
import { param, requireStaff, type C, type Router } from "../http";
import { SESSION_COOKIE, checkPin, sessionMaxAge, signSession } from "../lib/auth";
import { HttpError, bad, forbidden } from "../lib/errors";
import { notify } from "../lib/events";
import { limit } from "../lib/ratelimit";
import { deleteCookie, setCookie } from "hono/cookie";
import * as admin from "../services/admin";
import * as location from "../services/location";
import { toStaff } from "../services/mappers";
import * as orders from "../services/orders";
import * as plans from "../services/plans";
import { body, clean, ip, planQuery, schemas } from "../schemas";

/** Event staff: PIN sign-in, dispatch and runner actions, on-site admin and menu capture. */
export function staffRoutes(r: Router, ctx: Ctx) {
  r.post(
    "/auth/login",
    {
      tag: "Event staff",
      summary: "Staff sign-in with event code + PIN",
      description: "Sets an httpOnly session cookie. Rate-limited per IP.",
      access: "public",
      body: schemas.login,
      returns: "Staff",
    },
    async (c) => {
      limit(`login:${ip(c)}`, 10, 5 * 60_000);
      const { code, pin } = await body(c, schemas.login);
      const people = await ctx.db.query<StaffRow>(
        "select s.* from staff s join venues v on v.id = s.venue_id where v.code = $1",
        [code],
      );
      const me = people.find((s) => checkPin(pin, s.pin_hash));
      if (!me) throw new HttpError(401, "That event code and PIN don't match anyone.");
      setCookie(c, SESSION_COOKIE, signSession(me.id, ctx.env.sessionSecret), {
        httpOnly: true,
        sameSite: "Lax",
        secure: ctx.env.production,
        path: "/",
        maxAge: sessionMaxAge,
      });
      return c.json(toStaff(me));
    },
  );

  r.post("/auth/logout", { tag: "Event staff", summary: "Staff sign-out", access: "staff" }, async (c) => {
    const staff = c.get("staff");
    if (staff) await location.clearRunnerLocation(ctx.db, staff.id, true);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  /* ---------------------------------------------------------- dispatch + runner */

  const orderAction = (
    path: string,
    summary: string,
    bodySchema: z.ZodTypeAny | undefined,
    run: (c: C, staff: StaffRow, orderId: string) => Promise<unknown>,
  ) =>
    r.post(
      `/orders/:id/${path}`,
      { tag: "Dispatch & runners", summary, access: "staff", ...(bodySchema ? { body: bodySchema } : {}) },
      async (c) => {
        const staff = requireStaff(c);
        const result = await run(c, staff, param(c, "id"));
        return c.json(result ?? { ok: true });
      },
    );

  orderAction("assign", "Assign a runner and ETA", schemas.assign, async (c, s, oid) => {
    const b = await body(c, schemas.assign);
    await orders.assignRunner(ctx, s, oid, b.runnerId, b.etaMinutes);
  });
  orderAction("eta", "Change the ETA", schemas.eta, async (c, s, oid) => {
    await orders.setEta(ctx, s, oid, (await body(c, schemas.eta)).etaMinutes);
  });
  orderAction("start-buying", "Runner is at the stall", undefined, (_c, s, oid) => orders.startBuying(ctx, s, oid));
  orderAction("purchases", "Log what was paid at a stall", schemas.purchase, async (c, s, oid) => {
    await orders.logPurchase(ctx, s, oid, clean(await body(c, schemas.purchase)));
  });
  orderAction("items/:itemId", "Swap, drop or reprice an item", schemas.item, async (c, s, oid) => {
    const b = clean(await body(c, schemas.item));
    await orders.setItemStatus(ctx, s, oid, { ...b, itemId: param(c, "itemId") });
  });
  orderAction("stops/:stopId/unavailable", "A stall can't fill its part", undefined, (c, s, oid) =>
    orders.markStopUnavailable(ctx, s, oid, param(c, "stopId")),
  );
  orderAction("on-the-way", "Runner heads to the buyer", undefined, (_c, s, oid) => orders.goOnTheWay(ctx, s, oid));
  orderAction("arrive", "Runner is in the buyer's area (colour match)", undefined, (_c, s, oid) => orders.arriveNearBuyer(ctx, s, oid));
  orderAction("deliver", "Hand over with the buyer's PIN", schemas.pin, async (c, s, oid) => {
    limit(`deliver:${oid}`, 8, 10 * 60_000);
    const { pin } = await body(c, schemas.pin);
    return { ok: await orders.deliver(ctx, s, oid, pin) };
  });
  orderAction("not-delivered", "Couldn't find the buyer", schemas.note, async (c, s, oid) => {
    await orders.markNotDelivered(ctx, s, oid, (await body(c, schemas.note)).note);
  });
  orderAction("cancel", "Cancel and mark refund due", schemas.reason, async (c, s, oid) => {
    await orders.cancelOrder(ctx, s, oid, (await body(c, schemas.reason)).reason);
  });

  r.post(
    "/runner/location",
    { tag: "Dispatch & runners", summary: "Runner phone reports its position (only while on an order)", access: "staff", body: schemas.location, returns: "{ sharing }" },
    async (c) => {
      const staff = requireStaff(c);
      limit(`loc:${staff.id}`, 30, 60_000);
      return c.json(await location.reportRunnerLocation(ctx, staff, await body(c, schemas.location)));
    },
  );

  r.patch("/staff/:id", { tag: "Dispatch & runners", summary: "Shift, float or restricted access for a team member", access: "staff", body: schemas.staff }, async (c) => {
    const staff = requireStaff(c, "admin", "dispatch");
    await admin.updateStaff(ctx, staffScope(staff), param(c, "id"), clean(await body(c, schemas.staff)));
    return c.json({ ok: true });
  });

  /* ---------------------------------------------------------- on-site admin + menu capture */

  const adminOnly = (c: C) => staffScope(requireStaff(c, "admin"));
  const capture = (c: C) => staffScope(requireStaff(c, "admin", "capture"));

  r.patch("/admin/venues/:id", { tag: "On-site admin", summary: "Fees, name, tracing image", access: "staff", body: schemas.venue }, async (c) => {
    await admin.updateVenue(ctx, adminOnly(c), param(c, "id"), clean(await body(c, schemas.venue)));
    return c.json({ ok: true });
  });
  r.patch("/admin/zones/:id", { tag: "On-site admin", summary: "Rename an area or mark it restricted", access: "staff", body: schemas.zone }, async (c) => {
    await admin.updateZone(ctx, adminOnly(c), param(c, "id"), clean(await body(c, schemas.zone)));
    return c.json({ ok: true });
  });
  r.put("/admin/spots/:id", { tag: "On-site admin", summary: "Create or edit a QR spot", access: "staff", body: schemas.spot }, async (c) => {
    const spot = clean(await body(c, schemas.spot));
    await admin.upsertSpot(ctx, adminOnly(c), { ...spot, id: param(c, "id"), venueId: "" });
    return c.json({ ok: true });
  });
  r.delete("/admin/spots/:id", { tag: "On-site admin", summary: "Remove a spot (deactivated if orders use it)", access: "staff" }, async (c) => {
    await admin.deleteSpot(ctx, adminOnly(c), param(c, "id"));
    return c.json({ ok: true });
  });
  r.put("/admin/vendors/:id", { tag: "On-site admin", summary: "Menu capture: create or edit a stall", access: "staff", body: schemas.vendor }, async (c) => {
    const v = clean(await body(c, schemas.vendor));
    await admin.upsertVendor(ctx, capture(c), { ...v, id: param(c, "id"), venueId: "" });
    return c.json({ ok: true });
  });
  r.put("/admin/products/:id", { tag: "On-site admin", summary: "Menu capture: create or edit an item", access: "staff", body: schemas.product }, async (c) => {
    const p = clean(await body(c, schemas.product));
    await admin.upsertProduct(ctx, capture(c), { ...p, id: param(c, "id") });
    return c.json({ ok: true });
  });
  r.delete("/admin/products/:id", { tag: "On-site admin", summary: "Delete an item", access: "staff" }, async (c) => {
    await admin.deleteProduct(ctx, adminOnly(c), param(c, "id"));
    return c.json({ ok: true });
  });

  r.get("/admin/plan", { tag: "On-site admin", summary: "Download the venue plan (layovr-plan/1)", access: "staff", returns: "VenuePlan" }, async (c) =>
    c.json(await plans.exportPlan(ctx, adminOnly(c).venueId)),
  );
  r.patch("/admin/plan/geo", { tag: "On-site admin", summary: "Link the plan to GPS with control points", access: "staff", body: schemas.geo, returns: "{ residualM, metresPerUnit }" }, async (c) => {
    const { points } = await body(c, schemas.geo);
    return c.json(await location.saveGeo(ctx, adminOnly(c).venueId, points));
  });
  r.post(
    "/admin/plan",
    { tag: "On-site admin", summary: "Check or apply a plan file", access: "staff", query: planQuery, returns: "{ ok, applied, errors, warnings }" },
    async (c) => {
      const scope = adminOnly(c);
      const json = await c.req.json().catch(() => {
        throw bad("Expected a JSON body");
      });
      return c.json(
        await plans.importPlan(ctx, scope.venueId, json, {
          dryRun: c.req.query("dryRun") === "1",
          prune: c.req.query("prune") === "1",
        }),
      );
    },
  );

  r.post("/admin/reset", { tag: "On-site admin", summary: "Reset all demo data (dev only)", access: "staff" }, async (c) => {
    const staff = requireStaff(c, "admin");
    if (!ctx.env.allowReset) throw forbidden();
    await resetData(ctx.db);
    notify({ venueId: staff.venue_id });
    return c.json({ ok: true });
  });
}
