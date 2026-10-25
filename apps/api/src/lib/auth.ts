import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/** PINs are stored as scrypt hashes: "salt:hash" in hex. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function checkPin(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const got = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, got);
}

export const SESSION_COOKIE = "lv_staff";
const SESSION_HOURS = 16; // one event day

/** Session token: staffId.expiresAtMs.signature (HMAC-SHA256). */
export function signSession(staffId: string, secret: string): string {
  const exp = Date.now() + SESSION_HOURS * 3_600_000;
  const body = `${staffId}.${exp}`;
  return `${body}.${sign(body, secret)}`;
}

export function readSession(
  token: string | undefined,
  secret: string,
): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const body = token.slice(0, i);
  const sig = Buffer.from(token.slice(i + 1));
  const want = Buffer.from(sign(body, secret));
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
  const [staffId, exp] = body.split(".");
  if (!staffId || !exp || Number(exp) < Date.now()) return null;
  return staffId;
}

export const sessionMaxAge = SESSION_HOURS * 3600;

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** Constant-time string compare for webhook secrets. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
