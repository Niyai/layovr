import {
  feeFor,
  formatNaira,
  orderCode,
  uid,
  type CartLine,
  type ItemStatus,
  type Order,
  type OrderStatus,
} from "@layovr/shared";
import type { Queryable, Row } from "../db/client";
import { bad, conflict, forbidden, notFound } from "../lib/errors";
import { notify } from "../lib/events";
import type { PaymentGateway } from "../lib/flutterwave";
import { persistImage } from "../lib/images";
import type { Ctx, StaffRow } from "../context";
import { loadOrders, toVenue } from "./mappers";

/* ------------------------------------------------------------ status rules */

/**
 * The only legal status moves. Every move goes through transition(), which
 * also writes the order_events row (audit trail + buyer timeline).
 * Only markPaid() (after a verified payment) can move an order to `paid`.
 */
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  awaiting_payment: ["paid", "cancelled"],
  paid: ["assigned", "cancelled"],
  assigned: ["buying", "on_the_way", "cancelled"],
  buying: ["on_the_way", "cancelled"],
  on_the_way: ["delivered", "not_delivered", "cancelled"],
  not_delivered: ["assigned", "delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

async function transition(
  q: Queryable,
  order: Row,
  to: OrderStatus,
  actor: string,
  note?: string,
) {
  const from = order.status as OrderStatus;
  if (!NEXT[from].includes(to)) {
    throw conflict(`Can't move an order from ${from} to ${to}`);
  }
  await q.query(
    "update orders set status = $2, updated_at = now() where id = $1",
    [order.id, to],
  );
  await q.query(
    `insert into order_events (venue_id, order_id, from_status, to_status, actor, note)
     values ($1, $2, $3, $4, $5, $6)`,
    [order.venue_id, order.id, from, to, actor, note ?? null],
  );
  order.status = to;
}

/** A timeline note that doesn't change status (ETA change, item swapped…). */
async function logNote(q: Queryable, order: Row, actor: string, note: string) {
  await q.query(
    `insert into order_events (venue_id, order_id, from_status, to_status, actor, note)
     values ($1, $2, $3, $3, $4, $5)`,
    [order.venue_id, order.id, order.status, actor, note],
  );
}

async function lockOrder(q: Queryable, id: string): Promise<Row> {
  const [row] = await q.query("select * from orders where id = $1 for update", [id]);
  if (!row) throw notFound("Order not found");
  return row;
}

/** Dispatch and admin can act on any order at their venue; runners only on their own. */
function assertCanAct(staff: StaffRow, order: Row) {
  if (staff.venue_id !== order.venue_id) throw notFound("Order not found");
  if (staff.role === "admin" || staff.role === "dispatch") return;
  if (staff.role === "runner" && order.runner_id === staff.id) return;
  throw forbidden("This order isn't assigned to you");
}

async function getOrder(q: Queryable, id: string, withPin: boolean): Promise<Order> {
  const [o] = await loadOrders(q, [id], { withPin });
  if (!o) throw notFound("Order not found");
  return o;
}

/* ------------------------------------------------------------ checkout */

export type CreateOrderInput = {
  venueId: string;
  spotId: string;
  name: string;
  phone: string;
  email?: string | undefined;
  landmark?: string | undefined;
  cart: CartLine[];
};

/**
 * Creates an order from a basket. Prices and the fee come from the database,
 * never from the browser; the cart only says which products and how many.
 */
export async function createOrder(ctx: Ctx, input: CreateOrderInput): Promise<Order> {
  const id = await ctx.db.tx(async (q) => {
    const [venueRow] = await q.query("select * from venues where id = $1", [input.venueId]);
    if (!venueRow || !venueRow.is_live) throw bad("This venue isn't taking orders");
    const venue = toVenue(venueRow);

    const [spot] = await q.query(
      "select * from spots where id = $1 and venue_id = $2 and active",
      [input.spotId, venue.id],
    );
    if (!spot) throw bad("Tell us where you are so the runner can find you.");

    const qtyById = new Map<string, number>();
    for (const line of input.cart) {
      qtyById.set(line.productId, (qtyById.get(line.productId) ?? 0) + line.qty);
    }
    const products = await q.query(
      `select p.*, v.is_open as vendor_open, v.name as vendor_name
       from products p join vendors v on v.id = p.vendor_id
       where p.id = any($1) and p.venue_id = $2`,
      [[...qtyById.keys()], venue.id],
    );
    if (products.length !== qtyById.size) {
      throw bad("Some items in your basket are no longer on the menu. Please refresh.");
    }
    const soldOut = products.filter((p) => !p.in_stock);
    if (soldOut.length) {
      throw bad(`Sold out: ${soldOut.map((p) => p.name).join(", ")}. Remove it to continue.`);
    }
    const closed = products.find((p) => !p.vendor_open);
    if (closed) throw bad(`${closed.vendor_name} is closed right now.`);

    // One stop per vendor, in the order the buyer added them.
    const byVendor = new Map<string, Row[]>();
    for (const p of products) {
      byVendor.set(p.vendor_id, [...(byVendor.get(p.vendor_id) ?? []), p]);
    }
    const subtotal = products.reduce(
      (s, p) => s + p.price_kobo * (qtyById.get(p.id) ?? 0),
      0,
    );
    const fee = feeFor(venue, subtotal);
    const orderId = uid("ord", 16);
    const pin = String(1000 + (crypto.getRandomValues(new Uint16Array(1))[0]! % 9000));

    // Retry on the rare LV- code collision.
    for (let attempt = 0; ; attempt++) {
      const code = orderCode();
      const taken = await q.query("select 1 from orders where code = $1", [code]);
      if (taken.length && attempt < 5) continue;
      await q.query(
        `insert into orders (id, venue_id, code, spot_id, customer_name, customer_phone,
           customer_email, landmark_note, subtotal_kobo, fee_kobo, total_kobo, status, handoff_pin)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'awaiting_payment',$12)`,
        [
          orderId, venue.id, code, spot.id, input.name, input.phone,
          input.email ?? null, input.landmark ?? null, subtotal, fee, subtotal + fee, pin,
        ],
      );
      break;
    }

    let stopSort = 0;
    for (const [vendorId, items] of byVendor) {
      const stopId = uid("stp");
      const stopSubtotal = items.reduce(
        (s, p) => s + p.price_kobo * (qtyById.get(p.id) ?? 0),
        0,
      );
      await q.query(
        `insert into order_stops (id, venue_id, order_id, vendor_id, subtotal_kobo, sort)
         values ($1,$2,$3,$4,$5,$6)`,
        [stopId, venue.id, orderId, vendorId, stopSubtotal, stopSort++],
      );
      let itemSort = 0;
      for (const p of items) {
        const note = input.cart.find((l) => l.productId === p.id)?.note ?? null;
        await q.query(
          `insert into order_items (id, venue_id, order_stop_id, product_id, name_snapshot,
             unit_price_kobo, qty, final_price_kobo, note, sort)
           values ($1,$2,$3,$4,$5,$6,$7,$6,$8,$9)`,
          [uid("it"), venue.id, stopId, p.id, p.name, p.price_kobo, qtyById.get(p.id), note, itemSort++],
        );
      }
    }
    await q.query(
      `insert into order_events (venue_id, order_id, from_status, to_status, actor)
       values ($1, $2, null, 'awaiting_payment', 'buyer')`,
      [venue.id, orderId],
    );
    return orderId;
  });
  const order = await getOrder(ctx.db, id, true);
  notify({ venueId: order.venueId, orderId: id });
  return order;
}

/* ------------------------------------------------------------ payments */

export type StartedPayment = { mode: "demo" | "flutterwave"; link: string };

/** Creates a payment attempt (one payments row per attempt) and returns where to send the buyer. */
export async function startPayment(ctx: Ctx, orderId: string): Promise<StartedPayment> {
  const [o] = await ctx.db.query("select * from orders where id = $1", [orderId]);
  if (!o) throw notFound("Order not found");
  if (o.status !== "awaiting_payment") throw conflict("This order is already paid");

  const txRef = `${o.id}-${uid("t", 4).slice(2)}`;
  const mode = ctx.gateway ? "flutterwave" : "demo";
  await ctx.db.query(
    `insert into payments (id, venue_id, order_id, tx_ref, mode, amount_kobo)
     values ($1,$2,$3,$4,$5,$6)`,
    [uid("pay"), o.venue_id, o.id, txRef, mode, o.total_kobo],
  );
  if (!ctx.gateway) return { mode: "demo", link: `/pay/${o.id}?demo=1` };

  const { link } = await ctx.gateway.createPayment({
    txRef,
    amountKobo: o.total_kobo,
    redirectUrl: `${ctx.env.publicAppUrl}/pay/${o.id}`,
    name: o.customer_name,
    phone: o.customer_phone,
    email: o.customer_email ?? undefined,
    orderCode: o.code,
  });
  return { mode: "flutterwave", link };
}

/**
 * Verifies a Flutterwave transaction with Flutterwave itself and, only if it
 * checks out, marks the order paid. Called from the webhook and from the
 * buyer's redirect page; safe to run twice.
 */
export async function verifyAndMarkPaid(
  ctx: Ctx & { gateway: PaymentGateway },
  transactionId: string,
  expectOrderId?: string,
): Promise<{ ok: boolean; orderId?: string; reason?: string }> {
  const t = await ctx.gateway.verify(transactionId);
  const [payment] = await ctx.db.query("select * from payments where tx_ref = $1", [t.txRef]);
  if (!payment) return { ok: false, reason: "unknown tx_ref" };
  if (expectOrderId && payment.order_id !== expectOrderId) {
    return { ok: false, reason: "tx_ref belongs to another order" };
  }
  if (!t.successful) return { ok: false, orderId: payment.order_id, reason: `status ${t.status}` };

  const result = await ctx.db.tx(async (q) => {
    const order = await lockOrder(q, payment.order_id);
    if (t.currency !== "NGN") return { ok: false, reason: "wrong currency" };
    if (t.amountKobo < order.total_kobo) return { ok: false, reason: "amount too low" };
    await q.query(
      `update payments set status = 'successful', flw_transaction_id = $2, raw = $3
       where id = $1 and status <> 'successful'`,
      [payment.id, t.transactionId, JSON.stringify(t.raw)],
    );
    if (order.status === "awaiting_payment") {
      await transition(q, order, "paid", "system", `Flutterwave ${t.transactionId}`);
    }
    return { ok: true };
  });
  notify({ venueId: payment.venue_id, orderId: payment.order_id });
  return { ...result, orderId: payment.order_id };
}

/** Demo checkout (no Flutterwave key configured): approve without moving money. */
export async function demoPay(ctx: Ctx, orderId: string): Promise<Order> {
  if (ctx.gateway) throw forbidden("Demo payments are off: Flutterwave is configured");
  const venueId = await ctx.db.tx(async (q) => {
    const order = await lockOrder(q, orderId);
    if (order.status !== "awaiting_payment") return order.venue_id as string;
    const txRef = `${order.id}-demo`;
    await q.query(
      `insert into payments (id, venue_id, order_id, tx_ref, mode, amount_kobo, status)
       values ($1,$2,$3,$4,'demo',$5,'successful') on conflict (tx_ref) do nothing`,
      [uid("pay"), order.venue_id, order.id, txRef, order.total_kobo],
    );
    await transition(q, order, "paid", "system", "Demo payment");
    return order.venue_id as string;
  });
  notify({ venueId, orderId });
  return getOrder(ctx.db, orderId, true);
}

/* ------------------------------------------------------------ dispatch + runner */

/** Runs a staff action on one order inside a transaction, then tells every screen. */
async function act(
  ctx: Ctx,
  staff: StaffRow,
  orderId: string,
  fn: (q: Queryable, order: Row) => Promise<void>,
) {
  await ctx.db.tx(async (q) => {
    const order = await lockOrder(q, orderId);
    assertCanAct(staff, order);
    await fn(q, order);
  });
  notify({ venueId: staff.venue_id, orderId });
}

const etaFrom = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

export async function assignRunner(
  ctx: Ctx,
  staff: StaffRow,
  orderId: string,
  runnerId: string,
  etaMinutes: number,
) {
  await ctx.db.tx(async (q) => {
    const order = await lockOrder(q, orderId);
    if (order.venue_id !== staff.venue_id) throw notFound("Order not found");
    // A runner may only take a waiting order for themselves.
    if (staff.role === "runner" && (runnerId !== staff.id || order.status !== "paid")) {
      throw forbidden();
    }
    if (staff.role === "capture") throw forbidden();

    const [runner] = await q.query(
      "select * from staff where id = $1 and venue_id = $2 and role = 'runner'",
      [runnerId, staff.venue_id],
    );
    if (!runner) throw bad("Pick a runner");
    if (!runner.on_shift) throw bad(`${runner.name} is off shift`);
    const [zone] = await q.query(
      "select z.restricted from spots s join zones z on z.id = s.zone_id where s.id = $1",
      [order.spot_id],
    );
    if (zone?.restricted && !runner.can_enter_restricted) {
      throw bad(`${runner.name} can't enter that restricted area`);
    }

    const reassign = ["assigned", "buying", "on_the_way"].includes(order.status);
    if (!reassign && order.status !== "paid" && order.status !== "not_delivered") {
      throw conflict("This order can't be assigned now");
    }
    await q.query(
      "update orders set runner_id = $2, eta_at = $3, updated_at = now() where id = $1",
      [order.id, runner.id, etaFrom(etaMinutes)],
    );
    if (reassign) await logNote(q, order, staff.name, `Reassigned to ${runner.name}`);
    else await transition(q, order, "assigned", staff.name, `${runner.name} · ETA ${etaMinutes} min`);
  });
  notify({ venueId: staff.venue_id, orderId });
}

export async function setEta(ctx: Ctx, staff: StaffRow, orderId: string, etaMinutes: number) {
  await act(ctx, staff, orderId, async (q, order) => {
    if (!["assigned", "buying", "on_the_way"].includes(order.status)) {
      throw conflict("ETA only applies to orders in progress");
    }
    await q.query("update orders set eta_at = $2, updated_at = now() where id = $1", [
      order.id,
      etaFrom(etaMinutes),
    ]);
    await logNote(q, order, staff.name, `ETA set to ${etaMinutes} min`);
  });
}

export async function startBuying(ctx: Ctx, staff: StaffRow, orderId: string) {
  await act(ctx, staff, orderId, async (q, order) => {
    if (order.status === "assigned") await transition(q, order, "buying", staff.name);
  });
}

export async function logPurchase(
  ctx: Ctx,
  staff: StaffRow,
  orderId: string,
  input: { stopId: string; amountKobo: number; method: "cash" | "transfer"; receiptUrl?: string | undefined },
) {
  await act(ctx, staff, orderId, async (q, order) => {
    if (!["assigned", "buying"].includes(order.status)) {
      throw conflict("Purchases can only be logged while buying");
    }
    if (!order.runner_id) throw conflict("Assign a runner first");
    const [stop] = await q.query(
      "select * from order_stops where id = $1 and order_id = $2",
      [input.stopId, order.id],
    );
    if (!stop) throw notFound("Stall not found on this order");
    if (stop.status !== "pending") throw conflict("Already logged for this stall");
    const receipt = await persistImage(q, order.venue_id, input.receiptUrl);
    await q.query("update order_stops set status = 'bought' where id = $1", [stop.id]);
    // The float spent belongs to the runner on the order, even if dispatch logs it.
    await q.query(
      `insert into purchases (id, venue_id, order_id, order_stop_id, runner_id, amount_paid_kobo, method, receipt_url)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uid("pur"), order.venue_id, order.id, stop.id, order.runner_id, input.amountKobo, input.method, receipt],
    );
    if (order.status === "assigned") await transition(q, order, "buying", staff.name);
  });
}

/** Dropped items are refunded; if nothing is left, the whole order (fee included) is. */
async function recomputeRefund(q: Queryable, order: Row) {
  const items = await q.query(
    `select i.* from order_items i join order_stops s on s.id = i.order_stop_id
     where s.order_id = $1`,
    [order.id],
  );
  const dropped = items.filter((i) => i.status === "dropped");
  const refund =
    dropped.length === items.length
      ? order.total_kobo
      : dropped.reduce((s, i) => s + i.unit_price_kobo * i.qty, 0);
  await q.query("update orders set refund_kobo = $2 where id = $1", [order.id, refund]);
  order.refund_kobo = refund;
}

export async function setItemStatus(
  ctx: Ctx,
  staff: StaffRow,
  orderId: string,
  input: { stopId: string; itemId: string; status: ItemStatus; finalPriceKobo?: number | undefined; note?: string | undefined },
) {
  await act(ctx, staff, orderId, async (q, order) => {
    const [item] = await q.query(
      `select i.* from order_items i join order_stops s on s.id = i.order_stop_id
       where i.id = $1 and s.id = $2 and s.order_id = $3`,
      [input.itemId, input.stopId, order.id],
    );
    if (!item) throw notFound("Item not found");
    await q.query(
      `update order_items set status = $2, final_price_kobo = coalesce($3, final_price_kobo),
         note = coalesce($4, note) where id = $1`,
      [item.id, input.status, input.finalPriceKobo ?? null, input.note ?? null],
    );
    await recomputeRefund(q, order);
    await logNote(
      q,
      order,
      staff.name,
      `${item.name_snapshot}: ${input.status}${input.note ? ` (${input.note})` : ""}`,
    );
  });
}

export async function markStopUnavailable(ctx: Ctx, staff: StaffRow, orderId: string, stopId: string) {
  await act(ctx, staff, orderId, async (q, order) => {
    const [stop] = await q.query(
      "select * from order_stops where id = $1 and order_id = $2",
      [stopId, order.id],
    );
    if (!stop) throw notFound("Stall not found on this order");
    await q.query("update order_stops set status = 'unavailable' where id = $1", [stop.id]);
    await q.query("update order_items set status = 'dropped' where order_stop_id = $1", [stop.id]);
    await recomputeRefund(q, order);
    await logNote(q, order, staff.name, "A stall couldn't fill its part; refund due for those items");
  });
}

/** Blocked until every stall has a logged purchase or is marked unavailable. */
export async function goOnTheWay(ctx: Ctx, staff: StaffRow, orderId: string) {
  await act(ctx, staff, orderId, async (q, order) => {
    const stops = await q.query("select status from order_stops where order_id = $1", [order.id]);
    if (stops.some((s) => s.status === "pending")) {
      throw conflict("Log a purchase at every stall first");
    }
    if (stops.every((s) => s.status === "unavailable")) {
      await cancelInTx(q, order, staff.name, "Nothing available at the stalls");
      return;
    }
    await transition(q, order, "on_the_way", staff.name);
  });
}

/** Hand-off: the runner types the 4-digit PIN shown on the buyer's order page. */
export async function deliver(ctx: Ctx, staff: StaffRow, orderId: string, pin: string): Promise<boolean> {
  let ok = false;
  await act(ctx, staff, orderId, async (q, order) => {
    if (order.handoff_pin !== pin.trim()) return;
    await transition(q, order, "delivered", staff.name);
    ok = true;
  });
  return ok;
}

export async function markNotDelivered(ctx: Ctx, staff: StaffRow, orderId: string, note: string) {
  await act(ctx, staff, orderId, (q, order) =>
    transition(q, order, "not_delivered", staff.name, note),
  );
}

async function cancelInTx(q: Queryable, order: Row, actor: string, reason: string) {
  const refund = order.status === "awaiting_payment" ? 0 : order.total_kobo;
  await q.query("update orders set refund_kobo = $2 where id = $1", [order.id, refund]);
  await transition(
    q,
    order,
    "cancelled",
    actor,
    refund ? `${reason} · refund due ${formatNaira(refund)}` : reason,
  );
}

export async function cancelOrder(ctx: Ctx, staff: StaffRow, orderId: string, reason: string) {
  if (staff.role !== "admin" && staff.role !== "dispatch") throw forbidden();
  await act(ctx, staff, orderId, (q, order) => cancelInTx(q, order, staff.name, reason));
}
