import type { Order, Snapshot } from "@layovr/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { openDb, type Db } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { resetData } from "../src/db/seed";
import type { Env } from "../src/lib/env";
import type { PaymentGateway, VerifiedTransaction } from "../src/lib/flutterwave";
import { resetLimits } from "../src/lib/ratelimit";

/**
 * End-to-end over HTTP against an in-memory Postgres (PGlite):
 * scan → basket → pay → dispatch → buy → deliver, plus the trust rules.
 */

const env: Env = {
  production: false,
  port: 0,
  databaseUrl: undefined,
  dataDir: undefined,
  sessionSecret: "test-secret",
  flwSecretKey: undefined,
  flwSecretHash: "hash123",
  publicAppUrl: "http://app.test",
  showDemoPins: false,
  allowReset: true,
  seedOnEmpty: true,
};

const db: Db = await openDb({});
await migrate(db);

/** Fake Flutterwave: tests decide what "verify" returns. */
let nextVerify: Partial<VerifiedTransaction> = {};
const fakeGateway: PaymentGateway = {
  createPayment: async (i) => ({ link: `https://checkout.test/${i.txRef}` }),
  verify: async (transactionId) => ({
    successful: true,
    status: "successful",
    txRef: "",
    amountKobo: 0,
    currency: "NGN",
    transactionId,
    raw: {},
    ...nextVerify,
  }),
};

const demoApp = createApp({ db, env, gateway: null });
const flwApp = createApp({ db, env, gateway: fakeGateway });

type App = typeof demoApp;
async function call<T = unknown>(
  app: App,
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<{ status: number; json: T; cookie?: string }> {
  const res = await app.request(`/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = res.headers.get("set-cookie")?.split(";")[0];
  const text = await res.text();
  return {
    status: res.status,
    json: (text ? JSON.parse(text) : null) as T,
    ...(setCookie ? { cookie: setCookie } : {}),
  };
}

async function login(pin: string): Promise<string> {
  const r = await call(demoApp, "POST", "/auth/login", { pin });
  expect(r.status).toBe(200);
  return r.cookie!;
}

const basket = {
  venueId: "v_moonshot",
  spotId: "s_mbc",
  name: "Ngozi",
  phone: "08012345678",
  landmark: "blue shirt",
  cart: [
    { productId: "p_jollof", qty: 2 },
    { productId: "p_zobo", qty: 1 },
  ],
};

async function placeOrder(app: App = demoApp) {
  const r = await call<{ order: Order; payment: { mode: string; link: string } }>(
    app,
    "POST",
    "/orders",
    basket,
  );
  expect(r.status).toBe(200);
  return r.json;
}

beforeEach(async () => {
  await resetData(db);
  resetLimits();
  nextVerify = {};
});
afterAll(() => db.close());

describe("public data", () => {
  it("never sends PINs, PIN hashes or staff phone numbers to buyers", async () => {
    const r = await call<Snapshot>(demoApp, "GET", "/snapshot");
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.json);
    expect(text).not.toMatch(/pin_hash|"pin"|demoPin/);
    expect(r.json.staff.every((s) => s.phone === "" && s.role === "runner")).toBe(true);
    expect(r.json.orders).toEqual([]);
    expect(r.json.vendors.length).toBeGreaterThan(0);
  });
});

describe("checkout", () => {
  it("prices the basket on the server and adds the fee once", async () => {
    const { order, payment } = await placeOrder();
    // 2 × ₦4,500 + ₦1,000 = ₦10,000; fee = 4% (₦400) + ₦100 flat.
    expect(order.subtotalKobo).toBe(1_000_000);
    expect(order.feeKobo).toBe(50_000);
    expect(order.totalKobo).toBe(1_050_000);
    expect(order.stops).toHaveLength(2);
    expect(order.status).toBe("awaiting_payment");
    expect(order.code).toMatch(/^LV-[A-Z0-9]{4}$/);
    expect(payment).toEqual({ mode: "demo", link: `/pay/${order.id}?demo=1` });
  });

  it("ignores prices sent by the browser and rejects sold-out items", async () => {
    const tampered = await call<{ order: Order }>(demoApp, "POST", "/orders", {
      ...basket,
      cart: [{ productId: "p_jollof", qty: 1, priceKobo: 1 }],
    });
    expect(tampered.json.order.subtotalKobo).toBe(450_000);

    const soldOut = await call<{ error: string }>(demoApp, "POST", "/orders", {
      ...basket,
      cart: [{ productId: "p_samosa", qty: 1 }],
    });
    expect(soldOut.status).toBe(400);
    expect(soldOut.json.error).toMatch(/Sold out/);
  });

  it("only shows the hand-off PIN to the buyer", async () => {
    const { order } = await placeOrder();
    await call(demoApp, "POST", `/orders/${order.id}/demo-pay`);
    const buyer = await call<Snapshot>(demoApp, "GET", `/snapshot?orders=${order.id}`);
    expect(buyer.json.orders[0]?.handoffPin).toMatch(/^\d{4}$/);

    const dispatch = await login("2222");
    const staff = await call<Snapshot>(demoApp, "GET", "/snapshot", undefined, dispatch);
    expect(staff.json.orders.find((o) => o.id === order.id)?.handoffPin).toBe("");
  });
});

describe("full delivery", () => {
  it("goes paid → assigned → buying → on the way → delivered", async () => {
    const { order } = await placeOrder();
    const paid = await call<Order>(demoApp, "POST", `/orders/${order.id}/demo-pay`);
    expect(paid.json.status).toBe("paid");
    const pin = paid.json.handoffPin;

    const dispatch = await login("2222");
    const kemi = await login("3333");
    const bayo = await login("4444");

    expect(
      (await call(demoApp, "POST", `/orders/${order.id}/assign`, { runnerId: "st_kemi", etaMinutes: 15 }, dispatch)).status,
    ).toBe(200);

    // Another runner can't touch it.
    expect((await call(demoApp, "POST", `/orders/${order.id}/start-buying`, {}, bayo)).status).toBe(403);

    // Can't leave before buying at every stall.
    expect((await call(demoApp, "POST", `/orders/${order.id}/on-the-way`, {}, kemi)).status).toBe(409);

    const [s1, s2] = paid.json.stops;
    await call(demoApp, "POST", `/orders/${order.id}/purchases`, { stopId: s1!.id, amountKobo: 900_000, method: "cash" }, kemi);
    await call(demoApp, "POST", `/orders/${order.id}/purchases`, { stopId: s2!.id, amountKobo: 100_000, method: "transfer" }, kemi);
    expect((await call(demoApp, "POST", `/orders/${order.id}/on-the-way`, {}, kemi)).status).toBe(200);

    const wrong = await call<{ ok: boolean }>(demoApp, "POST", `/orders/${order.id}/deliver`, { pin: pin === "1234" ? "4321" : "1234" }, kemi);
    expect(wrong.json.ok).toBe(false);
    const right = await call<{ ok: boolean }>(demoApp, "POST", `/orders/${order.id}/deliver`, { pin }, kemi);
    expect(right.json.ok).toBe(true);

    const after = await call<Snapshot>(demoApp, "GET", `/snapshot?orders=${order.id}`, undefined, dispatch);
    const o = after.json.orders.find((x) => x.id === order.id)!;
    expect(o.status).toBe("delivered");
    expect(o.events.map((e) => e.status)).toEqual([
      "awaiting_payment", "paid", "assigned", "buying", "on_the_way", "delivered",
    ]);
    // Float spend is logged against Kemi.
    expect(after.json.purchases.filter((p) => p.runnerId === "st_kemi").reduce((s, p) => s + p.amountKobo, 0)).toBe(1_000_000);
  });

  it("keeps restricted zones for runners with access", async () => {
    await db.query("update zones set restricted = true where id = 'z_bowl'");
    const { order } = await placeOrder();
    await call(demoApp, "POST", `/orders/${order.id}/demo-pay`);
    const dispatch = await login("2222");
    const r = await call<{ error: string }>(demoApp, "POST", `/orders/${order.id}/assign`, { runnerId: "st_kemi", etaMinutes: 10 }, dispatch);
    expect(r.status).toBe(400);
    const ok = await call(demoApp, "POST", `/orders/${order.id}/assign`, { runnerId: "st_chidi", etaMinutes: 10 }, dispatch);
    expect(ok.status).toBe(200);
  });

  it("refunds dropped items, and everything when a whole order can't be filled", async () => {
    const { order } = await placeOrder();
    await call(demoApp, "POST", `/orders/${order.id}/demo-pay`);
    const dispatch = await login("2222");
    await call(demoApp, "POST", `/orders/${order.id}/assign`, { runnerId: "st_kemi", etaMinutes: 10 }, dispatch);
    const [s1, s2] = order.stops;
    await call(demoApp, "POST", `/orders/${order.id}/stops/${s2!.id}/unavailable`, {}, dispatch);
    let snap = await call<Snapshot>(demoApp, "GET", `/snapshot?orders=${order.id}`);
    expect(snap.json.orders[0]?.refundKobo).toBe(100_000);

    await call(demoApp, "POST", `/orders/${order.id}/stops/${s1!.id}/unavailable`, {}, dispatch);
    await call(demoApp, "POST", `/orders/${order.id}/on-the-way`, {}, dispatch);
    snap = await call<Snapshot>(demoApp, "GET", `/snapshot?orders=${order.id}`);
    expect(snap.json.orders[0]?.status).toBe("cancelled");
    expect(snap.json.orders[0]?.refundKobo).toBe(order.totalKobo);
  });
});

describe("Flutterwave", () => {
  it("marks paid only after a matching verify, and only once", async () => {
    const { order, payment } = await placeOrder(flwApp);
    expect(payment.mode).toBe("flutterwave");
    const txRef = payment.link.split("/").pop()!;

    nextVerify = { txRef, amountKobo: order.totalKobo - 100 };
    let r = await call<{ ok: boolean }>(flwApp, "POST", `/orders/${order.id}/verify`, { transactionId: "111" });
    expect(r.json.ok).toBe(false);

    nextVerify = { txRef, amountKobo: order.totalKobo, currency: "USD" };
    r = await call(flwApp, "POST", `/orders/${order.id}/verify`, { transactionId: "111" });
    expect(r.json.ok).toBe(false);

    nextVerify = { txRef, amountKobo: order.totalKobo };
    r = await call(flwApp, "POST", `/orders/${order.id}/verify`, { transactionId: "111" });
    expect(r.json.ok).toBe(true);

    // Webhook for the same transaction is a no-op.
    const hook = await flwApp.request("/api/flw/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "verif-hash": "hash123" },
      body: JSON.stringify({ event: "charge.completed", data: { id: 111 } }),
    });
    expect(hook.status).toBe(200);

    const snap = await call<Snapshot>(flwApp, "GET", `/snapshot?orders=${order.id}`);
    const o = snap.json.orders[0]!;
    expect(o.status).toBe("paid");
    expect(o.events.filter((e) => e.status === "paid")).toHaveLength(1);
    expect(o.payment?.transactionId).toBe("111");
  });

  it("rejects webhooks without the secret hash and blocks demo pay", async () => {
    const bad = await flwApp.request("/api/flw/webhook", {
      method: "POST",
      headers: { "verif-hash": "nope" },
      body: "{}",
    });
    expect(bad.status).toBe(401);
    const { order } = await placeOrder(flwApp);
    expect((await call(flwApp, "POST", `/orders/${order.id}/demo-pay`)).status).toBe(403);
  });
});

describe("tracking and sign-in", () => {
  it("returns status only for phone lookups", async () => {
    const { order } = await placeOrder();
    const r = await call<Record<string, unknown>[]>(demoApp, "GET", "/track?q=0801%20234%205678");
    expect(r.json).toHaveLength(1);
    expect(Object.keys(r.json[0]!).sort()).toEqual(["code", "createdAt", "status", "totalKobo"]);
    expect(JSON.stringify(r.json)).not.toContain(order.id);
  });

  it("rate-limits PIN guessing", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await call(demoApp, "POST", "/auth/login", { pin: "9999" })).status;
    }
    expect(last).toBe(429);
  });

  it("keeps menu capture inside the staff member's role", async () => {
    const runner = await login("3333");
    const r = await call(demoApp, "PUT", "/admin/products/p_new", {
      id: "p_new", vendorId: "vd_pot", category: "Mains", kind: "goods", name: "Moi moi",
      priceKobo: 100_000, priceCheckedAt: "2026-10-28", inStock: true, fulfilment: "deliver",
    }, runner);
    expect(r.status).toBe(403);
    const capture = await login("6666");
    const ok = await call(demoApp, "PUT", "/admin/products/p_new", {
      id: "p_new", vendorId: "vd_pot", category: "Mains", kind: "goods", name: "Moi moi",
      priceKobo: 100_000, priceCheckedAt: "2026-10-28", inStock: true, fulfilment: "deliver",
      imageUrl: "data:image/webp;base64,UklGRhYAAABXRUJQVlA4IAoAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v3AgAA=",
    }, capture);
    expect(ok.status).toBe(200);
    const snap = await call<Snapshot>(demoApp, "GET", "/snapshot");
    const url = snap.json.products.find((p) => p.id === "p_new")?.imageUrl;
    expect(url).toMatch(/^\/api\/uploads\/img_/);
    const img = await demoApp.request(url!);
    expect(img.headers.get("content-type")).toBe("image/webp");
  });
});
