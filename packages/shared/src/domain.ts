import type {
  DB,
  OrderItem,
  OrderStatus,
  Spot,
  Staff,
  Vendor,
  Venue,
} from "./types";

/** Pure helpers used by both the API (for pricing) and the web app (for display). */

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomChars(n: number): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(n)),
    (b) => ALPHABET[b % ALPHABET.length],
  ).join("");
}

export function uid(prefix: string, length = 10): string {
  return `${prefix}_${randomChars(length).toLowerCase()}`;
}

export function orderCode(): string {
  return `LV-${randomChars(4)}`;
}

export function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

/** Service fee: percentage of subtotal rounded up to the naira, plus a flat amount. */
export function feeFor(
  venue: Pick<Venue, "feePct" | "feeFlatKobo">,
  subtotalKobo: number,
): number {
  if (subtotalKobo <= 0) return 0;
  return (
    Math.ceil((subtotalKobo * venue.feePct) / 100) * 100 + venue.feeFlatKobo
  );
}

export const ACTIVE_STATUSES: OrderStatus[] = [
  "paid",
  "assigned",
  "buying",
  "on_the_way",
];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  assigned: "Runner assigned",
  buying: "Buying",
  on_the_way: "On the way",
  delivered: "Delivered",
  not_delivered: "Not delivered",
  cancelled: "Cancelled",
};

export function venueByCode(d: DB, code: string): Venue | undefined {
  return d.venues.find((v) => v.code.toLowerCase() === code.toLowerCase());
}

export function spotByCode(d: DB, code: string): Spot | undefined {
  return d.spots.find(
    (s) => s.code.toLowerCase() === code.toLowerCase() && s.active,
  );
}

export function vendorWait(
  d: DB,
  vendor: Vendor,
): { minutes: number; active: number; busy: "quiet" | "normal" | "busy" } {
  const active = d.stats.vendorActive[vendor.id] ?? 0;
  // Our runner walks to the stall, queues and buys, then walks to the buyer.
  const minutes = vendor.prepMinutes + 8 + active * 3;
  return {
    minutes,
    active,
    busy: active >= 6 ? "busy" : active >= 2 ? "normal" : "quiet",
  };
}

export function runnersFree(d: DB, venueId: string): number {
  return d.stats.runnersFree[venueId] ?? 0;
}

export function itemsTotal(items: OrderItem[]): number {
  return items.reduce(
    (sum, i) => sum + (i.status === "dropped" ? 0 : i.unitPriceKobo * i.qty),
    0,
  );
}

export function runnerFloat(
  d: DB,
  runner: Staff,
): { floatKobo: number; spentKobo: number; leftKobo: number } {
  const spentKobo = d.purchases
    .filter((p) => p.runnerId === runner.id)
    .reduce((s, p) => s + p.amountKobo, 0);
  return {
    floatKobo: runner.floatKobo,
    spentKobo,
    leftKobo: runner.floatKobo - spentKobo,
  };
}
