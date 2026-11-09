# Layovr — Requirements: headless platform, MCP and hardware

Status: **draft for review, not yet approved for build** · Oct 31, 2026 · @Niyi

This document replaces the Moonshot prototype scope as the source of truth for
what Layovr is building next. Nothing in sections 4–9 is implemented yet
unless it is marked **(built)**. Approve or amend it before implementation
starts; each requirement has an ID so plans, PRs and tests can refer to it.

## 1. Why headless

Events, venues, airports and malls already run their own apps and websites
(ticketing like TIX, airport apps, mall loyalty apps). They won't send
customers to a separate Layovr app. Layovr becomes **infrastructure**: the
location, ordering, runner and hand-off layer that other platforms embed under
their own brand.

Layovr ships in three layers, each built on the one below:

| Layer | Who uses it | What it is |
| --- | --- | --- |
| **Core API** (REST + webhooks) | Partner developers | Every capability as an authenticated, versioned API |
| **MCP server** | Partner AI agents, our own ops assistant, Claude/ChatGPT users | The same capabilities as MCP tools, so an agent can map a venue, onboard a store or check an order in conversation |
| **Reference apps** | Venues without their own app; our own ops team | Today's web app (buyer, ops, runner, admin, capture), white-labelled per partner, plus embeddable widgets |

The current web app becomes a reference client of the Core API. Anything it
can do, a partner must be able to do through the API.

## 2. People and systems

| Actor | Description |
| --- | --- |
| **Partner** (tenant) | An organisation that integrates Layovr: an event organiser, ticketing platform, airport, mall operator |
| **Partner developer** | Builds the integration with API keys and webhooks |
| **Partner agent** | An AI agent acting for a partner through MCP |
| **Venue admin** | Partner staff who map venues and configure fees, zones, entrances |
| **Store** | A vendor or service provider at a venue (food stall, charging point, airport shop) |
| **Runner** | Delivers orders; may be Layovr's, the partner's or the store's |
| **Dispatcher** | Assigns runners and handles issues |
| **Buyer** | The end customer, usually the partner's own user |
| **Layovr operator** | Our own staff (support, compliance, finance) |

## 3. What exists today (built)

The Moonshot prototype (apps/web, apps/api, packages/shared). The pivot must
keep all of it working, exposed through the Core API.

| Area | Built today |
| --- | --- |
| Venues & plans | Venues with fee settings; the `layovr-plan/1` plan standard ([PLAN-STANDARD.md](PLAN-STANDARD.md)) with levels, sections, areas (rect, circle, ring sector, polygon), spots and markers including blocked entrances; plan import with dry-run validation, export, re-import in place; Moonshot plan from event signage; floor-by-floor plan view; tracing image underlay; restricted areas |
| QR & spots | One QR per spot (`/s/<code>`), PNG download, print sheet with spare cards, spot editor with click-to-place and standard code suggestions |
| Stores & menus | Menu capture on a phone (stall, emoji, colour, zone, location, items, prices, photos, services, 18+); admin menu editing (price with last-checked date, stock, open/closed, delete); photo compression and storage |
| Buyer ordering | Venue page with stall wait estimates and runner availability; multi-stall basket; checkout with spot, landmark, name, phone, email; server-side re-pricing; service fee (% + flat) |
| Payments | Flutterwave Standard checkout, server-side verify (amount, currency, tx_ref), webhook with secret hash, idempotent on tx_ref, pay-later retry; demo mode |
| Orders & dispatch | Status lifecycle with audit trail (awaiting payment → paid → assigned → buying → on the way → delivered / not delivered / cancelled); runner assignment with restricted-zone check; ETA; runner self-take; reassign; cancel with refund due |
| Runner | Stops in order; purchase logging against a float (cash/transfer, receipt photo); item swap/drop with refund calculation; stall-can't-fill; "head to buyer" blocked until every stall is resolved; PIN hand-off |
| Locating | No-scan location: tap the venue map or use phone GPS (plans linked to GPS by admin calibration); runner live location on an order, shown on the ops plan, distance-only for buyers |
| Finding each other | "Raise your phone": the runner taps "I'm in the area", and both phones show the same full-screen colour + symbol + name, unique per area (10 colours × solid/stripes/flash), with vibration and screen wake |
| Live ops | Realtime board (SSE), new-order chime, late/stale flags, floor-plan dots per floor, runner floats and shifts, stall wait times, fees earned |
| Tracking | Buyer order page with timeline, ETA and hand-off code; status-only lookup by code or phone (rate-limited) |
| Staff & security | PIN sign-in (hashed, rate-limited), signed cookie sessions, roles (admin, dispatch, runner, capture), role- and venue-scoped data, no staff PINs/phones in public responses |
| Platform | Embedded Postgres locally or any Postgres via `DATABASE_URL`; migrations; seed/reset; 23 API tests |

## 3a. Built since this draft (Nov 6, 2026)

Partner sign-up and dashboard; events with Google/OpenStreetMap location; the
Lagos venue library ([LAGOS-VENUES.md](LAGOS-VENUES.md)); a visual plan editor;
vendor invite links; staff with event code + PIN; Layovr runner requests with an
operator console; partner API keys; the OpenAPI document and API reference
(`/developers`, `/api/docs`); and the MCP server at `/api/mcp`. Planner guide:
[PARTNERS.md](PARTNERS.md).

## 4. Functional requirements

Priority: **P0** = needed for the first headless partner, **P1** = next,
**P2** = later. Every requirement is available through the Core API **and**
as an MCP tool unless stated otherwise.

### 4.1 Partners, access and integration

| ID | Requirement | P |
| --- | --- | --- |
| PLT-1 | **(built)** Partners (tenants) own venues, stores, runners and orders. All data is scoped by `partner_id`, then `venue_id`. | P0 |
| PLT-2 | **(built: test/live split not yet)** API keys per partner with scopes (e.g. `plans:write`, `orders:read`) and separate test/live keys. Keys are shown once and stored hashed. | P0 |
| PLT-3 | Outbound webhooks for every state change (order, payment, runner, plan), signed with HMAC, retried with backoff, with a delivery log and replay. | P0 |
| PLT-4 | Idempotency keys on every POST that creates something or moves money. | P0 |
| PLT-5 | **(built: OpenAPI 3.1 at /api/openapi.json, reference at /api/docs; sandbox not yet)** Versioned REST API (`/v1`) with an OpenAPI 3.1 spec generated from the same zod schemas the server validates with. Sandbox environment with test cards and simulated runners. | P0 |
| PLT-6 | Partner end-user identity: partners pass their own buyer id (`external_customer_id`); Layovr never requires buyers to create a Layovr account. | P0 |
| PLT-7 | White-label: name, logo, colours, domain/subdomain, SMS sender id and email per partner (and per venue). Reference apps theme themselves from it. | P1 |
| PLT-8 | Embeddable widgets (web component + iframe) for "order to my seat", order tracking and "raise your phone", themed per partner. Mobile SDK wrappers later. | P1 |
| PLT-9 | Partner console: keys, webhooks, logs, usage and billing. | P1 |
| PLT-10 | Usage-based billing per partner (per order, per verification, per locker use). | P2 |

### 4.2 MCP server

| ID | Requirement | P |
| --- | --- | --- |
| MCP-1 | **(built with API keys; OAuth 2.1 not yet)** Remote MCP server over Streamable HTTP, authorised with OAuth 2.1 as the MCP authorization spec requires, mapping to the same partner scopes as API keys. | P0 |
| MCP-2 | **(built: 22 tools)** One tool per capability in sections 4.3–4.11, named `<area>_<verb>` (list in §5). Tool inputs reuse the API's zod schemas, so tools, API and docs never drift. | P0 |
| MCP-3 | **(built)** Any tool that changes live state requires `confirm: true` after a preview. The default call returns a dry run describing what would change (same pattern as plan import). Applies to: applying plans, blocking entrances, publishing menus, refunds, deactivating runners. | P0 |
| MCP-4 | **(built)** Read-only resources: `plan://{venue}` (the plan file), `menu://{store}`, `order://{id}` (partner-scoped). | P1 |
| MCP-5 | **(built: set_up_my_event)** Guided prompts for non-technical users: "Map my venue" (interview → generated plan → dry run), "Onboard a store", "Set up an event day". | P1 |
| MCP-6 | **(built)** Every MCP call is audit-logged with the agent/client id, the human who authorised it, inputs and result. | P0 |
| MCP-7 | Tool results are short and structured (ids, status, next steps), never whole database rows. Personal data is only returned to scopes that need it. | P0 |

### 4.3 Venues, buildings and plans

| ID | Requirement | P |
| --- | --- | --- |
| MAP-1 | **(built: events)** Create, read, update and archive venues of any type: event, airport, mall, office, campus, apartment block, park. | P0 |
| MAP-2 | **Import** a plan in `layovr-plan/1` with dry-run validation and plain-language errors and warnings. **(built for the web admin)** | P0 |
| MAP-3 | **Export** the current plan, including edits made since import. **(built)** | P0 |
| MAP-4 | **(built: visual editor)** **Edit** a plan piece by piece without re-uploading: add/rename/reshape/remove areas, add/move spots, add markers, mark areas restricted, set capacity. | P0 |
| MAP-5 | **(built: block with reason; time windows not yet)** **Block and unblock entrances** (and stairs, lifts, corridors) with a reason and an optional time window ("Zone C closed until 14:00"). Runners see the change live; directions and ETAs that use a blocked route are flagged. | P0 |
| MAP-6 | **Generate a plan from simple questions** (layman parameters, explained in §6): building shape, floors, sections, list of rooms with seats. Output is a `layovr-plan/1` file the user reviews before applying. | P1 |
| MAP-7 | **Generate from a drawing**: upload a photo or PDF of a venue map; the server proposes areas and labels (Claude vision), marked `approximate`, for the user to confirm. Photos of signage like Moonshot's are the main input. | P1 |
| MAP-8 | Import from standard formats: GeoJSON (incl. IMDF, Apple's indoor mapping format, used by airports and malls), DXF floor plans, and OpenStreetMap indoor tags. Converted to `layovr-plan/1`, with anything unconvertible listed. | P2 |
| MAP-9 | Plan versions: every applied plan is a version with author, time and diff; roll back to any version; schedule a version for an event day. | P1 |
| MAP-10 | Event overlays: a temporary layer on a permanent venue plan (stages, food village, closures) for one event, without editing the base plan. | P1 |
| MAP-11 | Routing: walking graph between areas via doors/stairs/lifts, walking times per edge, auto-ETA, and re-routing around blocked markers. | P2 |
| MAP-12 | Crowd map: orders and scans per area over time, exportable for organisers. | P1 |

**Airport-specific (P1 unless stated):**

| ID | Requirement | P |
| --- | --- | --- |
| AIR-1 | Airport template: terminals as sections, piers/concourses, gates as `gate` areas, landside vs airside as access levels, security checkpoints as markers. | P1 |
| AIR-2 | Flight-aware delivery deadline: buyer enters flight number or departure time; cut-off = departure − boarding-close buffer − walk time to the gate. Items that can't make it are hidden with the reason. Orders auto-cancel and refund if undelivered by the deadline. | P1 |
| AIR-3 | Flight status lookup (gate changes, delays) via a flight-data API, updating the deadline and delivery spot. | P2 |
| AIR-4 | Airside runner credentials: only runners with a valid airside pass (with expiry) can take airside orders. | P1 |

### 4.3a Locating buyers and runners

Shortlist of services and costs: [THIRD-PARTY-SERVICES.md](THIRD-PARTY-SERVICES.md).

| ID | Requirement | P |
| --- | --- | --- |
| LOC-1 | Buyers can say where they are without scanning: tap their position on the venue plan (by floor); the nearest spot in that area becomes the delivery address and the exact point is kept on the order. **(built)** | P0 |
| LOC-2 | "Use my location": phone GPS is placed on the plan (plans carry GPS control points, set by admin calibration), the nearest spot is suggested for the buyer to confirm; fixes worse than 60 m fall back to the map. **(built)** | P0 |
| LOC-3 | Runner live location while on an order: latest position only, no history, deleted when the runner has no active orders or signs out. Dispatch sees runners on the plan; buyers see only an approximate distance. **(built)** | P0 |
| LOC-4 | Venue Wi-Fi presence: the access point a buyer's phone is connected to identifies their area (venue-specific integration). | P2 |
| LOC-5 | Seat from ticket: a ticket's block/row/seat resolves to a spot automatically (with TIX-4). | P1 |

### 4.4 Spots, tags and QR codes

| ID | Requirement | P |
| --- | --- | --- |
| TAG-1 | Generate a Layovr QR code per spot, with the partner's branding, a short URL and the spot code printed underneath. **(built: PNG + print sheet)** | P0 |
| TAG-2 | Bulk print files (PDF, A6 tent cards, A5 seat stickers, spare blank cards) per area or level. | P0 |
| TAG-3 | Partner deep links: a QR can open the partner's app at the right screen instead of Layovr's web app (universal links with fallback). | P0 |
| TAG-4 | NFC tags as an alternative to QR, encoding the same spot URL (see §8). | P1 |
| TAG-5 | Reassign a printed tag to a different spot without reprinting (the tag holds an id; the server maps id → spot). | P1 |
| TAG-6 | Per-tag scan analytics (scans, conversion to order, last scanned) to spot torn or missing cards. | P1 |
| TAG-7 | Seat-linked tags: ticketing seat (block/row/seat) maps to a spot automatically (see 4.10). | P2 |

### 4.5 Stores and services

| ID | Requirement | P |
| --- | --- | --- |
| STO-1 | Onboard a store: name, category, logo/photo, location (area + label), opening hours, contact, prep time. Three paths: by Layovr staff on site **(built: menu capture)**, by the partner via API/MCP, or self-serve with venue approval. | P0 |
| STO-2 | Store KYB for stores that receive payouts: business name, CAC registration where applicable, owner ID, settlement bank account (verified by account-name lookup). | P1 |
| STO-3 | Add and edit items: name, description, photo, category, price, stock, availability windows, 18+ flag, prep time. **(built in part)** | P0 |
| STO-4 | Item options and modifiers (size, protein, extras) with price deltas and required/optional groups. | P1 |
| STO-5 | Charges per item or store: packaging, VAT (7.5% in Nigeria, inclusive or exclusive), deposits; plus the partner's service fee and Layovr's platform fee. All charges are shown as lines at checkout and stored per order. | P0 |
| STO-6 | Services: collect-and-return and reserve-a-slot, with slot capacity and booking in the same transaction as the order. | P1 |
| STO-7 | Snap the menu: photo of a menu board → draft items via Claude vision for staff to confirm. | P1 |
| STO-8 | Store-facing order view (accept, ready, out of stock) for stores that fulfil directly instead of runners buying for them. | P1 |
| STO-9 | Bulk import/export of menus (CSV, JSON). | P1 |

### 4.6 Runners: onboarding and verification

| ID | Requirement | P |
| --- | --- | --- |
| RUN-1 | **(partial: name, phone, role, access, float; OTP not yet)** Onboard a runner: name, phone (OTP-verified), photo, emergency contact, the venues and areas they may work, languages. | P0 |
| RUN-2 | Identity verification through Smile ID: government ID lookup (NIN or BVN with consent, "Enhanced KYC") plus a selfie liveness match ("SmartSelfie"). Store only the verification result, reference and expiry; never the raw ID images unless the partner's policy requires it. | P0 |
| RUN-3 | Background check through a provider (to choose: police/criminal record check, previous employment, guarantor) where the venue requires it, e.g. airports. Results are pass/fail with a reference. | P1 |
| RUN-4 | Re-authentication at shift start with a selfie match, so a verified account can't be handed to someone else. | P1 |
| RUN-5 | Runner statuses: invited → verifying → verified → active → suspended → offboarded, with reasons and an audit trail. Only active runners can be assigned. | P0 |
| RUN-6 | Credentials and access: restricted-area permission per venue/area, airside pass with expiry, training completed. **(built: one restricted flag)** | P0 |
| RUN-7 | Shifts, floats (issue, top up, reconcile) and payouts (per delivery or per shift) to a verified bank account. **(floats built)** | P1 |
| RUN-8 | Runner ratings from buyers, issues and incident reports. | P1 |
| RUN-9 | Runner app as an installable PWA with offline tolerance, push notifications and live location while on an order (opt-in, only during shifts). | P1 |

### 4.7 Orders, dispatch and hand-off

| ID | Requirement | P |
| --- | --- | --- |
| ORD-1 | Create an order via API from a partner's own checkout: buyer reference, spot (or seat/gate), items, notes. Server re-prices and returns the charges. **(built for the web app)** | P0 |
| ORD-2 | Order lifecycle, events and audit trail exactly as today, emitted as webhooks. **(built)** | P0 |
| ORD-3 | Dispatch: manual assignment **(built)**, then auto-assignment by nearest free eligible runner, batching of nearby orders and stall-based batching. | P0 manual, P1 auto |
| ORD-4 | Hand-off by PIN **(built)**, by QR scan of the buyer's screen, or into a locker (§8). | P0 PIN, P1 others |
| ORD-5 | "Raise your phone" colour match **(built)**, exposed as an API field and a widget so partner apps can show the same screen. | P0 |
| ORD-6 | Pickup option: buyer collects from the store or ops desk. | P1 |
| ORD-7 | Delivery-time promises: per-area ETA defaults from walk times, late alerts, SLA reporting. | P1 |
| ORD-8 | Order limits: max items/value per order, minimum order, open orders per buyer. | P1 |

### 4.8 Payments, payouts and refunds

| ID | Requirement | P |
| --- | --- | --- |
| PAY-1 | Two collection modes. **Partner collects**: the partner charges the buyer in their own checkout and tells Layovr the order is paid (signed server call); Layovr invoices the partner. **Layovr collects**: Flutterwave checkout as today **(built)**. | P0 |
| PAY-2 | Split payments via Flutterwave subaccounts: store share, partner share, Layovr fee, settled automatically. | P1 |
| PAY-3 | Refunds via the Flutterwave refunds API (full and partial), triggered by dropped items and cancellations; today they are marked "refund due" and done by hand. | P0 |
| PAY-4 | Runner and store payouts via Flutterwave transfers to verified accounts, with a ledger. | P1 |
| PAY-5 | Double-entry ledger for every naira: buyer payments, fees, float issued and spent, payouts, refunds. Daily reconciliation report. | P1 |
| PAY-6 | Multi-currency per venue (NGN first; GHS, KES, USD for airports). | P2 |

### 4.9 Notifications and tracking

| ID | Requirement | P |
| --- | --- | --- |
| NOT-1 | SMS/WhatsApp order link and status updates (Termii or Twilio), sent under the partner's sender id. | P0 |
| NOT-2 | Push notifications for runners and partner apps (via webhooks/SDK). | P1 |
| NOT-3 | Public tracking page and embeddable tracking widget, white-labelled. **(page built)** | P0 |

### 4.10 Phase 2: event ticketing

| ID | Requirement | P |
| --- | --- | --- |
| TIX-1 | Ticket types, pricing, inventory and sales windows per event. | P2 |
| TIX-2 | QR tickets with check-in scanning (offline-capable). | P2 |
| TIX-3 | Seated events: seat map linked to plan areas, so a ticket's seat is a delivery spot without scanning anything. | P2 |
| TIX-4 | Integrate with existing ticketing platforms (e.g. TIX) instead of competing: import attendees/seats, so partners keep their ticketing. | P1 |

### 4.11 Hardware integration

| ID | Requirement | P |
| --- | --- | --- |
| HW-1 | Device registry: every locker, beacon, tag and terminal has an id, type, venue, location (area/spot), owner, firmware and status. | P1 |
| HW-2 | Locker hand-off: assign a compartment to an order, runner drops off with a one-time code, buyer collects with their code/QR, compartment frees itself. Locker events become order events. | P1 |
| HW-3 | Beacon-assisted location: runner app reads nearby beacons to confirm arrival in an area (can trigger "I'm in the area" automatically) and to estimate runner position for ETA. | P2 |
| HW-4 | Device health: battery, last seen, offline alerts on the ops board. | P2 |

### 4.12 Admin, analytics and data

| ID | Requirement | P |
| --- | --- | --- |
| ADM-1 | Reference admin console covering everything above, for partners without their own tools. **(built for one venue)** | P0 |
| ADM-2 | Analytics per venue/event: orders, conversion from scan, delivery times, repeat buyers, revenue split, crowd map. | P1 |
| ADM-3 | Data sharing rules per partner: who owns buyer data, what venues see (aggregates by default). | P0 |
| ADM-4 | Exports (CSV) and a read-only reporting API. | P1 |

## 5. MCP tools (first set)

Each tool maps to one Core API endpoint and uses its schema. ✱ = changes live
state, so it previews by default and needs `confirm: true` (MCP-3).

| Tool | Does |
| --- | --- |
| `venues_list`, `venues_create`✱, `venues_update`✱ | Manage venues |
| `plans_get` | Return the venue's `layovr-plan/1` file |
| `plans_validate` | Check a plan file and explain errors in plain words |
| `plans_apply`✱ | Apply a plan file (dry run first) |
| `plans_generate` | Build a draft plan from layman parameters (§6); never applies it |
| `plans_from_image` | Draft a plan from a photo/PDF of a venue map |
| `areas_upsert`✱, `spots_upsert`✱ | Edit one area or spot |
| `entrances_block`✱, `entrances_unblock`✱ | Close or open a door/route, with reason and time window |
| `tags_generate` | Return QR/NFC payloads and print-file links for spots |
| `stores_onboard`✱, `stores_update`✱, `stores_list` | Manage stores |
| `items_upsert`✱, `items_set_stock`✱, `menu_from_photo` | Manage menus |
| `charges_set`✱ | Service fee, packaging, VAT settings |
| `runners_invite`✱, `runners_verify` (starts Smile ID), `runners_status`, `runners_set_access`✱ | Runner onboarding and access |
| `orders_create`✱, `orders_get`, `orders_list`, `orders_cancel`✱, `orders_refund`✱ | Orders |
| `dispatch_assign`✱, `dispatch_board` | Dispatch |
| `lockers_list`, `lockers_assign`✱ | Lockers (phase with HW-2) |
| `reports_venue` | Analytics summary |

## 6. Generating a plan from simple questions (MAP-6)

People mapping a venue aren't architects. The generator asks plain questions,
each mapped to a plan field, and shows a picture before anything is saved.

| Question (as asked) | Becomes | Default / guidance |
| --- | --- | --- |
| "What shape is the building from above?" round · rectangle · L-shape · several buildings | Canvas and shape type (sectors for round, rects for others) | Rectangle |
| "How many floors do people use? Is the entrance floor the ground floor?" | `levels` (0 = ground, negative = basement) | 1 floor |
| "Does the venue split into wings, zones or terminals? What are they called? Any colours on the signs?" | `sections` with codes and colours | None |
| "List the rooms or spaces people order from, which floor and wing each is on, and roughly how many seats." | `areas` with kind guessed from the name ("Hall", "Lounge", "Gate", "Food") and capacity | Kind = hall |
| "Which areas need permission to enter?" | `access: restricted` | Open |
| "Where are the main doors? Any closed today?" | `entrance` markers, `status: blocked` | One entrance per section |
| "Where will the Layovr desk be?" | `ops_desk` marker | Main entrance |

Rules the generator applies (the "architectural standards", simplified):

- Floors numbered the Nigerian/UK way (ground = 0); US-style "first floor = ground" is converted.
- Rooms on the same floor never overlap; corridors/lobbies fill the gaps between sections.
- Spot density: one per 30–50 seats in seated rooms; one per seating cluster or every 15–20 m in open areas; at least one per door of every hall.
- Spot codes follow `<section><level>-<area>-<n>`; labels say area + position + location code.
- Areas it had to guess are marked `approximate` and listed for the site walk.
- Accessibility: if a floor above ground has no lift marker, it warns that step-free deliveries may not be possible.

## 7. Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | **Security:** OWASP ASVS L2; secrets in a vault; least-privilege scopes; all money moves verified server-side; webhook signatures; rate limits per key and per IP. |
| NFR-2 | **Privacy:** comply with the Nigeria Data Protection Act 2023 (lawful basis, consent for BVN/biometrics, retention limits, data subject requests, breach reporting). ID verification data is minimised (§RUN-2). Partners sign a data processing agreement. |
| NFR-3 | **Availability:** 99.9% for the Core API during live events; graceful degradation when the venue network saturates (light pages, retries, offline runner queue). |
| NFR-4 | **Performance:** buyer pages usable on 3G at 390 px width; API p95 < 300 ms for reads, < 800 ms for order creation excluding the payment provider. |
| NFR-5 | **Scale:** one event of 10,000 attendees with 500 orders/hour and 50 runners; many concurrent venues. Realtime moves from in-process events to Postgres LISTEN/NOTIFY or a managed pub/sub when there's more than one API instance. |
| NFR-6 | **Auditability:** every state change and every MCP/API write is attributable to a key, user or agent. |
| NFR-7 | **Compatibility:** API changes are additive within `/v1`; breaking changes go to `/v2` with a deprecation window. |
| NFR-8 | **Testability:** each requirement has an automated test; a sandbox with simulated runners and lockers lets partners test end to end. |

## 8. Hardware

Goal: cheap, durable, rebrandable kit that makes delivery faster or safer
where phones alone fall short. Prices below are **indicative** from public
listings (Oct 2026), not quotes. Get written quotes covering logo MOQ, setup
fees, lead time, shipping and duties to Lagos before committing.

| Item | What it's for | Recommended option | Indicative cost | Rebrandable? |
| --- | --- | --- | --- | --- |
| **Printed QR cards and stickers** | The spot address (today) | Laminated A6 tent cards, A5 seat-back stickers, printed locally | Low; local print | Fully |
| **NFC stickers (NTAG213)** | Tap-to-order on seats, tables and stall counters; same URL as the QR, and works when cameras struggle in the dark. Use on-metal versions on metal seats | Custom-printed NTAG213 stickers, QR printed on the same sticker | About $0.53 each at 1,000 and $0.36 at 5,000 (on-metal about $0.63 / $0.46) from one US retailer | Yes, printed with logo |
| **BLE beacons** | One per area (not per seat) so the runner app knows which hall it's in: auto "I'm in the area", position for ETAs, proof of arrival | Minew (offers OEM/ODM/white-label: casing colour, logo, firmware, pre-set ids) or Feasycom | About $5–16 each in marketplace listings; logo customisation typically needs a 200–500 unit minimum | Yes (Minew white-label) |
| **Seat and stall trackers** | Marking seats/stalls so a buyer's location is known without scanning | Use NFC + QR on every seat (cents each) and one beacon per area. Avoid powered trackers on every seat: battery replacement at stadium scale costs more than it saves | NFC price above | Yes |
| **Smart lockers** | Airports, malls and offices: drop-off when the buyer is in a meeting or at security, and contactless pickup. Also secure overnight storage of collect-and-return items | OEM steel lockers with an open API and 4G (e.g. China-based manufacturers offering API/SDK docking and OEM branding). Start with one 12–24 door unit at one airport | From about $500–1,600 per unit in OEM listings to €6,000–25,000+ for Western vendors, plus cloud software (around €29–99/locker/month from one vendor). Custom API work can cost thousands | Yes (OEM wraps and screens) |
| **Runner device** | For runners without a suitable phone, and for the ops desk | Rugged Android with NFC and 4G. A handheld POS with printer (e.g. Sunmi V2s, sold in Nigeria by Chert Nigeria) doubles as a receipt printer for stores | Naira price on request | Partly (boot logo, case) |
| **Store printer** | Order tickets at busy stalls | 58 mm Bluetooth thermal printer | Low; widely available locally | Case stickers |

**Recommendation:**

1. **Now:** QR + NFC stickers on seats and tables. Cheapest and most durable, and they fit today's system with no new software beyond NFC URLs.
2. **Next event pilot:** one BLE beacon per area in one venue to test auto-arrival and better ETAs (HW-3). About 20 beacons for a Moonshot-size venue.
3. **Airport pilot:** one smart locker bank with an open API (HW-2), chosen only after a supplier demo of the API.
4. **Avoid:** powered trackers on every seat, and lockers without a documented API or local support.

## 9. Delivery phases (proposed)

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| **H1 — Core API** | PLT-1–6, MAP-1–5, TAG-1–3, STO-1/3/5, ORD-1–5, PAY-1/3, NOT-1/3, ADM-3, NFR-1/2/6 | One partner places orders from their own app in sandbox and live; the web app runs entirely on `/v1` |
| **H2 — MCP** | MCP-1–7, plans_validate/apply/generate, entrances_block, stores/items/runners tools | A non-technical user maps a venue and onboards a store through Claude in under 30 minutes |
| **H3 — Runners at scale** | RUN-1–9 with Smile ID, auto-dispatch, payouts, ledger | 50 verified runners across two venues, daily reconciliation clean |
| **H4 — Airports & hardware** | AIR-1–4, HW-1–2, MAP-7/9/10 | One terminal mapped; flight-deadline orders delivered; one locker bank live |
| **H5 — Ticketing & routing** | TIX-*, MAP-8/11, HW-3/4 | One seated event with seat-linked delivery |

## 10. Open questions

1. **First headless partner:** who, and do they collect payment themselves (PAY-1 partner-collects) or use ours?
2. **Runners:** whose runners at partner venues? Layovr's, the partner's or the stores'? This changes verification (RUN-2/3) and liability.
3. **Background checks:** which provider, and which venues require them (airports certainly)?
4. **Smile ID:** confirm pricing per check and which products (Enhanced KYC + SmartSelfie suggested).
5. **Data ownership:** who owns buyer data when the partner brings the buyer?
6. **Pricing model:** per order, % of GMV, SaaS per venue, or a mix?
7. **Hardware budget** for the beacon pilot and the airport locker pilot, and who owns the devices (Layovr or venue).
8. **Ticketing:** build (TIX-1–3) or integrate only (TIX-4)?

## Sources (hardware and verification)

- Minew white-label beacons: [minew.com](https://www.minew.com/bluetooth-beacon/), [Alibaba listing](https://www.alibaba.com/product-detail/Minew-white-label-ble-ibeacon-long_1600081590524.html)
- Beacon marketplace prices: [made-in-china.com](https://www.made-in-china.com/products-search/hot-china-products/Ble_Beacon.html)
- NFC sticker prices: [GoToTags printed NTAG213](https://store.gototags.com/printed-nfc-sticker-ntag213), [on-metal](https://store.gototags.com/printed-on-metal-nfc-sticker-ntag213)
- Smart lockers: [OEM API locker listing](https://smartlockers.en.made-in-china.com/product/UFMadJwuEDpS/China-API-System-Docking-Smart-Parcel-Delivery-Lockers-for-Logistic.html), [ParcelHive pricing](https://www.parcelhive.com/blog/smart-locker-pricing-custom-configuration), [ParcelHive manufacturer guide](https://www.parcelhive.com/blog/how-to-choose-parcel-locker-manufacturer), [ButterflyMX](https://butterflymx.com/blog/smart-locker/), [LinQu API guide](https://www.linqubox.com/en/news/parcel-locker-api-integration-guide)
- Runner device: [Chert Nigeria, Sunmi V2s](https://chert.ng/sunmi-v2s-non-gms-14-cm-5-5-gps-usb-c-bt-wi-fi-4g-nfc-android-p06060002.html)
- Smile ID products: [Choose a product](https://docs.usesmileid.com/getting-started/choose-a-product), [Enhanced KYC](https://docs.smileidentity.com/integration-options/mobile/flutter-v10/products/enhanced-kyc), [Supported ID types](https://docs.usesmileid.com/general/supported-id-types)
