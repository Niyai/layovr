import { deleteCookie, setCookie } from "hono/cookie";
import type { Ctx, PartnerAuth, Scope } from "../context";
import { requirePartner, type C, type Router } from "../http";
import { sessionMaxAge, signSession } from "../lib/auth";
import { bad } from "../lib/errors";
import { limit } from "../lib/ratelimit";
import * as events from "../services/events";
import * as location from "../services/location";
import * as partners from "../services/partners";
import * as plans from "../services/plans";
import * as team from "../services/team";
import { body, clean, ip, partnerSchemas, planQuery, schemas } from "../schemas";

export const PARTNER_COOKIE = "lv_partner";
/** Partner session tokens are namespaced so a staff token can never pass as one. */
export const partnerToken = (userId: string, secret: string) => signSession(`p:${userId}`, secret);

const scopeFor = (auth: PartnerAuth, venueId: string): Scope => ({
  venueId,
  actorId: auth.userId ?? auth.keyId ?? auth.partnerId,
  actorName: auth.userName,
});

/** Runs a write for a partner and records it in the audit log, success or failure. */
async function audited<T>(ctx: Ctx, auth: PartnerAuth, action: string, target: string | null, run: () => Promise<T>): Promise<T> {
  events.requireWrite(auth);
  try {
    const out = await run();
    await partners.audit(ctx.db, auth, action, target, true);
    return out;
  } catch (e) {
    await partners.audit(ctx.db, auth, action, target, false, { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** The partner and the event they may manage, from the :id path param. */
async function eventFor(c: C, ctx: Ctx) {
  const auth = requirePartner(c);
  const event = await events.partnerEvent(ctx.db, auth, c.req.param("id") ?? "");
  return { auth, event, scope: scopeFor(auth, event.id as string) };
}

export function partnerRoutes(r: Router, ctx: Ctx) {
  /* ---------------------------------------------------------- account */

  const startSession = (c: C, userId: string) =>
    setCookie(c, PARTNER_COOKIE, partnerToken(userId, ctx.env.sessionSecret), {
      httpOnly: true,
      sameSite: "Lax",
      secure: ctx.env.production,
      path: "/",
      maxAge: sessionMaxAge * 2,
    });

  r.post(
    "/partner/signup",
    { tag: "Partner account", summary: "Create a partner (event planner) account", access: "public", body: partnerSchemas.signup, returns: "{ user, partner }" },
    async (c) => {
      limit(`signup:${ip(c)}`, 10, 60 * 60_000);
      const me = await partners.signup(ctx, clean(await body(c, partnerSchemas.signup)));
      startSession(c, me.user.id);
      return c.json(me);
    },
  );

  r.post(
    "/partner/login",
    { tag: "Partner account", summary: "Sign in to the dashboard", access: "public", body: partnerSchemas.login, returns: "{ user, partner }" },
    async (c) => {
      limit(`plogin:${ip(c)}`, 10, 5 * 60_000);
      const { email, password } = await body(c, partnerSchemas.login);
      const me = await partners.login(ctx, email, password);
      startSession(c, me.user.id);
      return c.json(me);
    },
  );

  r.post("/partner/logout", { tag: "Partner account", summary: "Sign out of the dashboard", access: "partner" }, (c) => {
    deleteCookie(c, PARTNER_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  r.get("/partner/me", { tag: "Partner account", summary: "Who is signed in (or which partner owns this API key)", access: "partner", returns: "{ user?, partner, via }" }, async (c) => {
    const auth = requirePartner(c);
    if (auth.userId) return c.json({ ...(await partners.me(ctx.db, auth.userId)), via: auth.channel });
    return c.json({ partner: { id: auth.partnerId, name: auth.partnerName }, via: auth.channel, scope: auth.scope });
  });

  r.get("/partner/demo-logins", { tag: "Partner account", summary: "Demo dashboard logins (local development only)", access: "public" }, (c) =>
    c.json(
      ctx.env.showDemoLogins
        ? [
            { label: "Event planner (owns MOONSHOT)", email: "planner@demo.layovr.app", password: "layovr-demo" },
            { label: "Layovr operator", email: "ops@demo.layovr.app", password: "layovr-demo" },
          ]
        : [],
    ),
  );

  /* ---------------------------------------------------------- events */

  r.get("/partner/events", { tag: "Events", summary: "Your events", access: "partner", returns: "EventSummary[]" }, async (c) =>
    c.json(await events.listEvents(ctx, requirePartner(c))),
  );

  r.post(
    "/partner/events",
    {
      tag: "Events",
      summary: "Create an event",
      description:
        "Starts as a draft. Pick a venue library template (templateCode), upload a plan file (plan), or neither for a blank plan. With deliveryMode=layovr_runners a runner request goes to the Layovr team.",
      access: "partner",
      body: partnerSchemas.createEvent,
      returns: "EventDetail",
    },
    async (c) => {
      const auth = requirePartner(c);
      const input = await body(c, partnerSchemas.createEvent);
      return c.json(
        await audited(ctx, auth, "events.create", input.name, () =>
          events.createEvent(ctx, auth, clean({ ...input, location: input.location ? clean(input.location) : undefined })),
        ),
      );
    },
  );

  r.get("/partner/events/:id", { tag: "Events", summary: "An event, with its publishing checklist", access: "partner", returns: "EventDetail" }, async (c) => {
    const { auth, event } = await eventFor(c, ctx);
    return c.json(await events.getEvent(ctx, auth, event.id));
  });

  r.patch(
    "/partner/events/:id",
    { tag: "Events", summary: "Update an event, or publish it (status: live)", access: "partner", body: partnerSchemas.updateEvent, returns: "EventDetail" },
    async (c) => {
      const { auth, event } = await eventFor(c, ctx);
      const patch = await body(c, partnerSchemas.updateEvent);
      return c.json(
        await audited(ctx, auth, "events.update", event.id, () =>
          events.updateEvent(ctx, auth, event.id, clean({ ...patch, location: patch.location ? clean(patch.location) : undefined })),
        ),
      );
    },
  );

  r.post(
    "/partner/events/:id/runner-request",
    { tag: "Events", summary: "Ask Layovr to run deliveries (runners from our team)", access: "partner", body: partnerSchemas.runnerRequest, returns: "EventDetail" },
    async (c) => {
      const { auth, event } = await eventFor(c, ctx);
      const input = clean(await body(c, partnerSchemas.runnerRequest));
      return c.json(await audited(ctx, auth, "events.runner_request", event.id, () => events.requestRunners(ctx, auth, event.id, input)));
    },
  );

  r.get(
    "/partner/events/:id/orders",
    { tag: "Events", summary: "Orders at the event (latest first)", access: "partner", returns: "{ code, status, totalKobo, createdAt, spot, runner }[]" },
    async (c) => {
      const { event } = await eventFor(c, ctx);
      const rows = await ctx.db.query(
        `select o.id, o.code, o.status, o.total_kobo, o.created_at, s.label as spot, st.name as runner
         from orders o left join spots s on s.id = o.spot_id left join staff st on st.id = o.runner_id
         where o.venue_id = $1 and o.status <> 'awaiting_payment' order by o.created_at desc limit 200`,
        [event.id],
      );
      return c.json(
        rows.map((o) => ({
          id: o.id,
          code: o.code,
          status: o.status,
          totalKobo: o.total_kobo,
          createdAt: new Date(o.created_at).toISOString(),
          spot: o.spot,
          runner: o.runner,
        })),
      );
    },
  );

  /* ---------------------------------------------------------- plan */

  r.get("/partner/events/:id/plan", { tag: "Venue plan", summary: "The event's plan (layovr-plan/1)", access: "partner", returns: "VenuePlan" }, async (c) => {
    const { event } = await eventFor(c, ctx);
    return c.json(await plans.exportPlan(ctx, event.id));
  });

  r.put(
    "/partner/events/:id/plan",
    {
      tag: "Venue plan",
      summary: "Check or save the event's plan",
      description: "Body is a layovr-plan/1 file (see docs/PLAN-STANDARD.md). dryRun=1 checks only; prune=1 removes areas and spots missing from the file.",
      access: "partner",
      query: planQuery,
      returns: "{ ok, applied, errors, warnings, removedAreas?, removedSpots?, deactivatedSpots? }",
    },
    async (c) => {
      const { auth, event } = await eventFor(c, ctx);
      const json = await c.req.json().catch(() => {
        throw bad("Expected a layovr-plan/1 JSON body");
      });
      const dryRun = c.req.query("dryRun") === "1";
      const prune = c.req.query("prune") === "1";
      if (dryRun) return c.json(await plans.importPlan(ctx, event.id, json, { dryRun: true }));
      return c.json(await audited(ctx, auth, "plan.apply", event.id, () => plans.importPlan(ctx, event.id, json, { prune })));
    },
  );

  r.patch(
    "/partner/events/:id/plan/geo",
    { tag: "Venue plan", summary: "Link the plan to GPS with control points", access: "partner", body: schemas.geo, returns: "{ residualM, metresPerUnit }" },
    async (c) => {
      const { auth, event } = await eventFor(c, ctx);
      const { points } = await body(c, schemas.geo);
      return c.json(await audited(ctx, auth, "plan.geo", event.id, () => location.saveGeo(ctx, event.id, points)));
    },
  );

  /* ---------------------------------------------------------- vendors */

  r.get("/partner/events/:id/vendors", { tag: "Vendors", summary: "Vendors and their menus", access: "partner", returns: "Vendor[] with products and contacts" }, async (c) => {
    const { event } = await eventFor(c, ctx);
    return c.json(await team.listVendors(ctx, event.id));
  });

  r.post("/partner/events/:id/vendors", { tag: "Vendors", summary: "Add a vendor", access: "partner", body: partnerSchemas.vendor, returns: "Vendor" }, async (c) => {
    const { auth, event, scope } = await eventFor(c, ctx);
    const input = clean(await body(c, partnerSchemas.vendor));
    return c.json(await audited(ctx, auth, "vendors.create", event.id, () => team.createVendor(ctx, scope, input)));
  });

  r.patch(
    "/partner/events/:id/vendors/:vid",
    { tag: "Vendors", summary: "Edit a vendor (open/close, stall, contacts)", access: "partner", body: partnerSchemas.vendor.partial(), returns: "Vendor" },
    async (c) => {
      const { auth, scope } = await eventFor(c, ctx);
      const vid = c.req.param("vid") ?? "";
      const patch = clean(await body(c, partnerSchemas.vendor.partial()));
      return c.json(await audited(ctx, auth, "vendors.update", vid, () => team.updateVendor(ctx, scope, vid, patch)));
    },
  );

  r.delete("/partner/events/:id/vendors/:vid", { tag: "Vendors", summary: "Remove a vendor (closed instead if they have orders)", access: "partner", returns: "{ removed }" }, async (c) => {
    const { auth, scope } = await eventFor(c, ctx);
    const vid = c.req.param("vid") ?? "";
    return c.json(await audited(ctx, auth, "vendors.remove", vid, () => team.removeVendor(ctx, scope, vid)));
  });

  r.post("/partner/events/:id/vendors/:vid/items", { tag: "Vendors", summary: "Add a menu item", access: "partner", body: partnerSchemas.product, returns: "Product" }, async (c) => {
    const { auth, scope } = await eventFor(c, ctx);
    const vid = c.req.param("vid") ?? "";
    const input = clean(await body(c, partnerSchemas.product));
    return c.json(await audited(ctx, auth, "items.create", vid, () => team.saveItem(ctx, scope, vid, null, input)));
  });

  r.put("/partner/events/:id/vendors/:vid/items/:pid", { tag: "Vendors", summary: "Edit a menu item (price, stock…)", access: "partner", body: partnerSchemas.product, returns: "Product" }, async (c) => {
    const { auth, scope } = await eventFor(c, ctx);
    const vid = c.req.param("vid") ?? "";
    const pid = c.req.param("pid") ?? "";
    const input = clean(await body(c, partnerSchemas.product));
    return c.json(await audited(ctx, auth, "items.update", pid, () => team.saveItem(ctx, scope, vid, pid, input)));
  });

  r.delete("/partner/events/:id/vendors/:vid/items/:pid", { tag: "Vendors", summary: "Delete a menu item", access: "partner" }, async (c) => {
    const { auth, scope } = await eventFor(c, ctx);
    const vid = c.req.param("vid") ?? "";
    const pid = c.req.param("pid") ?? "";
    await audited(ctx, auth, "items.remove", pid, () => team.removeItem(ctx, scope, vid, pid));
    return c.json({ ok: true });
  });

  r.post(
    "/partner/events/:id/vendors/:vid/invite",
    { tag: "Vendors", summary: "Create a link the vendor uses to fill in their own menu", description: "Single use, valid for 7 days.", access: "partner", returns: "{ url, expiresAt }" },
    async (c) => {
      const { auth, event } = await eventFor(c, ctx);
      const vid = c.req.param("vid") ?? "";
      return c.json(await audited(ctx, auth, "vendors.invite", vid, () => team.createInvite(ctx, event.id, vid)));
    },
  );

  /* ---------------------------------------------------------- staff */

  r.get("/partner/events/:id/staff", { tag: "Staff", summary: "Runners, dispatchers, admins and menu capture staff", access: "partner", returns: "TeamMember[]" }, async (c) => {
    const { event } = await eventFor(c, ctx);
    return c.json(await team.listStaff(ctx, event.id));
  });

  r.post(
    "/partner/events/:id/staff",
    {
      tag: "Staff",
      summary: "Add a team member",
      description: "Returns a 6-digit PIN once. Staff sign in at /staff with the event code + PIN. Layovr operators adding runners mark them as Layovr-provided.",
      access: "partner",
      body: partnerSchemas.staff,
      returns: "{ member, pin }",
    },
    async (c) => {
      const { auth, event } = await eventFor(c, ctx);
      const input = await body(c, partnerSchemas.staff);
      return c.json(
        await audited(ctx, auth, "staff.add", event.id, () =>
          team.addStaff(ctx, event.id, input, auth.role === "operator" ? "layovr" : "partner"),
        ),
      );
    },
  );

  r.patch("/partner/events/:id/staff/:sid", { tag: "Staff", summary: "Edit a team member", access: "partner", body: partnerSchemas.staffPatch, returns: "TeamMember" }, async (c) => {
    const { auth, event } = await eventFor(c, ctx);
    const sid = c.req.param("sid") ?? "";
    const patch = clean(await body(c, partnerSchemas.staffPatch));
    return c.json(await audited(ctx, auth, "staff.update", sid, () => team.updateMember(ctx, event.id, sid, patch)));
  });

  r.delete("/partner/events/:id/staff/:sid", { tag: "Staff", summary: "Remove a team member (taken off shift if they have history)", access: "partner", returns: "{ removed }" }, async (c) => {
    const { auth, event } = await eventFor(c, ctx);
    const sid = c.req.param("sid") ?? "";
    return c.json(await audited(ctx, auth, "staff.remove", sid, () => team.removeMember(ctx, event.id, sid)));
  });

  r.post("/partner/events/:id/staff/:sid/reset-pin", { tag: "Staff", summary: "Issue a new PIN (shown once)", access: "partner", returns: "{ pin }" }, async (c) => {
    const { auth, event } = await eventFor(c, ctx);
    const sid = c.req.param("sid") ?? "";
    return c.json(await audited(ctx, auth, "staff.reset_pin", sid, () => team.resetPin(ctx, event.id, sid)));
  });

  /* ---------------------------------------------------------- API keys */

  r.get("/partner/keys", { tag: "API keys", summary: "Your API keys (secrets are never shown again)", access: "partner" }, async (c) =>
    c.json(await partners.listApiKeys(ctx, requirePartner(c))),
  );

  r.post(
    "/partner/keys",
    { tag: "API keys", summary: "Create an API key (dashboard only; the key is shown once)", access: "partner", body: partnerSchemas.apiKey, returns: "{ id, key, prefix, scope }" },
    async (c) => {
      const auth = requirePartner(c);
      const input = await body(c, partnerSchemas.apiKey);
      return c.json(await audited(ctx, auth, "keys.create", input.name, () => partners.createApiKey(ctx, auth, input)));
    },
  );

  r.delete("/partner/keys/:kid", { tag: "API keys", summary: "Revoke an API key", access: "partner" }, async (c) => {
    const auth = requirePartner(c);
    const kid = c.req.param("kid") ?? "";
    await audited(ctx, auth, "keys.revoke", kid, () => partners.revokeApiKey(ctx, auth, kid));
    return c.json({ ok: true });
  });

  /* ---------------------------------------------------------- Layovr operators */

  r.get("/operator/runner-requests", { tag: "Layovr operators", summary: "Events asking Layovr to run deliveries", access: "operator" }, async (c) =>
    c.json(await events.listRunnerRequests(ctx, requirePartner(c))),
  );

  r.post(
    "/operator/events/:id/runner-request",
    { tag: "Layovr operators", summary: "Approve or decline a runner request", access: "operator", body: partnerSchemas.runnerDecision, returns: "EventDetail" },
    async (c) => {
      const auth = requirePartner(c);
      const id = c.req.param("id") ?? "";
      const input = clean(await body(c, partnerSchemas.runnerDecision));
      return c.json(await audited(ctx, auth, "operator.runner_decision", id, () => events.decideRunnerRequest(ctx, auth, id, input)));
    },
  );
}
