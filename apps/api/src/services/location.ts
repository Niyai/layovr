import { distanceM, fitGeo, type PlanMeta } from "@layovr/shared";
import type { Ctx, StaffRow } from "../context";
import type { Queryable, Row } from "../db/client";
import { bad, forbidden } from "../lib/errors";
import { notify } from "../lib/events";

const ACTIVE = "('assigned','buying','on_the_way')";

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
 * Buyer view: roughly how far their runner is, to the nearest 10 m. Only while
 * the order is on the way, the plan is on the map, the fix is fresh (2 min) and
 * accurate enough (≤ 100 m). Never exposes the runner's coordinates.
 */
export function runnerDistance(order: Row, spot: Row | undefined, loc: Row | undefined, fit: ReturnType<typeof venueFit>) {
  if (order.status !== "on_the_way" || !loc || !fit) return undefined;
  if (loc.accuracy_m > 100) return undefined;
  if (Date.now() - new Date(loc.updated_at).getTime() > 120_000) return undefined;
  const bx = order.pin_x ?? spot?.x;
  const by = order.pin_y ?? spot?.y;
  if (bx === undefined || by === undefined) return undefined;
  const [lat, lng] = fit.toGeo(bx, by);
  return Math.max(10, Math.round(distanceM(lat, lng, loc.lat, loc.lng) / 10) * 10);
}

/** Admin calibration: save GPS control points onto the venue plan. */
export async function saveGeo(
  ctx: Ctx,
  venueId: string,
  points: { x: number; y: number; lat: number; lng: number }[],
) {
  const fit = fitGeo(points);
  if (!fit) throw bad("Those points are too close together. Pick two places at least 20 m apart.");
  const [venue] = await ctx.db.query("select plan from venues where id = $1", [venueId]);
  if (!venue?.plan) throw bad("Import a plan first");
  const plan = venue.plan as PlanMeta;
  const next: PlanMeta = { ...plan, canvas: { ...plan.canvas, geo: { points, approximate: false } } };
  await ctx.db.query("update venues set plan = $2 where id = $1", [venueId, JSON.stringify(next)]);
  // Re-place runners already on the map.
  const locs = await ctx.db.query("select * from runner_locations where venue_id = $1", [venueId]);
  for (const l of locs) {
    const [x, y] = fit.toCanvas(l.lat, l.lng);
    await ctx.db.query("update runner_locations set x = $2, y = $3 where runner_id = $1", [l.runner_id, x, y]);
  }
  notify({ venueId: venueId });
  return { residualM: fit.residualM, metresPerUnit: fit.metresPerUnit };
}
