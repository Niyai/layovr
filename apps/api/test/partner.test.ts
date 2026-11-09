import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { VENUE_LIBRARY, checkPlan, type Snapshot, type VenuePlan } from "@layovr/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { openDb, type Db } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { resetData } from "../src/db/seed";
import type { Env } from "../src/lib/env";
import { resetLimits } from "../src/lib/ratelimit";

/** Partners setting up their own events: dashboard API, API keys, MCP. */

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
  showDemoLogins: true,
};

const db: Db = await openDb({});
await migrate(db);
const app = createApp({ db, env, gateway: null });

type Res<T> = { status: number; json: T; cookie?: string };
async function call<T = any>(method: string, path: string, body?: unknown, auth?: { cookie?: string; key?: string }): Promise<Res<T>> {
  const res = await app.request(`/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
      ...(auth?.key ? { authorization: `Bearer ${auth.key}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T, ...(cookie ? { cookie } : {}) };
}

async function signup(email = "ada@lagosfest.ng", organisation = "Lagos Fest") {
  const r = await call("POST", "/partner/signup", { name: "Ada", organisation, email, password: "correct horse" });
  expect(r.status).toBe(200);
  return { cookie: r.cookie! };
}

const landmark = {
  name: "Lagos Tech Fest 2026",
  startsAt: "2026-12-05T09:00:00+01:00",
  endsAt: "2026-12-06T18:00:00+01:00",
  location: { address: "Landmark Centre, Water Corporation Rd, Oniru", lat: 6.4278, lng: 3.4447, city: "Victoria Island" },
  templateCode: "LANDMARK-CENTRE",
};

beforeEach(async () => {
  await resetData(db);
  resetLimits();
});
afterAll(() => db.close());

describe("partner accounts", () => {
  it("signs up, signs in, and rejects duplicates and wrong passwords", async () => {
    const { cookie } = await signup();
    const me = await call("GET", "/partner/me", undefined, { cookie });
    expect(me.json.partner.name).toBe("Lagos Fest");
    expect((await call("POST", "/partner/signup", { name: "Bisi", organisation: "Another Org", email: "ADA@lagosfest.ng", password: "another one" })).status).toBe(409);
    expect((await call("POST", "/partner/login", { email: "ada@lagosfest.ng", password: "wrong pass" })).status).toBe(401);
    expect((await call("POST", "/partner/login", { email: "ada@lagosfest.ng", password: "correct horse" })).status).toBe(200);
    expect((await call("GET", "/partner/me")).status).toBe(401);
  });

  it("keeps each partner's events private", async () => {
    const a = await signup();
    const b = await signup("tobi@other.ng", "Other Events");
    const e = (await call("POST", "/partner/events", landmark, a)).json;
    expect((await call("GET", `/partner/events/${e.id}`, undefined, b)).status).toBe(404);
    expect((await call("GET", "/partner/events", undefined, b)).json).toEqual([]);
    // A staff session can't pass as a partner session.
    const staff = await call("POST", "/auth/login", { code: "MOONSHOT", pin: "1111" });
    expect((await call("GET", "/partner/events", undefined, { cookie: staff.cookie!.replace("lv_staff", "lv_partner") })).status).toBe(401);
  });
});

describe("events", () => {
  it("creates a draft from a venue template, placed at the chosen location, hidden until published", async () => {
    const a = await signup();
    const r = await call("POST", "/partner/events", landmark, a);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ code: "LAGOS-TECH-FEST-2026", status: "draft", templateCode: "LANDMARK-CENTRE" });
    expect(r.json.counts.areas).toBe(10);

    const plan = (await call<VenuePlan>("GET", `/partner/events/${r.json.id}/plan`, undefined, a)).json;
    expect(plan.canvas.unit).toBe("m");
    expect(plan.canvas.geo).toMatchObject({ approximate: true });
    expect(plan.canvas.geo!.points[0]).toMatchObject({ lat: 6.4278, lng: 3.4447 });

    const pub = (await call<Snapshot>("GET", "/snapshot")).json;
    expect(pub.venues.some((v) => v.id === r.json.id)).toBe(false);

    // Can't publish without vendors.
    const early = await call("PATCH", `/partner/events/${r.json.id}`, { status: "live" }, a);
    expect(early.status).toBe(400);
    expect(early.json.error).toMatch(/vendor/);
  });

  it("two events from the same template get the same spot codes without clashing", async () => {
    const a = await signup();
    const e1 = (await call("POST", "/partner/events", landmark, a)).json;
    const e2 = (await call("POST", "/partner/events", { ...landmark, name: "Lagos Tech Fest 2027" }, a)).json;
    expect(e1.counts.spots).toBe(e2.counts.spots);
    expect(e1.code).not.toBe(e2.code);
  });

  it("goes from vendor + items to published, visible to buyers", async () => {
    const a = await signup();
    const e = (await call("POST", "/partner/events", landmark, a)).json;
    const v = (await call("POST", `/partner/events/${e.id}/vendors`, { name: "Suya Spot", contactPhone: "08030000000" }, a)).json;
    await call("POST", `/partner/events/${e.id}/vendors/${v.id}/items`, { category: "Grill", kind: "goods", name: "Beef suya", priceKobo: 300000, inStock: true, fulfilment: "deliver" }, a);
    const live = await call("PATCH", `/partner/events/${e.id}`, { status: "live" }, a);
    expect(live.json.status).toBe("live");
    const pub = (await call<Snapshot>("GET", "/snapshot")).json;
    expect(pub.venues.some((x) => x.id === e.id)).toBe(true);
    // Vendor phone numbers never reach buyers.
    expect(JSON.stringify(pub)).not.toContain("08030000000");
  });

  it("saves editor changes with prune: removes unused areas, deactivates spots that have orders", async () => {
    const a = await signup();
    const e = (await call("POST", "/partner/events", landmark, a)).json;
    const plan = (await call<VenuePlan>("GET", `/partner/events/${e.id}/plan`, undefined, a)).json;
    const edited: VenuePlan = {
      ...plan,
      areas: plan.areas.filter((x) => !x.code.startsWith("MR")),
      spots: plan.spots.filter((s) => !s.area.startsWith("MR")),
      markers: plan.markers.map((m) => (m.kind === "entrance" ? { ...m, status: "blocked" as const, note: "Use side door" } : m)),
    };
    const dry = await call("PUT", `/partner/events/${e.id}/plan?dryRun=1`, edited, a);
    expect(dry.json).toMatchObject({ ok: true, applied: false });
    const r = await call("PUT", `/partner/events/${e.id}/plan?prune=1`, edited, a);
    expect(r.json).toMatchObject({ applied: true, removedAreas: 4, removedSpots: 4 });
    const after = (await call<VenuePlan>("GET", `/partner/events/${e.id}/plan`, undefined, a)).json;
    expect(after.areas).toHaveLength(6);
    expect(after.markers.find((m) => m.kind === "entrance")).toMatchObject({ status: "blocked", note: "Use side door" });
  });
});

describe("team", () => {
  it("adds staff with a PIN shown once; they sign in with event code + PIN", async () => {
    const a = await signup();
    const e = (await call("POST", "/partner/events", landmark, a)).json;
    const add = await call("POST", `/partner/events/${e.id}/staff`, { name: "Kunle", role: "runner", phone: "08011112222" }, a);
    expect(add.json.pin).toMatch(/^\d{6}$/);
    const list = await call("GET", `/partner/events/${e.id}/staff`, undefined, a);
    expect(JSON.stringify(list.json)).not.toContain(add.json.pin);
    const login = await call("POST", "/auth/login", { code: e.code, pin: add.json.pin });
    expect(login.status).toBe(200);
    expect(login.json.name).toBe("Kunle");
    expect((await call("POST", "/auth/login", { code: "MOONSHOT", pin: add.json.pin })).status).toBe(401);
  });

  it("vendor invite links are single use and fill in the menu", async () => {
    const a = await signup();
    const e = (await call("POST", "/partner/events", landmark, a)).json;
    const v = (await call("POST", `/partner/events/${e.id}/vendors`, { name: "Placeholder" }, a)).json;
    const { url } = (await call("POST", `/partner/events/${e.id}/vendors/${v.id}/invite`, undefined, a)).json;
    const token = url.split("/").pop();
    const page = await call("GET", `/invites/${token}`);
    expect(page.json.event.name).toBe("Lagos Tech Fest 2026");
    const hall = page.json.areas.find((x: { code: string }) => x.code === "HALL2");
    const submit = await call("POST", `/invites/${token}`, {
      vendor: { name: "Mama Put", stallLabel: "Hall 2, by the stage", zoneId: hall.id, contactPhone: "08099999999" },
      items: [{ category: "Mains", kind: "goods", name: "Amala & ewedu", priceKobo: 250000, inStock: true, fulfilment: "deliver" }],
    });
    expect(submit.status).toBe(200);
    expect(submit.json).toMatchObject({ name: "Mama Put", zoneId: hall.id });
    expect(submit.json.products).toHaveLength(1);
    expect((await call("POST", `/invites/${token}`, { vendor: { name: "Again", stallLabel: "x" }, items: [] })).status).toBe(409);
  });

  it("Layovr runner requests go to operators, who approve and add Layovr runners", async () => {
    const a = await signup();
    const e = (await call("POST", "/partner/events", { ...landmark, deliveryMode: "layovr_runners", runnersNeeded: 6 }, a)).json;
    expect(e.runnerRequest).toMatchObject({ status: "requested", runnersNeeded: 6 });
    expect((await call("GET", "/operator/runner-requests", undefined, a)).status).toBe(403);

    const ops = await call("POST", "/partner/login", { email: "ops@demo.layovr.app", password: "layovr-demo" });
    const reqs = await call("GET", "/operator/runner-requests", undefined, { cookie: ops.cookie! });
    expect(reqs.json.map((x: { id: string }) => x.id)).toContain(e.id);
    const ok = await call("POST", `/operator/events/${e.id}/runner-request`, { decision: "approve", note: "6 runners confirmed" }, { cookie: ops.cookie! });
    expect(ok.json.runnerRequest).toMatchObject({ status: "approved", reply: "6 runners confirmed" });
    const added = await call("POST", `/partner/events/${e.id}/staff`, { name: "Layovr Runner", role: "runner" }, { cookie: ops.cookie! });
    expect(added.json.member.providedBy).toBe("layovr");
  });
});

describe("API keys", () => {
  it("work as Bearer tokens until revoked, and read-only keys can't write", async () => {
    const a = await signup();
    const k = (await call("POST", "/partner/keys", { name: "TIX integration" }, a)).json;
    expect(k.key).toMatch(/^lvk_/);
    expect((await call("GET", "/partner/keys", undefined, a)).json[0]).not.toHaveProperty("key");

    const created = await call("POST", "/partner/events", landmark, { key: k.key });
    expect(created.status).toBe(200);
    expect((await call("GET", "/partner/events", undefined, { key: k.key })).json).toHaveLength(1);
    // Keys can't mint more keys.
    expect((await call("POST", "/partner/keys", { name: "x" }, { key: k.key })).status).toBe(403);

    const ro = (await call("POST", "/partner/keys", { name: "reporting", scope: "read" }, a)).json;
    expect((await call("POST", "/partner/events", landmark, { key: ro.key })).status).toBe(403);

    await call("DELETE", `/partner/keys/${k.id}`, undefined, a);
    expect((await call("GET", "/partner/events", undefined, { key: k.key })).status).toBe(401);
    const audit = await db.query("select action, ok, channel from api_audit order by id");
    expect(audit.some((x) => x.action === "events.create" && x.channel === "api" && x.ok)).toBe(true);
  });
});

describe("venue library", () => {
  it("every template is a valid plan", () => {
    for (const t of VENUE_LIBRARY) {
      expect({ code: t.code, errors: checkPlan(t.plan()).errors }).toEqual({ code: t.code, errors: [] });
    }
  });
});

describe("API docs", () => {
  it("documents every route the server serves", async () => {
    const spec = (await call("GET", "/openapi.json")).json;
    const documented = new Set(
      Object.entries(spec.paths as Record<string, Record<string, unknown>>).flatMap(([p, ops]) =>
        Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`),
      ),
    );
    const served = app.routes
      .filter((r) => r.method !== "ALL")
      .map((r) => `${r.method} ${r.path.replace(/^\/api/, "").replace(/:([A-Za-z]+)/g, "{$1}")}`);
    expect(served.filter((s) => !documented.has(s))).toEqual([]);
    expect(spec.paths["/partner/events"].post.requestBody).toBeDefined();
    expect((await app.request("/api/docs")).headers.get("content-type")).toMatch(/html/);
  });
});

describe("MCP", () => {
  let base = "";
  let server: ReturnType<typeof serve>;
  beforeAll(async () => {
    server = serve({ fetch: app.fetch, port: 0 });
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  async function connect(key: string) {
    const client = new Client({ name: "test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), { requestInit: { headers: { authorization: `Bearer ${key}` } } });
    // The SDK's types don't satisfy exactOptionalPropertyTypes; the transport is correct at runtime.
    await client.connect(transport as unknown as Parameters<Client["connect"]>[0]);
    return client;
  }
  const parse = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content)[0]!.text);

  it("needs an API key", async () => {
    const res = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  it("lists tools, previews writes until confirm, and stays inside the partner", async () => {
    const a = await signup();
    const key = (await call("POST", "/partner/keys", { name: "Claude" }, a)).json.key;
    const client = await connect(key);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["events_create", "plans_apply", "entrances_block", "staff_add", "venue_templates_list"]));

    const args = { name: "Afrobeats Night", templateCode: "GENERIC-FESTIVAL", location: { address: "Tafawa Balewa Square, Lagos", lat: 6.4465, lng: 3.4005 } };
    const preview = parse(await client.callTool({ name: "events_create", arguments: args }));
    expect(preview.preview).toBe(true);
    expect((await call("GET", "/partner/events", undefined, a)).json).toHaveLength(0);

    const created = parse(await client.callTool({ name: "events_create", arguments: { ...args, confirm: true } }));
    expect(created).toMatchObject({ created: true, status: "draft" });

    const broken = parse(await client.callTool({ name: "plans_apply", arguments: { eventId: created.eventId, plan: { standard: "layovr-plan/1" } } }));
    expect(broken.details.ok).toBe(false);
    expect(broken.details.errors.length).toBeGreaterThan(0);

    const blocked = parse(await client.callTool({ name: "entrances_block", arguments: { eventId: created.eventId, label: "Main gate", note: "Flooded", confirm: true } }));
    expect(blocked.applied).toBe(true);

    // Another partner's event is invisible.
    const other = await signup("tobi@other.ng", "Other Events");
    const otherEvent = (await call("POST", "/partner/events", landmark, other)).json;
    const denied = await client.callTool({ name: "events_get", arguments: { eventId: otherEvent.id } });
    expect(denied.isError).toBe(true);
    expect(parse(denied).error).toMatch(/not found/i);

    const audit = await db.query("select action, ok, detail from api_audit where channel = 'mcp' order by id");
    expect(audit.map((x) => x.action)).toEqual(
      expect.arrayContaining(["mcp.events_create", "mcp.plans_apply", "mcp.entrances_block", "mcp.events_get"]),
    );
    await client.close();
  });
});
