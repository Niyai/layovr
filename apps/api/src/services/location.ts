import { distanceM, fitGeo, type PlanMeta } from "@layovr/shared";
import type { Ctx, StaffRow } from "../context";
import type { Queryable, Row } from "../db/client";
import { bad, forbidden, notFound } from "../lib/errors";
import { notify } from "../lib/events";

const ACTIVE = "('assigned','buying','on_the_way')";
/** Order statuses where a runner is on the way, so the buyer's position is useful. */
const LIVE = ["assigned", "buying", "on_the_way"];

/** The venue's canvas ↔ GPS fit, or null when the plan isn't on the map yet. */
export function venueFit(venue: Row | undefined) {
  const points = (venue?.plan as PlanMeta | null)?.canvas?.geo?.points;
  return points ? fitGeo(points) : null;
}

/**
 * A runner's phone reports its position while they have an active order.
 * Outside an order nothing is stored, and the previous position is deleted.
 */
export async function reportRunnerLocation(
  ctx: Ctx,
  staff: StaffRow,
  input: { lat: number; lng: number; accuracyM: number },
): Promise<{ sharing: boolean }> {
  if (staff.role !== "runner") throw forbidden("Only runners share their location");
  const [active] = await ctx.db.query(
    `select 1 from orders where runner_id = $1 and status in ${ACTIVE} limit 1`,
    [staff.id],
  );
  if (!active) {
    await clearRunnerLocation(ctx.db, staff.id);
    return { sharing: false };
  }
  const [venue] = await ctx.db.query("select plan from venues where id = $1", [staff.venue_id]);
  const fit = venueFit(venue);
  const [x, y] = fit ? fit.toCanvas(input.lat, input.lng) : [null, null];
  await ctx.db.query(
    `insert into runner_locations (runner_id, venue_id, lat, lng, accuracy_m, x, y, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7, now())
     on conflict (runner_id) do update set lat = excluded.lat, lng = excluded.lng,
       accuracy_m = excluded.accuracy_m, x = excluded.x, y = excluded.y, updated_at = now()`,
    [staff.id, staff.venue_id, input.lat, input.lng, Math.round(input.accuracyM), x, y],
  );
  notify({ venueId: staff.venue_id });
  return { sharing: true };
}

/** Forget a runner's position unless they still have an active order (or always, with force). */
export async function clearRunnerLocation(q: Queryable, runnerId: string, force = false) {
  await q.query(
    `delete from runner_locations where runner_id = $1 and ($2 or not exists (
       select 1 from orders where runner_id = $1 and status in ${ACTIVE}))`,
    [runnerId, force],
  );
}

/**
 * A buyer chose to share where they are so their runner can find them.
 * Accepted only while a runner is on the order; knowing the order id is the
 * buyer's proof, as for every other buyer action.
 */
export async function reportBuyerLocation(
  ctx: Ctx,
  orderId: string,
  input: { lat: number; lng: number; accuracyM: number; level?: number | undefined },
): Promise<{ sharing: boolean }> {
  const [order] = await ctx.db.query("select id, venue_id, status from orders where id = $1", [orderId]);
  if (!order) throw notFound("Order not found");
  if (!LIVE.includes(order.status)) {
    await clearBuyerLocation(ctx.db, orderId);
    return { sharing: false };
  }
  const [venue] = await ctx.db.query("select plan from venues where id = $1", [order.venue_id]);
  const fit = venueFit(venue);
  const [x, y] = fit ? fit.toCanvas(input.lat, input.lng) : [null, null];
  await ctx.db.query(
    `insert into buyer_locations (order_id, venue_id, lat, lng, accuracy_m, x, y, level, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now())
     on conflict (order_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
       x = excluded.x, y = excluded.y, level = excluded.level, updated_at = now()`,
    [orderId, order.venue_id, input.lat, input.lng, Math.round(input.accuracyM), x, y, input.level ?? null],
  );
  notify({ venueId: order.venue_id });
  return { sharing: true };
}

/** The buyer tapped "Stop sharing". */
export async function stopBuyerLocation(ctx: Ctx, orderId: string): Promise<{ sharing: false }> {
  const rows = await ctx.db.query("delete from buyer_locations where order_id = $1 returning venue_id", [orderId]);
  if (rows[0]) notify({ venueId: rows[0].venue_id });
  return { sharing: false };
}

/** The order closed. */
export async function clearBuyerLocation(q: Queryable, orderId: string) {
  await q.query("delete from buyer_locations where order_id = $1", [orderId]);
}

/**
 * Vendor staff share where their cart is. Stored only while the vendor is
 * mobile and open; otherwise any old position is deleted.
 */
export async function reportVendorLocation(
  ctx: Ctx,
  staff: StaffRow,
  input: { lat: number; lng: number; accuracyM: number },
): Promise<{ sharing: boolean }> {
  if (staff.role !== "vendor" || !staff.vendor_id) throw forbidden("Only vendor staff share a vendor's location");
  const [vendor] = await ctx.db.query("select id, venue_id, mobile, is_open from vendors where id = $1", [staff.vendor_id]);
  if (!vendor || vendor.venue_id !== staff.venue_id) throw notFound("Vendor not found");
  if (!vendor.mobile || !vendor.is_open) {
    await clearVendorLocation(ctx.db, vendor.id);
    return { sharing: false };
  }
  const [venue] = await ctx.db.query("select plan from venues where id = $1", [staff.venue_id]);
  const fit = venueFit(venue);
  const [x, y] = fit ? fit.toCanvas(input.lat, input.lng) : [null, null];
  await ctx.db.query(
    `insert into vendor_locations (vendor_id, venue_id, lat, lng, accuracy_m, x, y, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7, now())
     on conflict (vendor_id) do update set lat = excluded.lat, lng = excluded.lng,
       accuracy_m = excluded.accuracy_m, x = excluded.x, y = excluded.y, updated_at = now()`,
    [vendor.id, staff.venue_id, input.lat, input.lng, Math.round(input.accuracyM), x, y],
  );
  notify({ venueId: staff.venue_id });
  return { sharing: true };
}

export async function clearVendorLocation(q: Queryable, vendorId: string) {
  await q.query("delete from vendor_locations where vendor_id = $1", [vendorId]);
}

/** A position fresh and accurate enough to show someone else. */
export function usable(loc: Row) {
  return loc.accuracy_m <= 100 && Date.now() - new Date(loc.updated_at).getTime() <= 120_000;
}

/**
 * Buyer view: roughly how far their runner is, to the nearest 10 m. Only while
 * the order is on the way, the plan is on the map, the fix is fresh (2 min) and
 * accurate enough (≤ 100 m). Never exposes the runner's coordinates.
 */
export function runnerDistance(order: Row, spot: Row | undefined, loc: Row | undefined, fit: ReturnType<typeof venueFit>) {
  if (order.status !== "on_the_way" || !loc || !fit) return undefined;
  if (!usable(loc)) return undefined;
  const bx = order.pin_x ?? spot?.x;
  const by = order.pin_y ?? spot?.y;
  if (bx === undefined || by === undefined) return undefined;
  const [lat, lng] = fit.toGeo(bx, by);
  return Math.max(10, Math.round(distanceM(lat, lng, loc.lat, loc.lng) / 10) * 10);
}

/**
 * Save GPS control points onto the venue plan: from on-site calibration, or
 * approximate ones from placing the plan by eye on a satellite map.
 */
export async function saveGeo(
  ctx: Ctx,
  venueId: string,
  points: { x: number; y: number; lat: number; lng: number }[],
  approximate = false,
) {
  const fit = fitGeo(points);
  if (!fit) throw bad("Those points are too close together. Pick two places at least 20 m apart.");
  const [venue] = await ctx.db.query("select plan from venues where id = $1", [venueId]);
  if (!venue?.plan) throw bad("Import a plan first");
  const plan = venue.plan as PlanMeta;
  const next: PlanMeta = { ...plan, canvas: { ...plan.canvas, geo: { points, approximate } } };
  await ctx.db.query("update venues set plan = $2 where id = $1", [venueId, JSON.stringify(next)]);
  // Re-place everyone already on the map.
  for (const [table, key] of [["runner_locations", "runner_id"], ["buyer_locations", "order_id"], ["vendor_locations", "vendor_id"]] as const) {
    const locs = await ctx.db.query(`select * from ${table} where venue_id = $1`, [venueId]);
    for (const l of locs) {
      const [x, y] = fit.toCanvas(l.lat, l.lng);
      await ctx.db.query(`update ${table} set x = $2, y = $3 where ${key} = $1`, [l[key], x, y]);
    }
  }
  notify({ venueId: venueId });
  return { residualM: fit.residualM, metresPerUnit: fit.metresPerUnit };
}
