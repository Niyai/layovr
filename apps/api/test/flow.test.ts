import { checkPlan, fitGeo, moonshotPlan, nearestSpot, type Order, type Snapshot } from "@layovr/shared";
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
  geoUserAgent: "Layovr tests",
  showDemoLogins: false,
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
  const r = await call(demoApp, "POST", "/auth/login", { code: "MOONSHOT", pin });
  expect(r.status).toBe(200);
  return r.cookie!;
}

const basket = {
  venueId: "v_moonshot",
  spotId: "s_moonshot_b0exh11",
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
    await db.query("update zones set restricted = true where id = 'z_moonshot_exh1'");
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
      last = (await call(demoApp, "POST", "/auth/login", { code: "MOONSHOT", pin: "9999" })).status;
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

describe("venue plans", () => {
  it("ships a valid Moonshot plan", () => {
    const check = checkPlan(moonshotPlan);
    expect(check.errors).toEqual([]);
    // Only the "approximate" reminders, nothing drawn in the wrong place.
    expect(check.warnings.every((w) => w.includes("approximate"))).toBe(true);
  });

  it("seeds areas, levels and spots from the plan", async () => {
    const snap = await call<Snapshot>(demoApp, "GET", "/snapshot");
    const venue = snap.json.venues.find((v) => v.code === "MOONSHOT")!;
    expect(venue.plan?.levels).toHaveLength(7);
    expect(venue.plan?.sections.map((s) => s.code)).toEqual(["A", "B", "D"]);
    const exh1 = snap.json.zones.find((z) => z.code === "EXH1")!;
    expect(exh1).toMatchObject({ section: "B", level: 0, kind: "exhibition" });
    expect(snap.json.zones.find((z) => z.code === "BOWL")?.level).toBeUndefined();
    expect(snap.json.spots.find((s) => s.code === "B0-EXH1-1")?.zoneId).toBe(exh1.id);
  });

  it("checks a file without applying it, and refuses another venue's plan", async () => {
    const admin = await login("1111");
    const bad = await call<{ ok: boolean; errors: string[] }>(
      demoApp, "POST", "/admin/plan?dryRun=1",
      { ...moonshotPlan, spots: [{ code: "X0-NOPE-1", area: "NOPE", label: "x", x: 1, y: 1 }] },
      admin,
    );
    expect(bad.json.ok).toBe(false);
    expect(bad.json.errors[0]).toMatch(/unknown area NOPE/);

    const other = await call<{ errors: string[] }>(demoApp, "POST", "/admin/plan", { ...moonshotPlan, venue: { ...moonshotPlan.venue, code: "ELSEWHERE" } }, admin);
    expect(other.json.errors.join()).toMatch(/signed in to MOONSHOT/);
  });

  it("round-trips: export, edit, re-import updates in place", async () => {
    const admin = await login("1111");
    const exported = await call<typeof moonshotPlan>(demoApp, "GET", "/admin/plan", undefined, admin);
    expect(checkPlan(exported.json).errors).toEqual([]);
    const edited = {
      ...exported.json,
      areas: exported.json.areas.map((a) => (a.code === "EXH2" ? { ...a, access: "restricted" as const } : a)),
      markers: exported.json.markers!.map((m) => (m.label === "Zone A entrance" ? { ...m, status: "blocked" as const } : m)),
    };
    const r = await call<{ applied: boolean }>(demoApp, "POST", "/admin/plan", edited, admin);
    expect(r.json.applied).toBe(true);
    const snap = await call<Snapshot>(demoApp, "GET", "/snapshot", undefined, admin);
    expect(snap.json.zones.filter((z) => z.code === "EXH2")).toHaveLength(1);
    expect(snap.json.zones.find((z) => z.code === "EXH2")?.restricted).toBe(true);
    const venue = snap.json.venues.find((v) => v.code === "MOONSHOT")!;
    expect(venue.plan?.markers.find((m) => m.label === "Zone A entrance")?.status).toBe("blocked");
  });
});

describe("raise your phone", () => {
  async function onTheWay(spotId: string, runnerPin: string, runnerId: string) {
    const r = await call<{ order: Order }>(demoApp, "POST", "/orders", { ...basket, spotId, cart: [{ productId: "p_zobo", qty: 1 }] });
    const id = r.json.order.id;
    await call(demoApp, "POST", `/orders/${id}/demo-pay`);
    const dispatch = await login("2222");
    await call(demoApp, "POST", `/orders/${id}/assign`, { runnerId, etaMinutes: 5 }, dispatch);
    const runner = await login(runnerPin);
    await call(demoApp, "POST", `/orders/${id}/purchases`, { stopId: r.json.order.stops[0]!.id, amountKobo: 100_000, method: "cash" }, runner);
    await call(demoApp, "POST", `/orders/${id}/on-the-way`, {}, runner);
    return { id, runner };
  }
  const signalOf = async (id: string) =>
    (await call<Snapshot>(demoApp, "GET", `/snapshot?orders=${id}`)).json.orders[0]!.match;

  it("never gives two pairs in the same area the same colour", async () => {
    const a = await onTheWay("s_moonshot_b0exh11", "3333", "st_kemi");
    const b = await onTheWay("s_moonshot_b0exh12", "4444", "st_bayo"); // same hall, other spot
    const c = await onTheWay("s_moonshot_d0banq1", "5555", "st_chidi"); // different area

    expect((await call(demoApp, "POST", `/orders/${a.id}/arrive`, {}, a.runner)).status).toBe(200);
    await call(demoApp, "POST", `/orders/${b.id}/arrive`, {}, b.runner);
    await call(demoApp, "POST", `/orders/${c.id}/arrive`, {}, c.runner);
    const [sa, sb, sc] = [await signalOf(a.id), await signalOf(b.id), await signalOf(c.id)];
    expect(sa).toEqual({ color: "blue", pattern: "solid" });
    expect(sb).not.toEqual(sa);
    expect(sc).toEqual(sa); // another area may reuse it

    // Arriving again keeps the same signal.
    await call(demoApp, "POST", `/orders/${a.id}/arrive`, {}, a.runner);
    expect(await signalOf(a.id)).toEqual(sa);
  });

  it("frees the colour after hand-off and only works once on the way", async () => {
    const a = await onTheWay("s_moonshot_b0exh11", "3333", "st_kemi");
    await call(demoApp, "POST", `/orders/${a.id}/arrive`, {}, a.runner);
    const pin = (await call<Snapshot>(demoApp, "GET", `/snapshot?orders=${a.id}`)).json.orders[0]!.handoffPin;
    await call(demoApp, "POST", `/orders/${a.id}/deliver`, { pin }, a.runner);

    const b = await onTheWay("s_moonshot_b0exh12", "4444", "st_bayo");
    await call(demoApp, "POST", `/orders/${b.id}/arrive`, {}, b.runner);
    expect(await signalOf(b.id)).toEqual({ color: "blue", pattern: "solid" });

    const { order } = await placeOrder();
    await call(demoApp, "POST", `/orders/${order.id}/demo-pay`);
    expect((await call(demoApp, "POST", `/orders/${order.id}/arrive`, {}, await login("2222"))).status).toBe(409);
  });
});

describe("finding the buyer without a QR scan", () => {
  const geo = moonshotPlan.canvas.geo!.points;
  const fit = fitGeo(geo)!;

  it("converts GPS to the plan and back within a metre", () => {
    const [lat, lng] = fit.toGeo(72.5, 31.2);
    const [x, y] = fit.toCanvas(lat, lng);
    expect(Math.hypot(x - 72.5, y - 31.2) * fit.metresPerUnit).toBeLessThan(1);
  });

  it("picks the nearest spot inside the tapped area", async () => {
    const snap = (await call<Snapshot>(demoApp, "GET", "/snapshot")).json;
    const zones = snap.zones.filter((z) => z.venueId === "v_moonshot");
    // Inside Exhibition Hall 2, nearer the back wall.
    const x = 50 + 26 * Math.sin((325 * Math.PI) / 180), y = 50 - 26 * Math.cos((325 * Math.PI) / 180);
    expect(nearestSpot(snap.spots, zones, x, y, 0)?.code).toBe("B0-EXH2-2");
  });

  it("stores how the buyer located themselves, and rejects points off the map", async () => {
    const ok = await call<{ order: Order }>(demoApp, "POST", "/orders", {
      ...basket,
      pinpoint: { method: "map", x: 61.2, y: 33.4, level: 0 },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.order.pinpoint).toEqual({ method: "map", x: 61.2, y: 33.4, level: 0 });

    const off = await call<{ error: string }>(demoApp, "POST", "/orders", {
      ...basket,
      pinpoint: { method: "gps", x: 400, y: 20, accuracyM: 30 },
    });
    expect(off.status).toBe(400);
    expect(off.json.error).toMatch(/outside the venue map/);
  });
});

describe("runner live location", () => {
  it("is shared only on an order, shown to dispatch, distance-only to the buyer, and forgotten after hand-off", async () => {
    const kemi = await login("3333");
    // No active order: nothing stored.
    const idle = await call<{ sharing: boolean }>(demoApp, "POST", "/runner/location", { lat: 6.4766, lng: 3.3694, accuracyM: 15 }, kemi);
    expect(idle.json.sharing).toBe(false);

    const { order } = await placeOrder();
    const paid = await call<Order>(demoApp, "POST", `/orders/${order.id}/demo-pay`);
    const dispatch = await login("2222");
    await call(demoApp, "POST", `/orders/${order.id}/assign`, { runnerId: "st_kemi", etaMinutes: 5 }, dispatch);
    for (const st of order.stops) {
      await call(demoApp, "POST", `/orders/${order.id}/purchases`, { stopId: st.id, amountKobo: 100_000, method: "cash" }, kemi);
    }
    await call(demoApp, "POST", `/orders/${order.id}/on-the-way`, {}, kemi);

    // Dispatch can't post a location; Kemi can.
    expect((await call(demoApp, "POST", "/runner/location", { lat: 6.4766, lng: 3.3694, accuracyM: 15 }, dispatch)).status).toBe(403);
    const sharing = await call<{ sharing: boolean }>(demoApp, "POST", "/runner/location", { lat: 6.4766, lng: 3.3694, accuracyM: 15 }, kemi);
    expect(sharing.json.sharing).toBe(true);

    const ops = (await call<Snapshot>(demoApp, "GET", "/snapshot", undefined, dispatch)).json;
    const pos = ops.runnerPositions.find((p) => p.runnerId === "st_kemi")!;
    expect(pos.accuracyM).toBe(15);
    const [ex, ey] = fitGeo(moonshotPlan.canvas.geo!.points)!.toCanvas(6.4766, 3.3694);
    expect(pos.x).toBeCloseTo(ex, 3);
    expect(pos.y).toBeCloseTo(ey, 3);

    const buyerView = (await call<Snapshot>(demoApp, "GET", `/snapshot?orders=${order.id}`)).json;
    expect(buyerView.runnerPositions).toEqual([]);
    expect(JSON.stringify(buyerView)).not.toContain("6.4766");
    const dist = buyerView.orders[0]!.runnerDistanceM!;
    expect(dist).toBeGreaterThanOrEqual(10);
    expect(dist).toBeLessThan(60);

    // Other buyers see nothing.
    expect((await call<Snapshot>(demoApp, "GET", "/snapshot")).json.orders).toEqual([]);

    await call(demoApp, "POST", `/orders/${order.id}/deliver`, { pin: paid.json.handoffPin }, kemi);
    const after = (await call<Snapshot>(demoApp, "GET", "/snapshot", undefined, dispatch)).json;
    expect(after.runnerPositions).toEqual([]);
  });

  it("lets admins calibrate the plan with GPS points", async () => {
    const admin = await login("1111");
    const tooClose = await call(demoApp, "PATCH", "/admin/plan/geo", { points: [{ x: 0, y: 0, lat: 6.5, lng: 3.4 }, { x: 10, y: 0, lat: 6.5, lng: 3.4 }] }, admin);
    expect(tooClose.status).toBe(400);
    const r = await call<{ residualM: number[] }>(demoApp, "PATCH", "/admin/plan/geo", { points: [
      { x: 50, y: 50, lat: 6.47639, lng: 3.36944 },
      { x: 50, y: 97, lat: 6.47576, lng: 3.36944 },
    ] }, admin);
    expect(r.status).toBe(200);
    const venue = (await call<Snapshot>(demoApp, "GET", "/snapshot")).json.venues.find((v) => v.code === "MOONSHOT")!;
    expect(venue.plan?.canvas.geo).toMatchObject({ approximate: false });
    expect((await call(demoApp, "PATCH", "/admin/plan/geo", { points: [] }, await login("2222"))).status).toBe(400);
  });
});
