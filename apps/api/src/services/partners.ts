import { createHash, randomBytes } from "node:crypto";
import { uid } from "@layovr/shared";
import type { Ctx, PartnerAuth } from "../context";
import type { Queryable } from "../db/client";
import { checkPin, hashPin } from "../lib/auth";
import { HttpError, conflict, forbidden, notFound } from "../lib/errors";

/** Partner accounts, API keys and the audit log. */

export type PartnerMe = {
  user: { id: string; name: string; email: string; role: string };
  partner: { id: string; name: string; kind: string };
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "partner";
}

export async function signup(
  ctx: Ctx,
  input: { name: string; organisation: string; kind: string; email: string; password: string; phone?: string | undefined },
): Promise<PartnerMe> {
  const email = input.email.toLowerCase();
  const [taken] = await ctx.db.query("select 1 from partner_users where email = $1", [email]);
  if (taken) throw conflict("An account with that email already exists. Sign in instead.");
  const partnerId = uid("ptn");
  const userId = uid("pu");
  await ctx.db.tx(async (q) => {
    let slug = slugify(input.organisation);
    const [clash] = await q.query("select 1 from partners where slug = $1", [slug]);
    if (clash) slug = `${slug}-${partnerId.slice(-4)}`;
    await q.query(
      "insert into partners (id, name, slug, kind, phone) values ($1,$2,$3,$4,$5)",
      [partnerId, input.organisation, slug, input.kind, input.phone ?? null],
    );
    await q.query(
      `insert into partner_users (id, partner_id, email, name, password_hash, role)
       values ($1,$2,$3,$4,$5,'owner')`,
      [userId, partnerId, email, input.name, hashPin(input.password)],
    );
  });
  return me(ctx.db, userId);
}

export async function login(ctx: Ctx, email: string, password: string): Promise<PartnerMe> {
  const [u] = await ctx.db.query("select * from partner_users where email = $1", [email.toLowerCase()]);
  // Same message either way, so emails can't be probed.
  if (!u || !checkPin(password, u.password_hash)) {
    throw new HttpError(401, "That email and password don't match.");
  }
  await ctx.db.query("update partner_users set last_login_at = now() where id = $1", [u.id]);
  return me(ctx.db, u.id);
}

export async function me(q: Queryable, userId: string): Promise<PartnerMe> {
  const [r] = await q.query(
    `select u.id, u.name, u.email, u.role, p.id as partner_id, p.name as partner_name, p.kind
     from partner_users u join partners p on p.id = u.partner_id where u.id = $1`,
    [userId],
  );
  if (!r) throw notFound("Account not found");
  return {
    user: { id: r.id, name: r.name, email: r.email, role: r.role },
    partner: { id: r.partner_id, name: r.partner_name, kind: r.kind },
  };
}

/** Session → PartnerAuth. */
export async function authForUser(q: Queryable, userId: string): Promise<PartnerAuth | null> {
  const [r] = await q.query(
    `select u.id, u.name, u.role, p.id as partner_id, p.name as partner_name
     from partner_users u join partners p on p.id = u.partner_id where u.id = $1`,
    [userId],
  );
  if (!r) return null;
  return {
    partnerId: r.partner_id,
    partnerName: r.partner_name,
    userId: r.id,
    userName: r.name,
    role: r.role,
    scope: "write",
    channel: "dashboard",
  };
}

/* ------------------------------------------------------------------ API keys */

const KEY_PREFIX = "lvk_";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Keys are random 32-byte secrets, so a fast hash is enough; only the hash is stored. */
export async function createApiKey(
  ctx: Ctx,
  auth: PartnerAuth,
  input: { name: string; scope: "read" | "write" },
): Promise<{ id: string; name: string; key: string; prefix: string; scope: string }> {
  if (auth.channel !== "dashboard") throw forbidden("Create API keys from the dashboard");
  const key = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  const id = uid("key");
  const prefix = key.slice(0, 12);
  await ctx.db.query(
    "insert into api_keys (id, partner_id, name, prefix, key_hash, scope) values ($1,$2,$3,$4,$5,$6)",
    [id, auth.partnerId, input.name, prefix, sha256(key), input.scope],
  );
  return { id, name: input.name, key, prefix, scope: input.scope };
}

export async function listApiKeys(ctx: Ctx, auth: PartnerAuth) {
  const rows = await ctx.db.query(
    `select id, name, prefix, scope, created_at, last_used_at, revoked_at
     from api_keys where partner_id = $1 order by created_at desc`,
    [auth.partnerId],
  );
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    prefix: r.prefix as string,
    scope: r.scope as string,
    createdAt: new Date(r.created_at).toISOString(),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
    revoked: Boolean(r.revoked_at),
  }));
}

export async function revokeApiKey(ctx: Ctx, auth: PartnerAuth, id: string) {
  const rows = await ctx.db.query(
    "update api_keys set revoked_at = now() where id = $1 and partner_id = $2 and revoked_at is null returning id",
    [id, auth.partnerId],
  );
  if (!rows.length) throw notFound("Key not found");
}

/** Bearer token → PartnerAuth, or null if missing, unknown or revoked. */
export async function authForKey(
  q: Queryable,
  token: string,
  channel: "api" | "mcp",
): Promise<PartnerAuth | null> {
  if (!token.startsWith(KEY_PREFIX)) return null;
  const [r] = await q.query(
    `select k.id, k.name, k.scope, p.id as partner_id, p.name as partner_name, p.kind
     from api_keys k join partners p on p.id = k.partner_id
     where k.key_hash = $1 and k.revoked_at is null`,
    [sha256(token)],
  );
  if (!r) return null;
  await q.query("update api_keys set last_used_at = now() where id = $1", [r.id]);
  return {
    partnerId: r.partner_id,
    partnerName: r.partner_name,
    keyId: r.id,
    userName: `API key "${r.name}"`,
    role: r.kind === "layovr" ? "operator" : "owner",
    scope: r.scope,
    channel,
  };
}

/* ------------------------------------------------------------------ audit */

export async function audit(
  q: Queryable,
  auth: PartnerAuth,
  action: string,
  target: string | null,
  ok: boolean,
  detail?: unknown,
) {
  await q.query(
    `insert into api_audit (partner_id, key_id, user_id, channel, action, target, ok, detail)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      auth.partnerId, auth.keyId ?? null, auth.userId ?? null, auth.channel, action, target, ok,
      detail === undefined ? null : JSON.stringify(detail),
    ],
  );
}
