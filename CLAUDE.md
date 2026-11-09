# Layovr

Monorepo (npm workspaces): apps/web (TanStack Start + React 19 + Tailwind v4, Lovable-generated),
apps/api (Hono + Postgres via PGlite locally / pg with DATABASE_URL), packages/shared (types, fee rules, seed).
See README.md for how the pieces connect.

# Commands
- npm run dev            # api :8787 + web :8080
- npm test               # api tests (apps/api/test): flow + partner/MCP
- npm run typecheck
- npm run db:reset       # wipe local db + reseed

# Layout notes
- API routes register through router() in apps/api/src/http.ts with docs metadata; that feeds /api/openapi.json (a test fails if a route is undocumented).
- MCP tools (apps/api/src/mcp/tools.ts) wrap the same services as REST routes; write tools preview unless confirm: true.
- Services take a venue scope; routes check permission (staff role, partner ownership via events.partnerEvent, API key scope).

# Rules
- Money is integer kobo. Never floats.
- Order status changes ONLY via transition() in apps/api/src/services/orders.ts (writes order_events).
- Never trust client prices or fees; the API re-prices from the database.
- IMPORTANT: orders are marked paid only after Flutterwave verify succeeds (or demo mode with no FLW key).
- Every table has venue_id; staff actions are scoped to the staff member's venue and role in the API.
- Public responses never include PINs, pin_hash, staff phones or other buyers' orders. Staff views never include handoff_pin.
- Pages use hooks/actions from apps/web/src/lib/store.ts only; don't fetch the API directly from pages.
- apps/web/vite.config.ts uses @lovable.dev/vite-tanstack-config: don't add plugins it already includes.
- Venue maps follow docs/PLAN-STANDARD.md; packages/shared/src/plan.ts (planSchema + checkPlan) is the source of truth.
- docs/REQUIREMENTS.md is the approved scope for new work; cite requirement IDs in plans and PRs.
- Mobile-first: check pages at 390px width.
