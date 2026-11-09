import { VENUE_LIBRARY, checkPlan, type VenuePlan } from "@layovr/shared";
import { z } from "zod";
import type { Ctx, PartnerAuth, Scope } from "../context";
import * as events from "../services/events";
import * as plans from "../services/plans";
import * as team from "../services/team";
import { clean, partnerSchemas } from "../schemas";

/**
 * MCP tools. Each one wraps the same service functions as the REST API, so an
 * assistant can do exactly what the dashboard can, under the same permissions.
 * Write tools return a preview unless called with confirm: true.
 */

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  /** Changes live data; previews unless confirm: true. */
  write: boolean;
  input: z.ZodRawShape;
  run: (ctx: Ctx, auth: PartnerAuth, args: Record<string, unknown>) => Promise<unknown>;
};

const eventId = z.string().describe("Event id from events_list (starts with v_)");
const confirm = z
  .boolean()
  .optional()
  .describe("Leave out (or false) to preview what would change. Set true only after the user agrees.");

const scopeFor = (auth: PartnerAuth, venueId: string): Scope => ({
  venueId,
  actorId: auth.keyId ?? auth.partnerId,
  actorName: auth.userName,
});

async function own(ctx: Ctx, auth: PartnerAuth, id: unknown) {
  return events.partnerEvent(ctx.db, auth, String(id));
}

const preview = (summary: string, details: unknown = undefined) => ({
  preview: true,
  summary,
  ...(details === undefined ? {} : { details }),
  next: "Nothing has changed yet. Show this to the user and call again with confirm: true to apply.",
});

/** Loads the plan, applies a change to it, then previews (plan check) or saves it. */
async function editPlan(
  ctx: Ctx,
  auth: PartnerAuth,
  args: Record<string, unknown>,
  what: string,
  change: (plan: VenuePlan) => VenuePlan,
) {
  const v = await own(ctx, auth, args.eventId);
  const plan = change(await plans.exportPlan(ctx, v.id));
  if (!args.confirm) {
    const check = checkPlan(plan);
    return preview(what, { ok: check.ok, errors: check.errors, warnings: check.warnings.slice(0, 10) });
  }
  events.requireWrite(auth);
  const res = await plans.importPlan(ctx, v.id, plan, { prune: true });
  return { applied: res.applied, summary: what, errors: res.errors, warnings: res.warnings.slice(0, 10) };
}

export const TOOLS: ToolDef[] = [
  /* ---------------------------------------------------------------- read */
  {
    name: "events_list",
    title: "List events",
    description: "List this partner's events with status, dates, location and counts (areas, spots, vendors, staff, orders).",
    write: false,
    input: {},
    run: (ctx, auth) => events.listEvents(ctx, auth),
  },
  {
    name: "events_get",
    title: "Get an event",
    description: "One event with fees, delivery mode, runner request and the checklist of what's needed before publishing.",
    write: false,
    input: { eventId },
    run: (ctx, auth, a) => events.getEvent(ctx, auth, String(a.eventId)),
  },
  {
    name: "venue_templates_list",
    title: "List venue templates",
    description: "Starting plans for popular Lagos venues (Landmark Centre, Eko Convention Centre, National Theatre…) and generic layouts (ballroom, expo, stadium, festival). Use the code with events_create.",
    write: false,
    input: { search: z.string().optional().describe("Filter by name or area, e.g. 'Victoria Island'") },
    run: async (_ctx, _auth, a) => {
      const q = String(a.search ?? "").toLowerCase();
      return VENUE_LIBRARY.filter((t) => !q || `${t.name} ${t.area ?? ""} ${t.code}`.toLowerCase().includes(q)).map(
        ({ plan: _plan, sources: _s, ...t }) => t,
      );
    },
  },
  {
    name: "plans_get",
    title: "Get an event's plan",
    description: "The event's venue plan as a layovr-plan/1 file: canvas, floors (levels), sections, areas with shapes, QR spots and markers (entrances, stairs…).",
    write: false,
    input: { eventId },
    run: async (ctx, auth, a) => plans.exportPlan(ctx, (await own(ctx, auth, a.eventId)).id),
  },
  {
    name: "plans_validate",
    title: "Check a plan file",
    description: "Check a layovr-plan/1 file and explain any errors and warnings in plain words. Changes nothing.",
    write: false,
    input: { plan: z.record(z.unknown()).describe("A layovr-plan/1 object") },
    run: async (_ctx, _auth, a) => {
      const { plan: _p, ...rest } = checkPlan(a.plan);
      return rest;
    },
  },
  {
    name: "vendors_list",
    title: "List vendors",
    description: "Vendors at an event with their menus (items, prices in kobo, stock) and contact details.",
    write: false,
    input: { eventId },
    run: async (ctx, auth, a) => team.listVendors(ctx, (await own(ctx, auth, a.eventId)).id),
  },
  {
    name: "staff_list",
    title: "List staff",
    description: "Runners, dispatchers, on-site admins and menu capture staff at an event. PINs are never shown.",
    write: false,
    input: { eventId },
    run: async (ctx, auth, a) => team.listStaff(ctx, (await own(ctx, auth, a.eventId)).id),
  },
  {
    name: "orders_list",
    title: "List orders",
    description: "Recent paid orders at an event with status, total, delivery spot and runner.",
    write: false,
    input: { eventId, status: z.enum(["paid", "assigned", "buying", "on_the_way", "delivered", "not_delivered", "cancelled"]).optional() },
    run: async (ctx, auth, a) => {
      const v = await own(ctx, auth, a.eventId);
      const rows = await ctx.db.query(
        `select o.code, o.status, o.total_kobo, o.created_at, s.label as spot, st.name as runner
         from orders o left join spots s on s.id = o.spot_id left join staff st on st.id = o.runner_id
         where o.venue_id = $1 and o.status <> 'awaiting_payment' and ($2::text is null or o.status = $2)
         order by o.created_at desc limit 100`,
        [v.id, a.status ?? null],
      );
      return rows.map((o) => ({ code: o.code, status: o.status, totalKobo: o.total_kobo, createdAt: new Date(o.created_at).toISOString(), spot: o.spot, runner: o.runner }));
    },
  },
  {
    name: "dispatch_board",
    title: "Dispatch board summary",
    description: "Live picture of an event: orders by status, late orders, and runners on shift / busy.",
    write: false,
    input: { eventId },
    run: async (ctx, auth, a) => {
      const v = await own(ctx, auth, a.eventId);
      const byStatus = await ctx.db.query(
        "select status, count(*)::int as n from orders where venue_id = $1 and status <> 'awaiting_payment' group by status",
        [v.id],
      );
      const [late] = await ctx.db.query(
        "select count(*)::int as n from orders where venue_id = $1 and status in ('assigned','buying','on_the_way') and eta_at < now()",
        [v.id],
      );
      const runners = await ctx.db.query(
        `select s.name, s.on_shift, exists (select 1 from orders o where o.runner_id = s.id and o.status in ('assigned','buying','on_the_way')) as busy
         from staff s where s.venue_id = $1 and s.role = 'runner' order by s.name`,
        [v.id],
      );
      return {
        orders: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
        late: late?.n ?? 0,
        runners: runners.map((r) => ({ name: r.name, onShift: r.on_shift, busy: r.busy })),
      };
    },
  },

  /* ---------------------------------------------------------------- write */
  {
    name: "events_create",
    title: "Create an event",
    description:
      "Create a draft event. Pick a templateCode from venue_templates_list (or leave it out for a blank plan). Location needs an address with lat/lng. deliveryMode layovr_runners asks the Layovr team to supply runners.",
    write: true,
    input: { ...partnerSchemas.createEvent.omit({ plan: true }).shape, confirm },
    run: async (ctx, auth, a) => {
      const input = partnerSchemas.createEvent.parse(a);
      if (!a.confirm) {
        const template = input.templateCode ? VENUE_LIBRARY.find((t) => t.code === input.templateCode?.toUpperCase()) : undefined;
        if (input.templateCode && !template) return { error: `No template ${input.templateCode}. Use venue_templates_list.` };
        return preview(`Create draft event "${input.name}"`, {
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          location: input.location?.address ?? "not set",
          startingPlan: template ? `${template.name} (${template.dataQuality})` : "blank plan",
          deliveries: input.deliveryMode === "layovr_runners" ? `Layovr runners requested (${input.runnersNeeded ?? "?"})` : "own runners",
        });
      }
      const e = await events.createEvent(ctx, auth, clean({ ...input, location: input.location ? clean(input.location) : undefined }));
      return { created: true, eventId: e.id, code: e.code, status: e.status, checklist: e.checklist };
    },
  },
  {
    name: "events_update",
    title: "Update an event",
    description: "Change name, dates, location, fees (feePct e.g. 0.04, flat fee in kobo) or delivery mode. Use events_publish to publish.",
    write: true,
    input: { eventId, ...partnerSchemas.updateEvent.omit({ status: true, floorPlanUrl: true }).shape, confirm },
    run: async (ctx, auth, a) => {
      const v = await own(ctx, auth, a.eventId);
      const { eventId: _e, confirm: c, ...rest } = a;
      const patch = partnerSchemas.updateEvent.omit({ status: true, floorPlanUrl: true }).parse(rest);
      if (!c) return preview(`Update "${v.name}"`, patch);
      const e = await events.updateEvent(ctx, auth, v.id, clean({ ...patch, location: patch.location ? clean(patch.location) : undefined }));
      return { updated: true, eventId: e.id };
    },
  },
  {
    name: "events_publish",
    title: "Publish or unpublish an event",
    description: "publish: true makes the event visible to buyers (needs a plan with spots and at least one vendor with items). false takes it back to draft.",
    write: true,
    input: { eventId, publish: z.boolean(), confirm },
    run: async (ctx, auth, a) => {
      const v = await own(ctx, auth, a.eventId);
      const detail = await events.getEvent(ctx, auth, v.id);
      if (!a.confirm) {
        return preview(a.publish ? `Publish "${v.name}" to buyers` : `Take "${v.name}" back to draft`, { checklist: detail.checklist });
      }
      const e = await events.updateEvent(ctx, auth, v.id, { status: a.publish ? "live" : "draft" });
      return { status: e.status, buyerUrl: e.buyerUrl };
    },
  },
  {
    name: "plans_apply",
    title: "Replace an event's plan",
    description: "Save a whole layovr-plan/1 file to the event (get the current one with plans_get, edit, apply). With prune, areas/spots missing from the file are removed.",
    write: true,
    input: { eventId, plan: z.record(z.unknown()), prune: z.boolean().optional(), confirm },
    run: async (ctx, auth, a) => {
      const v = await own(ctx, auth, a.eventId);
      if (!a.confirm) {
        const r = await plans.importPlan(ctx, v.id, a.plan, { dryRun: true });
        return preview(`Replace the plan of "${v.name}"`, r);
      }
      events.requireWrite(auth);
      return plans.importPlan(ctx, v.id, a.plan, { prune: Boolean(a.prune) });
    },
  },
  {
    name: "areas_upsert",
    title: "Add or change an area",
    description: "Add or edit one area (hall, lounge, food court…) by code. Shapes: rect {x,y,w,h}, circle {cx,cy,r}, sector {cx,cy,r0,r1,a0,a1}, polygon {points}. Units are the plan canvas.",
    write: true,
    input: {
      eventId,
      area: z
        .object({
          code: z.string(),
          name: z.string(),
          section: z.string().optional(),
          level: z.number().int().optional(),
          kind: z.string().optional(),
          access: z.enum(["open", "restricted"]).optional(),
          shape: z.record(z.unknown()),
          capacity: z.number().int().optional(),
          notes: z.string().optional(),
        })
        .describe("The area; matched by code"),
      confirm,
    },
    run: (ctx, auth, a) => {
      const area = a.area as Partial<VenuePlan["areas"][number]> & Pick<VenuePlan["areas"][number], "code" | "name" | "shape">;
      return editPlan(ctx, auth, a, `Save area ${area.code} (${area.name})`, (p) => ({
        ...p,
        areas: [
          ...p.areas.filter((x) => x.code !== area.code),
          { ...area, kind: area.kind ?? "hall", access: area.access ?? "open", approximate: area.approximate ?? false },
        ],
      }));
    },
  },
  {
    name: "spots_upsert",
    title: "Add or change a QR spot",
    description: "Add or edit a delivery spot (where a QR card sits). Code format: <section><level>-<area>-<n>, e.g. B0-EXH1-3.",
    write: true,
    input: {
      eventId,
      spot: z.object({
        code: z.string(),
        area: z.string().describe("Area code"),
        label: z.string(),
        x: z.number(),
        y: z.number(),
        landmark: z.string().optional(),
        directions: z.string().optional(),
        active: z.boolean().optional(),
      }),
      confirm,
    },
    run: (ctx, auth, a) => {
      const spot = a.spot as Omit<VenuePlan["spots"][number], "active"> & { active?: boolean };
      return editPlan(ctx, auth, a, `Save spot ${spot.code} (${spot.label})`, (p) => ({
        ...p,
        spots: [...p.spots.filter((x) => x.code !== spot.code), { ...spot, active: spot.active ?? true }],
      }));
    },
  },
  {
    name: "entrances_block",
    title: "Block an entrance",
    description: "Mark an entrance (or stairs, lift…) as blocked, by its label from plans_get, with a reason runners will see.",
    write: true,
    input: { eventId, label: z.string(), note: z.string().optional(), confirm },
    run: (ctx, auth, a) =>
      editPlan(ctx, auth, a, `Block "${String(a.label)}"`, (p) => {
        if (!p.markers.some((m) => m.label === a.label)) throw new Error(`No marker labelled "${String(a.label)}"`);
        return { ...p, markers: p.markers.map((m) => (m.label === a.label ? { ...m, status: "blocked" as const, ...(a.note ? { note: String(a.note) } : {}) } : m)) };
      }),
  },
  {
    name: "entrances_unblock",
    title: "Reopen an entrance",
    description: "Mark a blocked entrance (or stairs, lift…) as open again.",
    write: true,
    input: { eventId, label: z.string(), confirm },
    run: (ctx, auth, a) =>
      editPlan(ctx, auth, a, `Reopen "${String(a.label)}"`, (p) => {
        if (!p.markers.some((m) => m.label === a.label)) throw new Error(`No marker labelled "${String(a.label)}"`);
        return { ...p, markers: p.markers.map((m) => (m.label === a.label ? { ...m, status: "open" as const } : m)) };
      }),
  },
  {
    name: "vendors_upsert",
    title: "Add or edit a vendor",
    description: "Add a vendor (leave vendorId out) or edit one. zoneId comes from the plan's areas (events_get / plans_get).",
    write: true,
    input: { eventId, vendorId: z.string().optional(), vendor: partnerSchemas.vendor.partial(), confirm },
    run: async (ctx, auth, a) => {
      const v = await own(ctx, auth, a.eventId);
      const scope = scopeFor(auth, v.id);
      if (a.vendorId) {
        const patch = clean(partnerSchemas.vendor.partial().parse(a.vendor));
        if (!a.confirm) return preview(`Update vendor ${String(a.vendorId)}`, patch);
        events.requireWrite(auth);
        return team.updateVendor(ctx, scope, String(a.vendorId), patch);
      }
      const input = clean(partnerSchemas.vendor.parse(a.vendor));
      if (!a.confirm) return preview(`Add vendor "${input.name}" to "${v.name}"`, input);
      events.requireWrite(auth);
      return team.createVendor(ctx, scope, input);
    },
  },
  {
    name: "items_upsert",
    title: "Add or edit a menu item",
    description: "Add an item to a vendor's menu (leave itemId out) or edit one. priceKobo is in kobo: ₦1,500 = 150000.",
    write: true,
    input: { eventId, vendorId: z.string(), itemId: z.string().optional(), item: partnerSchemas.product, confirm },
    run: async (ctx, auth, a) => {
      const v = await own(ctx, auth, a.eventId);
      const item = clean(partnerSchemas.product.parse(a.item));
      if (!a.confirm) return preview(`${a.itemId ? "Update" : "Add"} "${item.name}" at ₦${(item.priceKobo / 100).toLocaleString("en-NG")}`, item);
      events.requireWrite(auth);
      return team.saveItem(ctx, scopeFor(auth, v.id), String(a.vendorId), a.itemId ? String(a.itemId) : null, item);
    },
  },
  {
    name: "vendor_invite_create",
    title: "Create a vendor invite link",
    description: "A single-use link (7 days) the vendor opens to fill in their own stall and menu. Share it by WhatsApp or SMS.",
    write: true,
    input: { eventId, vendorId: z.string(), confirm },
    run: async (ctx, auth, a) => {
      const v = await own(ctx, auth, a.eventId);
      if (!a.confirm) return preview(`Create an invite link for vendor ${String(a.vendorId)}`);
      events.requireWrite(auth);
      return team.createInvite(ctx, v.id, String(a.vendorId));
    },
  },
  {
    name: "staff_add",
    title: "Add a team member",
    description: "Add a runner, dispatcher, on-site admin or menu capture person. Returns a 6-digit PIN once; they sign in at /staff with the event code + PIN.",
    write: true,
    input: { eventId, staff: partnerSchemas.staff, confirm },
    run: async (ctx, auth, a) => {
      const v = await own(ctx, auth, a.eventId);
      const input = partnerSchemas.staff.parse(a.staff);
      if (!a.confirm) return preview(`Add ${input.role} "${input.name}" to "${v.name}"`, input);
      events.requireWrite(auth);
      const { member, pin } = await team.addStaff(ctx, v.id, input, auth.role === "operator" ? "layovr" : "partner");
      return { member, pin, signIn: `Event code ${v.code} + PIN ${pin} at ${ctx.env.publicAppUrl}/staff`, note: "Share the PIN privately; it isn't shown again." };
    },
  },
  {
    name: "runner_request",
    title: "Ask Layovr to run deliveries",
    description: "Request Layovr runners for an event. The Layovr team approves and assigns them.",
    write: true,
    input: { eventId, ...partnerSchemas.runnerRequest.shape, confirm },
    run: async (ctx, auth, a) => {
      const v = await own(ctx, auth, a.eventId);
      const input = clean(partnerSchemas.runnerRequest.parse(a));
      if (!a.confirm) return preview(`Ask Layovr for ${input.runnersNeeded} runners at "${v.name}"`, input);
      const e = await events.requestRunners(ctx, auth, v.id, input);
      return { runnerRequest: e.runnerRequest };
    },
  },
];
