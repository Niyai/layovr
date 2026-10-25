import type { TrackResult } from "@layovr/shared";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Ctx, StaffRow } from "./context";
import { resetData } from "./db/seed";
import {
  SESSION_COOKIE,
  checkPin,
  readSession,
  safeEqual,
  sessionMaxAge,
  signSession,
} from "./lib/auth";
import { HttpError, bad, forbidden } from "./lib/errors";
import { notify, onChange } from "./lib/events";
import { limit } from "./lib/ratelimit";
import * as admin from "./services/admin";
import { toStaff } from "./services/mappers";
import * as orders from "./services/orders";
import { buildSnapshot } from "./services/snapshot";

type Env = { Variables: { staff: StaffRow | null } };

const id = z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/);
const minutes = z.number().int().min(1).max(240);
const kobo = z.number().int().min(0).max(100_000_000);
const shortText = (max = 200) => z.string().trim().max(max);
const image = z.string().max(3_000_000).optional();

const schemas = {
  login: z.object({ pin: z.string().regex(/^\d{4,6}$/) }),
  createOrder: z.object({
    venueId: id,
    spotId: id,
    name: shortText(80).min(1),
    phone: z.string().trim().regex(/^\+?[0-9 ]{10,15}$/, "Please enter a valid phone number."),
    email: z.string().trim().email().max(120).optional(),
    landmark: shortText(200).optional(),
    cart: z
      .array(z.object({ productId: id, qty: z.number().int().min(1).max(20), note: shortText(200).optional() }))
      .min(1, "Your basket is empty")
      .max(40),
  }),
  verify: z.object({ transactionId: z.string().min(1).max(40) }),
  assign: z.object({ runnerId: id, etaMinutes: minutes }),
  eta: z.object({ etaMinutes: minutes }),
  purchase: z.object({
    stopId: id,
    amountKobo: kobo.min(1),
    method: z.enum(["cash", "transfer"]),
    receiptUrl: image,
  }),
  item: z.object({
    stopId: id,
    status: z.enum(["ok", "swapped", "dropped"]),
    finalPriceKobo: kobo.optional(),
    note: shortText().optional(),
  }),
  pin: z.object({ pin: z.string().regex(/^\d{4}$/) }),
  note: z.object({ note: shortText().min(1) }),
  reason: z.object({ reason: shortText().min(1) }),
  venue: z.object({
    name: shortText(120).min(1).optional(),
    city: shortText(120).optional(),
    feePct: z.number().min(0).max(0.5).optional(),
    feeFlatKobo: kobo.optional(),
    absorbLimitKobo: kobo.optional(),
    floorPlanUrl: z.string().max(3_000_000).optional(),
    isLive: z.boolean().optional(),
  }),
  zone: z.object({
    name: shortText(80).min(1).optional(),
    restricted: z.boolean().optional(),
    rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  }),
  spot: z.object({
    id,
    venueId: z.string().optional(),
    zoneId: id,
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,24}$/, "Codes use letters, numbers and dashes"),
    label: shortText(120).min(1),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    landmark: shortText().optional(),
    directions: shortText(400).optional(),
    active: z.boolean(),
  }),
  vendor: z.object({
    id,
    venueId: z.string().optional(),
    name: shortText(80).min(1),
    emoji: shortText(16),
    category: shortText(60),
    description: shortText(400),
    zoneId: id.optional(),
    stallLabel: shortText(120).min(1),
    isOpen: z.boolean(),
    prepMinutes: z.number().int().min(0).max(240),
    fill: z.enum(["sun", "coral", "lilac", "mint", "blush", "card"]),
  }),
  product: z.object({
    id,
    vendorId: id,
    category: shortText(60).min(1),
    kind: z.enum(["goods", "service"]),
    name: shortText(120).min(1),
    description: shortText(400).optional(),
    priceKobo: kobo.min(1),
    priceCheckedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
    imageUrl: image,
    inStock: z.boolean(),
    fulfilment: z.enum(["deliver", "collect_and_return", "reserve_slot"]),
    durationMin: z.number().int().min(1).max(1440).optional(),
    ageRestricted: z.boolean().optional(),
  }),
  staff: z.object({
    onShift: z.boolean().optional(),
    floatKobo: kobo.optional(),
    canEnterRestricted: z.boolean().optional(),
  }),
};

/** Drops undefined keys so zod output fits exactOptionalPropertyTypes. */
function clean<T extends object>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
}

async function body<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  const json = await c.req.json().catch(() => {
    throw bad("Expected a JSON body");
  });
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw bad(parsed.error.issues[0]?.message ?? "Invalid request");
  }
  return parsed.data;
}

const ip = (c: Context) =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
  c.req.header("x-real-ip") ??
  "local";

export function createApp(ctx: Ctx) {
  const app = new Hono<Env>().basePath("/api");

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error("[api]", err);
    return c.json({ error: "Something went wrong. Please try again." }, 500);
  });

  // Photos arrive as compressed data URLs; nothing legitimate is bigger than this.
  app.use(bodyLimit({ maxSize: 4 * 1024 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) }));

  // Who is signed in (staff), from the signed session cookie.
  app.use(async (c, next) => {
    const staffId = readSession(getCookie(c, SESSION_COOKIE), ctx.env.sessionSecret);
    let staff: StaffRow | null = null;
    if (staffId) {
      const [row] = await ctx.db.query<StaffRow>("select * from staff where id = $1", [staffId]);
      staff = row ?? null;
    }
    c.set("staff", staff);
    await next();
  });

  const requireStaff = (c: Context<Env>): StaffRow => {
    const s = c.get("staff");
    if (!s) throw new HttpError(401, "Please sign in again");
    return s;
  };

  app.get("/health", async (c) => {
    await ctx.db.query("select 1");
    return c.json({ ok: true, db: ctx.db.driver, payments: ctx.gateway ? "flutterwave" : "demo" });
  });

  /* ---------------------------------------------------------- reads */

  app.get("/snapshot", async (c) => {
    const ids = (c.req.query("orders") ?? "")
      .split(",")
      .filter((x) => id.safeParse(x).success)
      .slice(0, 30);
    c.header("Cache-Control", "no-store");
    return c.json(await buildSnapshot(ctx, c.get("staff"), ids));
  });

  // Live updates: browsers refetch their snapshot when something changes.
  app.get("/stream", (c) =>
    streamSSE(c, async (stream) => {
      let pending = false;
      const off = onChange(() => {
        if (pending) return;
        pending = true;
        // Coalesce bursts (one action can write several rows).
        setTimeout(() => {
          pending = false;
          void stream.writeSSE({ event: "change", data: "1" });
        }, 150);
      });
      stream.onAbort(off);
      await stream.writeSSE({ event: "ready", data: "1" });
      while (!stream.aborted) {
        await stream.sleep(25_000);
        await stream.writeSSE({ event: "ping", data: "" });
      }
      off();
    }),
  );

  app.get("/uploads/:id", async (c) => {
    const [row] = await ctx.db.query("select content_type, data from uploads where id = $1", [
      c.req.param("id"),
    ]);
    if (!row) return c.notFound();
    return c.body(new Uint8Array(row.data), 200, {
      "Content-Type": row.content_type,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  /** Status-only lookup by LV code or phone. Never returns names, items or the order link. */
  app.get("/track", async (c) => {
    limit(`track:${ip(c)}`, 20, 10 * 60_000);
    const raw = (c.req.query("q") ?? "").trim().toUpperCase();
    const digits = raw.replace(/\D/g, "").slice(-10);
    let rows;
    if (raw.startsWith("LV-")) {
      rows = await ctx.db.query("select * from orders where code = $1", [raw]);
    } else if (digits.length === 10) {
      rows = await ctx.db.query(
        `select * from orders where right(regexp_replace(customer_phone, '\\D', '', 'g'), 10) = $1
         order by created_at desc limit 10`,
        [digits],
      );
    } else {
      throw bad("Enter an order code (LV-…) or the phone number you ordered with");
    }
    return c.json(
      rows.map(
        (o): TrackResult => ({
          code: o.code,
          status: o.status,
          totalKobo: o.total_kobo,
          createdAt: new Date(o.created_at).toISOString(),
        }),
      ),
    );
  });

  /* ---------------------------------------------------------- staff auth */

  app.post("/auth/login", async (c) => {
    limit(`login:${ip(c)}`, 10, 5 * 60_000);
    const { pin } = await body(c, schemas.login);
    const all = await ctx.db.query<StaffRow>("select * from staff");
    const me = all.find((s) => checkPin(pin, s.pin_hash));
    if (!me) throw new HttpError(401, "That PIN doesn't match anyone on shift.");
    setCookie(c, SESSION_COOKIE, signSession(me.id, ctx.env.sessionSecret), {
      httpOnly: true,
      sameSite: "Lax",
      secure: ctx.env.production,
      path: "/",
      maxAge: sessionMaxAge,
    });
    return c.json(toStaff(me));
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  /* ---------------------------------------------------------- buyer checkout */

  app.post("/orders", async (c) => {
    limit(`order:${ip(c)}`, 30, 10 * 60_000);
    const input = await body(c, schemas.createOrder);
    const order = await orders.createOrder(ctx, clean({ ...input, cart: input.cart.map(clean) }));
    const payment = await orders.startPayment(ctx, order.id);
    return c.json({ order, payment });
  });

  app.post("/orders/:id/pay", async (c) => {
    limit(`pay:${ip(c)}`, 30, 10 * 60_000);
    return c.json(await orders.startPayment(ctx, c.req.param("id")));
  });

  // Called by /pay/:orderId after Flutterwave redirects back (the webhook may be late).
  app.post("/orders/:id/verify", async (c) => {
    limit(`verify:${ip(c)}`, 30, 10 * 60_000);
    if (!ctx.gateway) throw bad("Flutterwave is not configured");
    const { transactionId } = await body(c, schemas.verify);
    const res = await orders.verifyAndMarkPaid(
      { ...ctx, gateway: ctx.gateway },
      transactionId,
      c.req.param("id"),
    );
    return c.json({ ok: res.ok });
  });

  app.post("/orders/:id/demo-pay", async (c) => c.json(await orders.demoPay(ctx, c.req.param("id"))));

  /** Flutterwave webhook. Set this URL and the secret hash in the Flutterwave dashboard. */
  app.post("/flw/webhook", async (c) => {
    const expected = ctx.env.flwSecretHash;
    const got = c.req.header("verif-hash") ?? "";
    if (!expected || !safeEqual(got, expected)) return c.text("Invalid signature", 401);
    const payload = (await c.req.json().catch(() => null)) as { data?: { id?: number } } | null;
    const txId = payload?.data?.id;
    if (!txId || !ctx.gateway) return c.text("ok");
    const res = await orders.verifyAndMarkPaid({ ...ctx, gateway: ctx.gateway }, String(txId));
    console.info("[flw-webhook]", txId, res);
    return c.text("ok");
  });

  /* ---------------------------------------------------------- dispatch + runner */

  const orderAction = (
    path: string,
    run: (c: Context<Env>, staff: StaffRow, orderId: string) => Promise<unknown>,
  ) =>
    app.post(`/orders/:id/${path}`, async (c) => {
      const staff = requireStaff(c);
      const result = await run(c, staff, c.req.param("id"));
      return c.json(result ?? { ok: true });
    });

  orderAction("assign", async (c, s, oid) => {
    const b = await body(c, schemas.assign);
    await orders.assignRunner(ctx, s, oid, b.runnerId, b.etaMinutes);
  });
  orderAction("eta", async (c, s, oid) => {
    await orders.setEta(ctx, s, oid, (await body(c, schemas.eta)).etaMinutes);
  });
  orderAction("start-buying", (_c, s, oid) => orders.startBuying(ctx, s, oid));
  orderAction("purchases", async (c, s, oid) => {
    await orders.logPurchase(ctx, s, oid, clean(await body(c, schemas.purchase)));
  });
  orderAction("items/:itemId", async (c, s, oid) => {
    const b = clean(await body(c, schemas.item));
    await orders.setItemStatus(ctx, s, oid, { ...b, itemId: c.req.param("itemId") ?? "" });
  });
  orderAction("stops/:stopId/unavailable", (c, s, oid) =>
    orders.markStopUnavailable(ctx, s, oid, c.req.param("stopId") ?? ""),
  );
  orderAction("on-the-way", (_c, s, oid) => orders.goOnTheWay(ctx, s, oid));
  orderAction("deliver", async (c, s, oid) => {
    limit(`deliver:${oid}`, 8, 10 * 60_000);
    const { pin } = await body(c, schemas.pin);
    return { ok: await orders.deliver(ctx, s, oid, pin) };
  });
  orderAction("not-delivered", async (c, s, oid) => {
    await orders.markNotDelivered(ctx, s, oid, (await body(c, schemas.note)).note);
  });
  orderAction("cancel", async (c, s, oid) => {
    await orders.cancelOrder(ctx, s, oid, (await body(c, schemas.reason)).reason);
  });

  app.patch("/staff/:id", async (c) => {
    await admin.updateStaff(ctx, requireStaff(c), c.req.param("id"), clean(await body(c, schemas.staff)));
    return c.json({ ok: true });
  });

  /* ---------------------------------------------------------- admin + menu capture */

  app.patch("/admin/venues/:id", async (c) => {
    await admin.updateVenue(ctx, requireStaff(c), c.req.param("id"), clean(await body(c, schemas.venue)));
    return c.json({ ok: true });
  });
  app.patch("/admin/zones/:id", async (c) => {
    await admin.updateZone(ctx, requireStaff(c), c.req.param("id"), clean(await body(c, schemas.zone)));
    return c.json({ ok: true });
  });
  app.put("/admin/spots/:id", async (c) => {
    const spot = clean(await body(c, schemas.spot));
    await admin.upsertSpot(ctx, requireStaff(c), { ...spot, id: c.req.param("id"), venueId: "" });
    return c.json({ ok: true });
  });
  app.delete("/admin/spots/:id", async (c) => {
    await admin.deleteSpot(ctx, requireStaff(c), c.req.param("id"));
    return c.json({ ok: true });
  });
  app.put("/admin/vendors/:id", async (c) => {
    const v = clean(await body(c, schemas.vendor));
    await admin.upsertVendor(ctx, requireStaff(c), { ...v, id: c.req.param("id"), venueId: "" });
    return c.json({ ok: true });
  });
  app.put("/admin/products/:id", async (c) => {
    const p = clean(await body(c, schemas.product));
    await admin.upsertProduct(ctx, requireStaff(c), { ...p, id: c.req.param("id") });
    return c.json({ ok: true });
  });
  app.delete("/admin/products/:id", async (c) => {
    await admin.deleteProduct(ctx, requireStaff(c), c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/admin/reset", async (c) => {
    const staff = requireStaff(c);
    if (staff.role !== "admin" || !ctx.env.allowReset) throw forbidden();
    await resetData(ctx.db);
    notify({ venueId: staff.venue_id });
    return c.json({ ok: true });
  });

  return app;
}
