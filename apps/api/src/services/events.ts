import {
  PLAN_STANDARD,
  checkPlan,
  fitGeo,
  uid,
  venueTemplate,
  type PlanMeta,
  type VenuePlan,
  type VenuePlanInput,
} from "@layovr/shared";
import type { Ctx, PartnerAuth } from "../context";
import type { Queryable, Row } from "../db/client";
import { HttpError, bad, conflict, forbidden, notFound } from "../lib/errors";
import { notify } from "../lib/events";
import { persistImage } from "../lib/images";
import { applyPlan } from "./plans";

/**
 * Events: a partner's own space (a venues row) with its plan, vendors, staff and
 * orders. Planners start from the venue library, an uploaded plan or a blank plan.
 */

export type EventSummary = {
  id: string;
  code: string;
  name: string;
  status: "draft" | "live" | "ended";
  startsAt: string | null;
  endsAt: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  templateCode: string | null;
  deliveryMode: "own_runners" | "layovr_runners";
  runnerRequest: { status: string; runnersNeeded: number | null; note: string | null; reply: string | null };
  partnerId: string | null;
  counts: { areas: number; spots: number; vendors: number; items: number; staff: number; orders: number };
};

export type EventDetail = EventSummary & {
  city: string;
  feePct: number;
  feeFlatKobo: number;
  absorbLimitKobo: number;
  floorPlanUrl: string | null;
  /** What's still needed before publishing. */
  checklist: { key: string; label: string; done: boolean }[];
  buyerUrl: string;
};

const iso = (v: unknown) => (v ? new Date(String(v instanceof Date ? v.toISOString() : v)).toISOString() : null);

/** The event, if this partner may see it (operators see every event). */
export async function partnerEvent(q: Queryable, auth: PartnerAuth, id: string): Promise<Row> {
  const [v] = await q.query("select * from venues where id = $1", [id]);
  if (!v || (auth.role !== "operator" && v.partner_id !== auth.partnerId)) {
    throw notFound("Event not found");
  }
  return v;
}

export function requireWrite(auth: PartnerAuth) {
  if (auth.scope !== "write") throw forbidden("This API key is read-only");
}

async function counts(q: Queryable, ids: string[]) {
  if (!ids.length) return new Map<string, EventSummary["counts"]>();
  const rows = await q.query(
    `select v.id,
       (select count(*)::int from zones where venue_id = v.id) as areas,
       (select count(*)::int from spots where venue_id = v.id and active) as spots,
       (select count(*)::int from vendors where venue_id = v.id) as vendors,
       (select count(*)::int from products where venue_id = v.id) as items,
       (select count(*)::int from staff where venue_id = v.id) as staff,
       (select count(*)::int from orders where venue_id = v.id and status <> 'awaiting_payment') as orders
     from venues v where v.id = any($1)`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id as string, { areas: r.areas, spots: r.spots, vendors: r.vendors, items: r.items, staff: r.staff, orders: r.orders }]));
}

function summary(v: Row, c: EventSummary["counts"] | undefined): EventSummary {
  return {
    id: v.id,
    code: v.code,
    name: v.name,
    status: v.status,
    startsAt: iso(v.starts_at),
    endsAt: iso(v.ends_at),
    address: v.address,
    lat: v.lat,
    lng: v.lng,
    templateCode: v.template_code,
    deliveryMode: v.delivery_mode,
    runnerRequest: {
      status: v.runner_request_status,
      runnersNeeded: v.runners_needed,
      note: v.runner_request_note,
      reply: v.runner_request_reply,
    },
    partnerId: v.partner_id,
    counts: c ?? { areas: 0, spots: 0, vendors: 0, items: 0, staff: 0, orders: 0 },
  };
}

export async function listEvents(ctx: Ctx, auth: PartnerAuth): Promise<EventSummary[]> {
  const rows =
    auth.role === "operator"
      ? await ctx.db.query("select * from venues where partner_id is not null order by created_at desc")
      : await ctx.db.query("select * from venues where partner_id = $1 order by created_at desc", [auth.partnerId]);
  const c = await counts(ctx.db, rows.map((r) => r.id));
  return rows.map((r) => summary(r, c.get(r.id)));
}

export async function getEvent(ctx: Ctx, auth: PartnerAuth, id: string): Promise<EventDetail> {
  const v = await partnerEvent(ctx.db, auth, id);
  const c = (await counts(ctx.db, [id])).get(id)!;
  const staffByRole = await ctx.db.query(
    "select role, count(*)::int as n from staff where venue_id = $1 group by role",
    [id],
  );
  const role = (r: string) => staffByRole.find((s) => s.role === r)?.n ?? 0;
  return {
    ...summary(v, c),
    city: v.city,
    feePct: v.fee_pct,
    feeFlatKobo: v.fee_flat_kobo,
    absorbLimitKobo: v.absorb_limit_kobo,
    floorPlanUrl: v.floor_plan_url,
    buyerUrl: `${ctx.env.publicAppUrl}/l/${v.code}`,
    checklist: [
      { key: "location", label: "Event location set", done: v.lat !== null },
      { key: "plan", label: "Venue plan with delivery spots", done: c.spots > 0 },
      { key: "vendors", label: "At least one vendor with items", done: c.items > 0 },
      {
        key: "runners",
        label: v.delivery_mode === "layovr_runners" ? "Layovr runners approved" : "At least one runner added",
        done: v.delivery_mode === "layovr_runners" ? v.runner_request_status === "approved" : role("runner") > 0,
      },
      { key: "dispatch", label: "Someone on dispatch (or an admin)", done: role("dispatch") + role("admin") > 0 },
    ],
  };
}

/* ------------------------------------------------------------------ create */

function codeFromName(name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20)
    .replace(/-$/, "");
  return base.length >= 3 ? base : `EVENT-${base}`.slice(0, 20);
}

async function uniqueCode(q: Queryable, wanted: string, explicit: boolean): Promise<string> {
  const [taken] = await q.query("select 1 from venues where code = $1", [wanted]);
  if (!taken) return wanted;
  if (explicit) throw conflict(`The event code ${wanted} is taken. Pick another.`);
  for (let n = 2; n < 100; n++) {
    const code = `${wanted.slice(0, 20)}-${n}`;
    const [t] = await q.query("select 1 from venues where code = $1", [code]);
    if (!t) return code;
  }
  return `${wanted.slice(0, 15)}-${uid("x", 4).slice(2).toUpperCase()}`;
}

/** One open area covering the canvas, with one spot, for planners who will draw their own. */
function blankPlan(name: string): VenuePlanInput {
  return {
    standard: PLAN_STANDARD,
    venue: { code: "BLANK", name, type: "Event" },
    canvas: { width: 100, height: 75, unit: "m", north: 0, notes: "Blank plan: draw your areas over a tracing image." },
    levels: [{ level: 0, name: "Ground floor" }],
    sections: [{ code: "A", name: "Main", color: "#E8553B" }],
    areas: [{ code: "MAIN", name: "Main area", section: "A", level: 0, kind: "hall", shape: { type: "rect", x: 5, y: 5, w: 90, h: 65 } }],
    spots: [{ code: "A0-MAIN-1", area: "MAIN", label: "Main area · centre", x: 50, y: 37 }],
    markers: [],
  };
}

/**
 * Puts a plan on the map around a location: the canvas centre at the event's
 * coordinates, north up, at the plan's own scale. Marked approximate until
 * someone calibrates on site (Admin → Floor plan → Link the plan to GPS).
 */
export function anchorCanvas(canvas: VenuePlan["canvas"], lat: number, lng: number): VenuePlan["canvas"] {
  const { width: w, height: h, unit } = canvas;
  const existing = canvas.geo ? fitGeo(canvas.geo.points) : null;
  const mPerUnit = unit === "m" ? 1 : unit === "ft" ? 0.3048 : (existing?.metresPerUnit ?? 1);
  const north = lat + ((h / 2) * mPerUnit) / 110_540;
  return {
    ...canvas,
    geo: {
      points: [
        { x: w / 2, y: h / 2, lat, lng },
        { x: w / 2, y: 0, lat: north, lng },
      ],
      approximate: true,
    },
  };
}

export type CreateEventInput = {
  name: string;
  code?: string | undefined;
  startsAt?: string | undefined;
  endsAt?: string | undefined;
  location?: { address: string; lat: number; lng: number; placeId?: string | undefined; city?: string | undefined } | undefined;
  templateCode?: string | undefined;
  plan?: unknown;
  deliveryMode: "own_runners" | "layovr_runners";
  runnersNeeded?: number | undefined;
  runnerRequestNote?: string | undefined;
};

const FILLS = ["sun", "coral", "lilac", "mint", "blush"] as const;

export async function createEvent(ctx: Ctx, auth: PartnerAuth, input: CreateEventInput): Promise<EventDetail> {
  requireWrite(auth);
  if (input.startsAt && input.endsAt && input.endsAt < input.startsAt) throw bad("The event ends before it starts");

  // 1. Starting plan: uploaded file, library template, or blank.
  const template = input.templateCode ? venueTemplate(input.templateCode) : undefined;
  if (input.templateCode && !template) throw bad(`No venue template called ${input.templateCode}`);
  const source: unknown = input.plan ?? template?.plan() ?? blankPlan(input.name);
  const check = checkPlan(source);
  if (!check.ok || !check.plan) {
    throw new HttpError(400, `That plan file has problems: ${check.errors.slice(0, 3).join("; ")}`);
  }

  const id = await ctx.db.tx(async (q) => {
    const explicit = Boolean(input.code);
    const code = await uniqueCode(q, input.code ?? codeFromName(input.name), explicit);
    let plan: VenuePlan = { ...check.plan!, venue: { ...check.plan!.venue, code, name: input.name } };
    const lat = input.location?.lat ?? template?.lat;
    const lng = input.location?.lng ?? template?.lng;
    if (lat !== undefined && lng !== undefined && (input.location || !plan.canvas.geo)) {
      plan = { ...plan, canvas: anchorCanvas(plan.canvas, lat, lng) };
    }
    const venueId = uid("v");
    const layovr = input.deliveryMode === "layovr_runners";
    await q.query(
      `insert into venues (id, code, name, city, type, fill, is_live, is_sample, fee_pct, fee_flat_kobo,
         absorb_limit_kobo, partner_id, status, starts_at, ends_at, address, lat, lng, google_place_id,
         template_code, delivery_mode, runner_request_status, runners_needed, runner_request_note)
       values ($1,$2,$3,$4,'Event',$5,true,false,0.04,10000,30000,$6,'draft',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        venueId, code, input.name, input.location?.city ?? template?.area ?? "Lagos",
        FILLS[Math.floor(Math.random() * FILLS.length)], auth.partnerId,
        input.startsAt ?? null, input.endsAt ?? null,
        input.location?.address ?? null, lat ?? null, lng ?? null, input.location?.placeId ?? null,
        template?.code ?? (input.plan ? "UPLOAD" : "BLANK"), input.deliveryMode,
        layovr ? "requested" : "none", layovr ? (input.runnersNeeded ?? null) : null,
        layovr ? (input.runnerRequestNote ?? null) : null,
      ],
    );
    await applyPlan(q, venueId, plan);
    return venueId;
  });
  notify({ venueId: id });
  return getEvent(ctx, auth, id);
}

/* ------------------------------------------------------------------ update */

export type UpdateEventInput = {
  name?: string | undefined;
  startsAt?: string | null | undefined;
  endsAt?: string | null | undefined;
  location?: CreateEventInput["location"];
  feePct?: number | undefined;
  feeFlatKobo?: number | undefined;
  absorbLimitKobo?: number | undefined;
  floorPlanUrl?: string | undefined;
  deliveryMode?: "own_runners" | "layovr_runners" | undefined;
  status?: "draft" | "live" | "ended" | undefined;
};

export async function updateEvent(ctx: Ctx, auth: PartnerAuth, id: string, patch: UpdateEventInput): Promise<EventDetail> {
  requireWrite(auth);
  await partnerEvent(ctx.db, auth, id);
  if (patch.status === "live") {
    const detail = await getEvent(ctx, auth, id);
    const missing = detail.checklist.filter((c) => !c.done && ["plan", "vendors"].includes(c.key));
    if (missing.length) {
      throw bad(`Before publishing: ${missing.map((m) => m.label.toLowerCase()).join(", ")}.`);
    }
  }
  await ctx.db.tx(async (q) => {
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const set = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (patch.name !== undefined) set("name", patch.name);
    if (patch.startsAt !== undefined) set("starts_at", patch.startsAt);
    if (patch.endsAt !== undefined) set("ends_at", patch.endsAt);
    if (patch.location) {
      set("address", patch.location.address);
      set("lat", patch.location.lat);
      set("lng", patch.location.lng);
      set("google_place_id", patch.location.placeId ?? null);
      if (patch.location.city) set("city", patch.location.city);
    }
    if (patch.feePct !== undefined) set("fee_pct", patch.feePct);
    if (patch.feeFlatKobo !== undefined) set("fee_flat_kobo", patch.feeFlatKobo);
    if (patch.absorbLimitKobo !== undefined) set("absorb_limit_kobo", patch.absorbLimitKobo);
    if (patch.floorPlanUrl !== undefined) set("floor_plan_url", await persistImage(q, id, patch.floorPlanUrl));
    if (patch.deliveryMode !== undefined) {
      set("delivery_mode", patch.deliveryMode);
      if (patch.deliveryMode === "own_runners") set("runner_request_status", "none");
    }
    if (patch.status !== undefined) set("status", patch.status);
    if (sets.length) await q.query(`update venues set ${sets.join(", ")} where id = $1`, vals);

    // A new location re-anchors a plan that hasn't been calibrated on site.
    if (patch.location) {
      const [v] = await q.query("select plan from venues where id = $1", [id]);
      const meta = v?.plan as PlanMeta | null;
      if (meta && (!meta.canvas.geo || meta.canvas.geo.approximate)) {
        const canvas = anchorCanvas(meta.canvas, patch.location.lat, patch.location.lng);
        await q.query("update venues set plan = $2 where id = $1", [id, JSON.stringify({ ...meta, canvas })]);
      }
    }
  });
  notify({ venueId: id });
  return getEvent(ctx, auth, id);
}

/* ------------------------------------------------------------------ Layovr runners */

export async function requestRunners(
  ctx: Ctx,
  auth: PartnerAuth,
  id: string,
  input: { runnersNeeded: number; note?: string | undefined },
): Promise<EventDetail> {
  requireWrite(auth);
  await partnerEvent(ctx.db, auth, id);
  await ctx.db.query(
    `update venues set delivery_mode = 'layovr_runners', runner_request_status = 'requested',
       runners_needed = $2, runner_request_note = $3, runner_request_reply = null where id = $1`,
    [id, input.runnersNeeded, input.note ?? null],
  );
  return getEvent(ctx, auth, id);
}

export async function listRunnerRequests(ctx: Ctx, auth: PartnerAuth): Promise<(EventSummary & { partnerName: string })[]> {
  if (auth.role !== "operator") throw forbidden("Layovr operators only");
  const rows = await ctx.db.query(
    `select v.*, p.name as partner_name from venues v join partners p on p.id = v.partner_id
     where v.delivery_mode = 'layovr_runners' order by
       case v.runner_request_status when 'requested' then 0 else 1 end, v.starts_at nulls last`,
  );
  const c = await counts(ctx.db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...summary(r, c.get(r.id)), partnerName: r.partner_name }));
}

export async function decideRunnerRequest(
  ctx: Ctx,
  auth: PartnerAuth,
  id: string,
  input: { decision: "approve" | "decline"; note?: string | undefined },
): Promise<EventDetail> {
  if (auth.role !== "operator") throw forbidden("Layovr operators only");
  const v = await partnerEvent(ctx.db, auth, id);
  if (v.delivery_mode !== "layovr_runners") throw conflict("This event isn't asking for Layovr runners");
  await ctx.db.query(
    "update venues set runner_request_status = $2, runner_request_reply = $3 where id = $1",
    [id, input.decision === "approve" ? "approved" : "declined", input.note ?? null],
  );
  notify({ venueId: id });
  return getEvent(ctx, auth, id);
}
