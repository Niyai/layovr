import type { PlanDot } from "@/components/FloorPlan";
import type { Snapshot } from "@/lib/types";

/** Positions older than 2 minutes are left off the map. */
const fresh = (updatedAt: string) => Date.now() - new Date(updatedAt).getTime() <= 120_000;

/** Runners on an order (dispatch and admin get these). */
export function runnerDots(d: Snapshot): PlanDot[] {
  return d.runnerPositions.flatMap((p) => {
    const r = d.staff.find((s) => s.id === p.runnerId);
    if (p.x === undefined || p.y === undefined || !r || !fresh(p.updatedAt)) return [];
    return [{ id: `r_${p.runnerId}`, x: p.x, y: p.y, icon: "🛵", label: r.name, className: "" }];
  });
}

/** Buyers who shared where they are (their runner, dispatch and admin get these). */
export function buyerDots(d: Snapshot, orderIds?: string[]): PlanDot[] {
  return d.buyerPositions.flatMap((p) => {
    if (p.x === undefined || p.y === undefined || !fresh(p.updatedAt)) return [];
    if (orderIds && !orderIds.includes(p.orderId)) return [];
    const o = d.orders.find((x) => x.id === p.orderId);
    return [
      {
        id: `b_${p.orderId}`,
        x: p.x,
        y: p.y,
        icon: "🙋",
        label: o ? `${o.customerName.split(" ")[0]} (live)` : "Buyer (live)",
        className: "",
        ...(p.level === undefined ? {} : { level: p.level }),
      },
    ];
  });
}

/** Open mobile vendors (carts, hawkers) at a venue. Public. */
export function vendorDots(d: Snapshot, venueId: string): PlanDot[] {
  return d.vendorPositions.flatMap((p) => {
    const v = d.vendors.find((x) => x.id === p.vendorId && x.venueId === venueId);
    if (!v || !fresh(p.updatedAt)) return [];
    return [{ id: `v_${p.vendorId}`, x: p.x, y: p.y, icon: v.emoji, label: v.name.replace(/ \(sample\)$/, ""), className: "" }];
  });
}
