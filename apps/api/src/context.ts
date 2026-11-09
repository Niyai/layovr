import type { StaffRole } from "@layovr/shared";
import type { Db } from "./db/client";
import type { Env } from "./lib/env";
import type { PaymentGateway } from "./lib/flutterwave";

export type Ctx = {
  db: Db;
  env: Env;
  /** null = demo payments (no FLW_SECRET_KEY). */
  gateway: PaymentGateway | null;
  /** Outbound HTTP for third-party lookups; tests pass a stub. */
  fetch?: typeof fetch;
};

/** A staff row as stored (snake_case), including pin_hash. Server-side only. */
export type StaffRow = {
  id: string;
  venue_id: string;
  name: string;
  role: StaffRole;
  phone: string;
  pin_hash: string;
  float_kobo: number;
  can_enter_restricted: boolean;
  on_shift: boolean;
};

/**
 * Who is changing a venue and which one. Routes decide whether the caller may
 * (staff role, partner ownership, API key); services only do the work.
 */
export type Scope = {
  venueId: string;
  actorId: string;
  actorName: string;
};

export const staffScope = (s: StaffRow): Scope => ({
  venueId: s.venue_id,
  actorId: s.id,
  actorName: s.name,
});

/** A signed-in partner user (dashboard) or a partner API key (headless / MCP). */
export type PartnerAuth = {
  partnerId: string;
  partnerName: string;
  /** Set for dashboard sessions. */
  userId?: string;
  userName: string;
  /** Set for API-key calls. */
  keyId?: string;
  role: "owner" | "manager" | "operator";
  scope: "read" | "write";
  channel: "dashboard" | "api" | "mcp";
};
