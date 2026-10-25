import type { StaffRole } from "@layovr/shared";
import type { Db } from "./db/client";
import type { Env } from "./lib/env";
import type { PaymentGateway } from "./lib/flutterwave";

export type Ctx = {
  db: Db;
  env: Env;
  /** null = demo payments (no FLW_SECRET_KEY). */
  gateway: PaymentGateway | null;
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
