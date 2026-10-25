# Layovr

Close-proximity delivery for bounded places (events, airports, malls). A QR code
is the address: buyers scan, order from any stall, pay with Flutterwave, and a
runner walks the order to their spot. First run: Moonshot, Oct 28–29, 2026.

## Layout

```
apps/web         Buyer, ops, runner, admin and menu-capture screens (TanStack Start, React 19, Tailwind v4)
apps/api         HTTP API, payments, live updates (Hono on Node, Postgres)
packages/shared  Types, pricing/fee rules and demo seed shared by both
```

## Run it locally

Needs Node 22.12+ (https://nodejs.org). Nothing else: the API uses an embedded
Postgres (PGlite) stored in `apps/api/.data/` when `DATABASE_URL` is unset.

```sh
npm install
npm run dev          # API on :8787, web on http://localhost:8080
```

The first start creates the schema and loads demo data. Open `/s/MB-C` (a
spot's QR link) on a phone-sized window and `/staff` in another browser
profile. Phones on the same Wi-Fi can use the "Network" URL Vite prints.

| PIN  | Who   | Role              | Lands on        |
| ---- | ----- | ----------------- | --------------- |
| 1111 | Ada   | admin             | /admin          |
| 2222 | Tunde | dispatch          | /ops            |
| 3333 | Kemi  | runner            | /runner         |
| 4444 | Bayo  | runner            | /runner         |
| 5555 | Chidi | runner (🔑 access) | /runner         |
| 6666 | Ife   | capture           | /admin/capture  |

Useful commands:

```sh
npm test             # API end-to-end tests (in-memory Postgres)
npm run typecheck
npm run db:reset     # wipe the local database and reseed
```

Configuration lives in `.env` at the repo root; see `.env.example`.
Without `FLW_SECRET_KEY`, checkout runs in demo mode (no money moves).

## How it fits together

- The browser only talks to the web origin; Vite forwards `/api/*` to the API,
  so staff cookies and live updates need no CORS.
- `GET /api/snapshot` returns everything a screen may see, scoped by who is
  asking: buyers get the catalogue plus their own orders (by unguessable id);
  dispatch gets the venue's orders and purchases; runners get their own orders.
- `GET /api/stream` (server-sent events) says "something changed"; every
  screen refetches. That is the realtime ops board and buyer tracking.
- Every write is a POST to the API, which owns all rules: re-pricing the basket,
  the service fee, the status lifecycle (`apps/api/src/services/orders.ts`,
  one `transition()` that writes `order_events`), restricted-zone runners,
  "buy at every stall before On the way", PIN hand-off and refunds.
- An order becomes **Paid** only after the server verifies the transaction
  with Flutterwave (webhook `POST /api/flw/webhook`, and the buyer's redirect).
  Both paths are idempotent on `payments.tx_ref`.
- Staff sign in with a PIN (scrypt-hashed, rate-limited) and get a signed
  httpOnly cookie. PINs, hashes and staff phones never reach buyers.
- Photos (menus, receipts, floor plans) are compressed in the browser and
  stored in the `uploads` table, served from `/api/uploads/:id`.

Schema: `apps/api/src/db/migrations/001_init.sql`.

## Not built yet

SMS/WhatsApp order links, QR print PDF export beyond `/admin/print`, service
time slots, unpaid-order expiry, and a production build/deploy setup (next step).
