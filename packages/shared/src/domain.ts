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

/** A spot by its printed code, within one event when venueId is given (codes repeat across events). */
export function spotByCode(d: DB, code: string, venueId?: string): Spot | undefined {
  return d.spots.find(
    (s) =>
      s.code.toLowerCase() === code.toLowerCase() &&
      s.active &&
      (venueId === undefined || s.venueId === venueId),
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

/**
 * "Raise your phone": when a runner reaches the buyer's area, both screens turn
 * the same colour. Each signal pairs a colour with a symbol and a name so it
 * still works for colour-blind people and in bright sunlight. The server never
 * gives two pairs in the same area the same signal; once all ten colours are in
 * use there, it adds stripes, then a slow flash (1 Hz, well under the 3 Hz
 * photosensitivity limit).
 */
export const MATCH_COLORS = [
  { key: "blue", name: "Blue", hex: "#1E5BFF", symbol: "▲", ink: "#FFFFFF" },
  { key: "yellow", name: "Yellow", hex: "#FFD400", symbol: "■", ink: "#111111" },
  { key: "pink", name: "Pink", hex: "#FF4FA3", symbol: "♥", ink: "#111111" },
  { key: "green", name: "Green", hex: "#00A651", symbol: "★", ink: "#FFFFFF" },
  { key: "orange", name: "Orange", hex: "#FF7A00", symbol: "✚", ink: "#111111" },
  { key: "purple", name: "Purple", hex: "#8E24AA", symbol: "◆", ink: "#FFFFFF" },
  { key: "cyan", name: "Cyan", hex: "#00C2D1", symbol: "⬢", ink: "#111111" },
  { key: "red", name: "Red", hex: "#E53935", symbol: "●", ink: "#FFFFFF" },
  { key: "white", name: "White", hex: "#FFFFFF", symbol: "✱", ink: "#111111" },
  { key: "black", name: "Black", hex: "#111111", symbol: "☾", ink: "#FFFFFF" },
] as const;

export const MATCH_PATTERNS = ["solid", "stripes", "flash"] as const;

/** First signal not already taken in this area. */
export function pickMatchSignal(
  taken: { color: string; pattern: string }[],
): { color: string; pattern: (typeof MATCH_PATTERNS)[number] } {
  for (const pattern of MATCH_PATTERNS) {
    for (const c of MATCH_COLORS) {
      if (!taken.some((t) => t.color === c.key && t.pattern === pattern)) {
        return { color: c.key, pattern };
      }
    }
  }
  // 30 pairs arriving in one area at once: repeat, the PIN still protects hand-off.
  return { color: MATCH_COLORS[taken.length % MATCH_COLORS.length]!.key, pattern: "solid" };
}

export function matchColor(key: string) {
  return MATCH_COLORS.find((c) => c.key === key) ?? MATCH_COLORS[0];
}
