import { makeSeed, type Snapshot } from "@layovr/shared";
import type { Ctx, StaffRow } from "../context";
import {
  loadOrders,
  toProduct,
  toPublicStaff,
  toPurchase,
  toSpot,
  toStaff,
  toVendor,
  toVenue,
  toZone,
} from "./mappers";

/**
 * GET /api/snapshot: everything one screen may see.
 * - Everyone: venues, zones, active spots, vendors, products, runner first names, live stats.
 * - Buyers: their own orders (by the unguessable ids saved on their phone), with hand-off PIN.
 * - Dispatch/admin: every order and purchase at their venue (no PINs).
 * - Runners: orders assigned to them plus paid orders waiting for a runner.
 */
export async function buildSnapshot(
  ctx: Ctx,
  me: StaffRow | null,
  buyerOrderIds: string[],
): Promise<Snapshot> {
  const q = ctx.db;
  const isAdmin = me?.role === "admin";
  const [venues, zones, spots, vendors, products, staff, vendorActive, busyRunners] =
    await Promise.all([
      q.query("select * from venues order by is_sample, created_at"),
      q.query("select * from zones order by sort, name"),
      q.query(
        `select * from spots ${isAdmin ? "" : "where active"} order by code`,
      ),
      q.query("select * from vendors order by created_at"),
      q.query("select * from products order by created_at, id"),
      me
        ? q.query("select * from staff where venue_id = $1 order by name", [me.venue_id])
        : q.query("select * from staff where role = 'runner' order by name"),
      q.query(
        `select s.vendor_id, count(distinct s.order_id)::int as n
         from order_stops s join orders o on o.id = s.order_id
         where s.status = 'pending' and o.status in ('paid','assigned','buying','on_the_way')
         group by s.vendor_id`,
      ),
      q.query(
        `select distinct runner_id from orders
         where runner_id is not null and status in ('assigned','buying','on_the_way')`,
      ),
    ]);

  const busy = new Set(busyRunners.map((r) => r.runner_id as string));
  const runnersFree: Record<string, number> = {};
  const allRunners = me
    ? await q.query("select id, venue_id, on_shift from staff where role = 'runner'")
    : staff;
  for (const r of allRunners) {
    if (r.on_shift && !busy.has(r.id)) {
      runnersFree[r.venue_id] = (runnersFree[r.venue_id] ?? 0) + 1;
    }
  }

  let staffOrderIds: string[] = [];
  let purchases: Snapshot["purchases"] = [];
  if (me && (me.role === "admin" || me.role === "dispatch")) {
    staffOrderIds = (
      await q.query(
        `select id from orders where venue_id = $1 and status <> 'awaiting_payment'
         and created_at > now() - interval '3 days'`,
        [me.venue_id],
      )
    ).map((r) => r.id);
    purchases = (
      await q.query("select * from purchases where venue_id = $1", [me.venue_id])
    ).map(toPurchase);
  } else if (me?.role === "runner") {
    staffOrderIds = (
      await q.query(
        `select id from orders where venue_id = $1
         and (runner_id = $2 and status in ('assigned','buying','on_the_way') or status = 'paid')`,
        [me.venue_id, me.id],
      )
    ).map((r) => r.id);
    purchases = (
      await q.query("select * from purchases where runner_id = $1", [me.id])
    ).map(toPurchase);
  }

  const mine = await loadOrders(q, buyerOrderIds.slice(0, 30), { withPin: true });
  const mineIds = new Set(mine.map((o) => o.id));
  const forStaff = await loadOrders(
    q,
    staffOrderIds.filter((id) => !mineIds.has(id)),
    { withPin: false },
  );

  return {
    venues: venues.map(toVenue),
    zones: zones.map(toZone),
    spots: spots.map(toSpot),
    vendors: vendors.map(toVendor),
    products: products.map(toProduct),
    staff: staff.map(me ? toStaff : toPublicStaff),
    orders: [...forStaff, ...mine],
    purchases,
    stats: {
      vendorActive: Object.fromEntries(vendorActive.map((r) => [r.vendor_id, r.n])),
      runnersFree,
    },
    me: me ? toStaff(me) : null,
    config: {
      paymentMode: ctx.gateway ? "flutterwave" : "demo",
      allowReset: ctx.env.allowReset && isAdmin,
      demoAccounts: ctx.env.showDemoPins
        ? makeSeed().staff.map((s) => ({ name: s.name, role: s.role, pin: s.pin }))
        : [],
    },
  };
}
