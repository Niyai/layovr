import { VENUE_LIBRARY, venueTemplate, type TrackResult } from "@layovr/shared";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Ctx } from "../context";
import { param, type Router } from "../http";
import { safeEqual } from "../lib/auth";
import { bad, notFound } from "../lib/errors";
import { onChange } from "../lib/events";
import { limit } from "../lib/ratelimit";
import { searchPlaces } from "../services/geo";
import * as orders from "../services/orders";
import { buildSnapshot } from "../services/snapshot";
import * as team from "../services/team";
import { body, clean, id, ip, partnerSchemas, schemas } from "../schemas";

export function publicRoutes(r: Router, ctx: Ctx) {
  r.get("/health", { tag: "System", summary: "Health check", access: "public", returns: "{ ok, db, payments }" }, async (c) => {
    await ctx.db.query("select 1");
    return c.json({ ok: true, db: ctx.db.driver, payments: ctx.gateway ? "flutterwave" : "demo" });
  });

  r.get(
    "/snapshot",
    {
      tag: "Buyer app",
      summary: "Everything one screen may see",
      description:
        "Live venues, their plans, vendors and menus, plus the caller's own orders. Staff sessions also get the orders and purchases their role may see.",
      access: "public",
      query: z.object({ orders: z.string().optional().describe("Comma-separated order ids saved on this phone") }),
      returns: "Snapshot",
    },
    async (c) => {
      const ids = (c.req.query("orders") ?? "")
        .split(",")
        .filter((x) => id.safeParse(x).success)
        .slice(0, 30);
      c.header("Cache-Control", "no-store");
      return c.json(await buildSnapshot(ctx, c.get("staff"), ids));
    },
  );

  r.get(
    "/stream",
    {
      tag: "Buyer app",
      summary: "Live change feed (server-sent events)",
      description: "Emits `change` whenever anything is written; clients refetch their snapshot.",
      access: "public",
    },
    (c) =>
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

  r.get("/uploads/:id", { tag: "Buyer app", summary: "A stored photo (menu item, receipt, plan image)", access: "public" }, async (c) => {
    const [row] = await ctx.db.query("select content_type, data from uploads where id = $1", [param(c, "id")]);
    if (!row) return c.notFound();
    return c.body(new Uint8Array(row.data), 200, {
      "Content-Type": row.content_type,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  r.get(
    "/track",
    {
      tag: "Buyer app",
      summary: "Look up an order's status by code or phone",
      description: "Status only: never names, items or the order link. Rate-limited.",
      access: "public",
      query: z.object({ q: z.string().describe("LV-XXXX code or the phone number used to order") }),
      returns: "TrackResult[]",
    },
    async (c) => {
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
    },
  );

  /* ---------------------------------------------------------- checkout */

  r.post(
    "/orders",
    {
      tag: "Buyer app",
      summary: "Create an order and start payment",
      description: "The server re-prices the basket and adds the service fee; prices from the client are ignored.",
      access: "public",
      body: schemas.createOrder,
      returns: "{ order, payment: { mode, link } }",
    },
    async (c) => {
      limit(`order:${ip(c)}`, 30, 10 * 60_000);
      const input = await body(c, schemas.createOrder);
      const order = await orders.createOrder(
        ctx,
        clean({
          ...input,
          cart: input.cart.map(clean),
          pinpoint: input.pinpoint ? clean(input.pinpoint) : undefined,
        }),
      );
      const payment = await orders.startPayment(ctx, order.id);
      return c.json({ order, payment });
    },
  );

  r.post("/orders/:id/pay", { tag: "Buyer app", summary: "Start (or retry) payment for an order", access: "public", returns: "{ mode, link }" }, async (c) => {
    limit(`pay:${ip(c)}`, 30, 10 * 60_000);
    return c.json(await orders.startPayment(ctx, param(c, "id")));
  });

  r.post(
    "/orders/:id/verify",
    {
      tag: "Buyer app",
      summary: "Verify a Flutterwave payment after redirect",
      description: "Checks the transaction with Flutterwave (status, tx_ref, amount, currency) before marking the order paid.",
      access: "public",
      body: schemas.verify,
      returns: "{ ok }",
    },
    async (c) => {
      limit(`verify:${ip(c)}`, 30, 10 * 60_000);
      if (!ctx.gateway) throw bad("Flutterwave is not configured");
      const { transactionId } = await body(c, schemas.verify);
      const res = await orders.verifyAndMarkPaid({ ...ctx, gateway: ctx.gateway }, transactionId, param(c, "id"));
      return c.json({ ok: res.ok });
    },
  );

  r.post("/orders/:id/demo-pay", { tag: "Buyer app", summary: "Approve a demo payment (only when Flutterwave isn't configured)", access: "public", returns: "Order" }, async (c) =>
    c.json(await orders.demoPay(ctx, param(c, "id"))),
  );

  r.post(
    "/flw/webhook",
    { tag: "Payments", summary: "Flutterwave webhook", description: "Checked with the verif-hash header, then verified with Flutterwave.", access: "webhook" },
    async (c) => {
      const expected = ctx.env.flwSecretHash;
      const got = c.req.header("verif-hash") ?? "";
      if (!expected || !safeEqual(got, expected)) return c.text("Invalid signature", 401);
      const payload = (await c.req.json().catch(() => null)) as { data?: { id?: number } } | null;
      const txId = payload?.data?.id;
      if (!txId || !ctx.gateway) return c.text("ok");
      const res = await orders.verifyAndMarkPaid({ ...ctx, gateway: ctx.gateway }, String(txId));
      console.info("[flw-webhook]", txId, res);
      return c.text("ok");
    },
  );

  /* ---------------------------------------------------------- venue library */

  r.get(
    "/venue-templates",
    { tag: "Venue library", summary: "Starting plans for popular Lagos venues and generic layouts", access: "public", returns: "VenueTemplate[] (without the plan)" },
    (c) => c.json(VENUE_LIBRARY.map(({ plan: _plan, ...t }) => t)),
  );

  r.get("/venue-templates/:code", { tag: "Venue library", summary: "One template with its layovr-plan/1 file", access: "public", returns: "VenueTemplate & { plan }" }, (c) => {
    const t = venueTemplate(param(c, "code"));
    if (!t) throw notFound("No template with that code");
    const { plan, ...rest } = t;
    return c.json({ ...rest, plan: plan() });
  });

  /* ---------------------------------------------------------- vendor invites */

  r.get(
    "/invites/:token",
    { tag: "Vendor invites", summary: "What a vendor sees on their invite link", access: "invite", returns: "{ event, areas, vendor, expiresAt }" },
    async (c) => {
      limit(`invite:${ip(c)}`, 60, 10 * 60_000);
      return c.json(await team.readInvite(ctx, param(c, "token")));
    },
  );

  r.post(
    "/invites/:token",
    {
      tag: "Vendor invites",
      summary: "Vendor submits their stall details and menu",
      description: "Single use; the link expires after 7 days.",
      access: "invite",
      body: partnerSchemas.inviteMenu,
      returns: "Vendor with products",
    },
    async (c) => {
      limit(`invite:${ip(c)}`, 60, 10 * 60_000);
      const input = await body(c, partnerSchemas.inviteMenu);
      return c.json(
        await team.submitInvite(ctx, param(c, "token"), {
          vendor: clean(input.vendor),
          items: input.items.map(clean),
        }),
      );
    },
  );

  /* ---------------------------------------------------------- places */

  r.get(
    "/geo/search",
    {
      tag: "Places",
      summary: "Find an address (OpenStreetMap fallback)",
      description: "Used by the dashboard when no Google Maps key is configured. Limited to Nigeria.",
      access: "public",
      query: z.object({ q: z.string().min(3) }),
      returns: "{ address, lat, lng, city? }[]",
    },
    async (c) => {
      limit(`geo:${ip(c)}`, 30, 60_000);
      return c.json(await searchPlaces(ctx, c.req.query("q") ?? ""));
    },
  );
}
