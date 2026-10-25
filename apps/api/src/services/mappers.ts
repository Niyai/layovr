import type {
  Fill,
  Order,
  OrderEvent,
  OrderStatus,
  Product,
  Purchase,
  Spot,
  Staff,
  Vendor,
  Venue,
  VenueType,
  Zone,
} from "@layovr/shared";
import type { Queryable, Row } from "../db/client";

/** Postgres rows (snake_case) → shared types (camelCase). Optional fields are omitted, not null. */

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

function opt<K extends string, V>(key: K, value: V | null | undefined) {
  return (value === null || value === undefined || value === ""
    ? {}
    : { [key]: value }) as Partial<Record<K, V>>;
}

export const toVenue = (r: Row): Venue => ({
  id: r.id,
  code: r.code,
  name: r.name,
  city: r.city,
  type: r.type as VenueType,
  fill: r.fill as Fill,
  isLive: r.is_live,
  isSample: r.is_sample,
  feePct: r.fee_pct,
  feeFlatKobo: r.fee_flat_kobo,
  absorbLimitKobo: r.absorb_limit_kobo,
  ...opt("floorPlanUrl", r.floor_plan_url as string | null),
});

export const toZone = (r: Row): Zone => ({
  id: r.id,
  venueId: r.venue_id,
  name: r.name,
  restricted: r.restricted,
  rect: r.rect,
});

export const toSpot = (r: Row): Spot => ({
  id: r.id,
  venueId: r.venue_id,
  zoneId: r.zone_id,
  code: r.code,
  label: r.label,
  x: r.x,
  y: r.y,
  active: r.active,
  ...opt("landmark", r.landmark as string | null),
  ...opt("directions", r.directions as string | null),
});

export const toVendor = (r: Row): Vendor => ({
  id: r.id,
  venueId: r.venue_id,
  name: r.name,
  emoji: r.emoji,
  category: r.category,
  description: r.description,
  stallLabel: r.stall_label,
  isOpen: r.is_open,
  prepMinutes: r.prep_minutes,
  fill: r.fill as Fill,
  ...opt("zoneId", r.zone_id as string | null),
});

export const toProduct = (r: Row): Product => ({
  id: r.id,
  vendorId: r.vendor_id,
  category: r.category,
  kind: r.kind,
  name: r.name,
  priceKobo: r.price_kobo,
  priceCheckedAt: r.price_checked_at,
  inStock: r.in_stock,
  fulfilment: r.fulfilment,
  ...opt("description", r.description as string | null),
  ...opt("imageUrl", r.image_url as string | null),
  ...opt("durationMin", r.duration_min as number | null),
  ...(r.age_restricted ? { ageRestricted: true } : {}),
});

/** Full staff record for staff screens. pin_hash never leaves the server. */
export const toStaff = (r: Row): Staff => ({
  id: r.id,
  venueId: r.venue_id,
  name: r.name,
  role: r.role,
  phone: r.phone,
  floatKobo: r.float_kobo,
  canEnterRestricted: r.can_enter_restricted,
  onShift: r.on_shift,
});

/** What buyers may see about staff: a runner's first name. */
export const toPublicStaff = (r: Row): Staff => ({
  id: r.id,
  venueId: r.venue_id,
  name: String(r.name).split(" ")[0] ?? "",
  role: r.role,
  phone: "",
  floatKobo: 0,
  canEnterRestricted: false,
  onShift: r.on_shift,
});

export const toPurchase = (r: Row): Purchase => ({
  id: r.id,
  orderId: r.order_id,
  stopId: r.order_stop_id,
  runnerId: r.runner_id,
  amountKobo: r.amount_paid_kobo,
  method: r.method,
  at: iso(r.created_at),
  ...opt("receiptUrl", r.receipt_url as string | null),
});

/**
 * Loads full orders (stops, items, events, payment) for the given ids.
 * `withPin` is only true for the buyer's own view: runners must get the PIN
 * from the buyer's screen, so staff payloads never include it.
 */
export async function loadOrders(
  q: Queryable,
  ids: string[],
  opts: { withPin: boolean },
): Promise<Order[]> {
  if (ids.length === 0) return [];
  const [orders, stops, items, events, payments] = await Promise.all([
    q.query("select * from orders where id = any($1) order by created_at", [ids]),
    q.query("select * from order_stops where order_id = any($1) order by sort", [ids]),
    q.query(
      `select i.* from order_items i join order_stops s on s.id = i.order_stop_id
       where s.order_id = any($1) order by i.sort`,
      [ids],
    ),
    q.query(
      "select * from order_events where order_id = any($1) order by id",
      [ids],
    ),
    q.query(
      `select * from payments where order_id = any($1) and status = 'successful'`,
      [ids],
    ),
  ]);

  return orders.map((o): Order => {
    const payment = payments.find((p) => p.order_id === o.id);
    return {
      id: o.id,
      code: o.code,
      venueId: o.venue_id,
      spotId: o.spot_id,
      customerName: o.customer_name,
      customerPhone: o.customer_phone,
      ...opt("customerEmail", o.customer_email as string | null),
      ...opt("landmark", o.landmark_note as string | null),
      stops: stops
        .filter((s) => s.order_id === o.id)
        .map((s) => ({
          id: s.id,
          vendorId: s.vendor_id,
          status: s.status,
          items: items
            .filter((i) => i.order_stop_id === s.id)
            .map((i) => ({
              id: i.id,
              productId: i.product_id ?? "",
              name: i.name_snapshot,
              unitPriceKobo: i.unit_price_kobo,
              qty: i.qty,
              status: i.status,
              finalPriceKobo: i.final_price_kobo,
              ...opt("note", i.note as string | null),
            })),
        })),
      subtotalKobo: o.subtotal_kobo,
      feeKobo: o.fee_kobo,
      totalKobo: o.total_kobo,
      refundKobo: o.refund_kobo,
      status: o.status as OrderStatus,
      ...opt("runnerId", o.runner_id as string | null),
      ...(o.eta_at ? { etaAt: iso(o.eta_at) } : {}),
      handoffPin: opts.withPin ? o.handoff_pin : "",
      createdAt: iso(o.created_at),
      events: events
        .filter((e) => e.order_id === o.id)
        .map(
          (e): OrderEvent => ({
            at: iso(e.created_at),
            status: e.to_status,
            by: e.actor,
            ...opt("note", e.note as string | null),
          }),
        ),
      ...(payment
        ? {
            payment: {
              txRef: payment.tx_ref,
              mode: payment.mode,
              amountKobo: payment.amount_kobo,
              ...opt("transactionId", payment.flw_transaction_id as string | null),
            },
          }
        : {}),
    };
  });
}
