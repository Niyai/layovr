import { HttpError } from "./errors";

/** Fixed-window, in-memory limiter keyed by e.g. "login:<ip>". */
const hits = new Map<string, { count: number; resetAt: number }>();

export function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    return;
  }
  entry.count += 1;
  if (entry.count > max) {
    throw new HttpError(429, "Too many attempts. Please wait a few minutes.");
  }
}

export function resetLimits() {
  hits.clear();
}
