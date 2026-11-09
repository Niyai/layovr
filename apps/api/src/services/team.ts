import { createHash, randomBytes, randomInt } from "node:crypto";
import { uid, type Product, type StaffRole, type Vendor } from "@layovr/shared";
import type { Ctx, Scope } from "../context";
import type { Queryable } from "../db/client";
import { checkPin, hashPin } from "../lib/auth";
import { HttpError, conflict, notFound } from "../lib/errors";
import { notify } from "../lib/events";
import * as admin from "./admin";
import { toProduct, toVendor } from "./mappers";

/**
 * People at an event: staff (runners, dispatch, admins, menu capture) and
 * vendors, including the single-use links vendors use to fill in their own menu.
 * Callers have already checked the caller may manage `venueId`.
 */

/* ------------------------------------------------------------------ staff */

export type TeamMember = {
  id: string;
  name: string;
  role: StaffRole;
  phone: string;
  canEnterRestricted: boolean;
  floatKobo: number;
  onShift: boolean;
  providedBy: "partner" | "layovr";
};

const toMember = (r: Record<string, unknown>): TeamMember => ({
  id: r.id as string,
  name: r.name as string,
  role: r.role as StaffRole,
  phone: r.phone as string,
  canEnterRestricted: r.can_enter_restricted as boolean,
  floatKobo: r.float_kobo as number,
  onShift: r.on_shift as boolean,
  providedBy: r.provided_by as "partner" | "layovr",
});

export async function listStaff(ctx: Ctx, venueId: string): Promise<TeamMember[]> {
  const rows = await ctx.db.query("select * from staff where venue_id = $1 order by role, name", [venueId]);
  return rows.map(toMember);
}

/** A 6-digit PIN nobody else at this event has. Staff sign in with event code + PIN. */
async function freshPin(q: Queryable, venueId: string): Promise<string> {
  const hashes = (await q.query("select pin_hash from staff where venue_id = $1", [venueId])).map(
    (r) => r.pin_hash as string,
  );
  for (let i = 0; i < 20; i++) {
    const pin = String(randomInt(100_000, 1_000_000));
    if (!hashes.some((h) => checkPin(pin, h))) return pin;
  }
  throw new HttpError(409, "Couldn't create a unique PIN, please try again");
}

export async function addStaff(
  ctx: Ctx,
  venueId: string,
  input: { name: string; role: StaffRole; phone: string; canEnterRestricted: boolean; floatKobo: number; onShift: boolean },
  providedBy: "partner" | "layovr",
): Promise<{ member: TeamMember; pin: string }> {
  const pin = await freshPin(ctx.db, venueId);
  const id = uid("st");
  await ctx.db.query(
    `insert into staff (id, venue_id, name, role, phone, pin_hash, float_kobo, can_enter_restricted, on_shift, provided_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, venueId, input.name, input.role, input.phone, hashPin(pin), input.floatKobo, input.canEnterRestricted, input.onShift, providedBy],
  );
  notify({ venueId });
  const [row] = await ctx.db.query("select * from staff where id = $1", [id]);
  return { member: toMember(row!), pin };
}

export async function updateMember(
  ctx: Ctx,
  venueId: string,
  id: string,
  patch: { name?: string | undefined; phone?: string | undefined; canEnterRestricted?: boolean | undefined; floatKobo?: number | undefined; onShift?: boolean | undefined },
): Promise<TeamMember> {
  const rows = await ctx.db.query(
    `update staff set name = coalesce($3, name), phone = coalesce($4, phone),
       can_enter_restricted = coalesce($5, can_enter_restricted), float_kobo = coalesce($6, float_kobo),
       on_shift = coalesce($7, on_shift)
     where id = $1 and venue_id = $2 returning *`,
    [id, venueId, patch.name ?? null, patch.phone ?? null, patch.canEnterRestricted ?? null, patch.floatKobo ?? null, patch.onShift ?? null],
  );
  if (!rows[0]) throw notFound("Staff member not found");
  notify({ venueId });
  return toMember(rows[0]);
}

export async function resetPin(ctx: Ctx, venueId: string, id: string): Promise<{ pin: string }> {
  const pin = await freshPin(ctx.db, venueId);
  const rows = await ctx.db.query(
    "update staff set pin_hash = $3 where id = $1 and venue_id = $2 returning id",
    [id, venueId, hashPin(pin)],
  );
  if (!rows.length) throw notFound("Staff member not found");
  return { pin };
}

/** Removes someone with no order history; otherwise they're taken off shift. */
export async function removeMember(ctx: Ctx, venueId: string, id: string): Promise<{ removed: boolean }> {
  const [used] = await ctx.db.query(
    `select 1 from orders where runner_id = $1 union select 1 from purchases where runner_id = $1 limit 1`,
    [id],
  );
  if (used) {
    await updateMember(ctx, venueId, id, { onShift: false });
    return { removed: false };
  }
  const rows = await ctx.db.query("delete from staff where id = $1 and venue_id = $2 returning id", [id, venueId]);
  if (!rows.length) throw notFound("Staff member not found");
  notify({ venueId });
  return { removed: true };
}

/* ------------------------------------------------------------------ vendors */

/** Vendor as the organiser sees it: contact details stay out of the public snapshot. */
export type TeamVendor = Vendor & { contactName?: string; contactPhone?: string; products: Product[] };

export async function listVendors(ctx: Ctx, venueId: string): Promise<TeamVendor[]> {
  const vendors = await ctx.db.query("select * from vendors where venue_id = $1 order by created_at", [venueId]);
  const products = await ctx.db.query("select * from products where venue_id = $1 order by created_at, id", [venueId]);
  return vendors.map((v) => ({
    ...toVendor(v),
    ...(v.contact_name ? { contactName: v.contact_name } : {}),
    ...(v.contact_phone ? { contactPhone: v.contact_phone } : {}),
    products: products.filter((p) => p.vendor_id === v.id).map(toProduct),
  }));
}

export type VendorInput = {
  name: string;
  emoji: string;
  category: string;
  description: string;
  zoneId?: string | undefined;
  stallLabel: string;
  isOpen: boolean;
  prepMinutes: number;
  fill: Vendor["fill"];
  contactName?: string | undefined;
  contactPhone?: string | undefined;
};

async function saveVendor(ctx: Ctx, scope: Scope, id: string, input: VendorInput) {
  await admin.upsertVendor(ctx, scope, {
    id,
    venueId: scope.venueId,
    name: input.name,
    emoji: input.emoji,
    category: input.category,
    description: input.description,
    stallLabel: input.stallLabel,
    isOpen: input.isOpen,
    prepMinutes: input.prepMinutes,
    fill: input.fill,
    ...(input.zoneId ? { zoneId: input.zoneId } : {}),
  });
  await ctx.db.query("update vendors set contact_name = $2, contact_phone = $3 where id = $1", [
    id,
    input.contactName ?? null,
    input.contactPhone ?? null,
  ]);
}

async function vendorById(ctx: Ctx, venueId: string, id: string): Promise<TeamVendor> {
  const v = (await listVendors(ctx, venueId)).find((x) => x.id === id);
  if (!v) throw notFound("Vendor not found");
  return v;
}

export async function createVendor(ctx: Ctx, scope: Scope, input: VendorInput): Promise<TeamVendor> {
  const id = uid("vd");
  await saveVendor(ctx, scope, id, input);
  return vendorById(ctx, scope.venueId, id);
}

export async function updateVendor(ctx: Ctx, scope: Scope, id: string, patch: Partial<VendorInput>): Promise<TeamVendor> {
  const current = await vendorById(ctx, scope.venueId, id);
  const merged: VendorInput = {
    name: patch.name ?? current.name,
    emoji: patch.emoji ?? current.emoji,
    category: patch.category ?? current.category,
    description: patch.description ?? current.description,
    zoneId: patch.zoneId ?? current.zoneId,
    stallLabel: patch.stallLabel ?? current.stallLabel,
    isOpen: patch.isOpen ?? current.isOpen,
    prepMinutes: patch.prepMinutes ?? current.prepMinutes,
    fill: patch.fill ?? current.fill,
    contactName: patch.contactName ?? current.contactName,
    contactPhone: patch.contactPhone ?? current.contactPhone,
  };
  await saveVendor(ctx, scope, id, merged);
  return vendorById(ctx, scope.venueId, id);
}

/** Vendors with past orders are closed rather than deleted, to keep order history intact. */
export async function removeVendor(ctx: Ctx, scope: Scope, id: string): Promise<{ removed: boolean }> {
  await vendorById(ctx, scope.venueId, id);
  const [used] = await ctx.db.query("select 1 from order_stops where vendor_id = $1 limit 1", [id]);
  if (used) {
    await updateVendor(ctx, scope, id, { isOpen: false });
    return { removed: false };
  }
  await ctx.db.query("delete from vendors where id = $1 and venue_id = $2", [id, scope.venueId]);
  notify({ venueId: scope.venueId });
  return { removed: true };
}

export type ItemInput = Omit<Product, "id" | "vendorId" | "priceCheckedAt"> & { priceCheckedAt?: string | undefined };

export async function saveItem(ctx: Ctx, scope: Scope, vendorId: string, itemId: string | null, input: ItemInput): Promise<Product> {
  await vendorById(ctx, scope.venueId, vendorId);
  const id = itemId ?? uid("p");
  const { priceCheckedAt, ...rest } = input;
  await admin.upsertProduct(ctx, scope, {
    ...rest,
    id,
    vendorId,
    priceCheckedAt: priceCheckedAt ?? new Date().toISOString().slice(0, 10),
  });
  const [row] = await ctx.db.query("select * from products where id = $1", [id]);
  return toProduct(row!);
}

export async function removeItem(ctx: Ctx, scope: Scope, vendorId: string, itemId: string) {
  const rows = await ctx.db.query(
    "delete from products where id = $1 and vendor_id = $2 and venue_id = $3 returning id",
    [itemId, vendorId, scope.venueId],
  );
  if (!rows.length) throw notFound("Item not found");
  notify({ venueId: scope.venueId });
}

/* ------------------------------------------------------------------ vendor invites */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const INVITE_DAYS = 7;

export async function createInvite(ctx: Ctx, venueId: string, vendorId: string): Promise<{ url: string; expiresAt: string }> {
  await vendorById(ctx, venueId, vendorId);
  const token = randomBytes(18).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  await ctx.db.query(
    "insert into invites (id, venue_id, vendor_id, token_hash, expires_at) values ($1,$2,$3,$4,$5)",
    [uid("inv"), venueId, vendorId, sha256(token), expiresAt],
  );
  return { url: `${ctx.env.publicAppUrl}/join/vendor/${token}`, expiresAt };
}

async function openInvite(q: Queryable, token: string) {
  const [inv] = await q.query("select * from invites where token_hash = $1", [sha256(token)]);
  if (!inv) throw notFound("This link isn't valid. Ask the organiser for a new one.");
  if (inv.used_at) throw conflict("This link has already been used. Ask the organiser for a new one.");
  if (new Date(inv.expires_at).getTime() < Date.now()) throw conflict("This link has expired. Ask the organiser for a new one.");
  return inv;
}

/** What a vendor sees on their invite page: their stall so far and the event's areas. */
export async function readInvite(ctx: Ctx, token: string) {
  const inv = await openInvite(ctx.db, token);
  const [event] = await ctx.db.query("select id, code, name, starts_at, address from venues where id = $1", [inv.venue_id]);
  const zones = await ctx.db.query("select id, code, name, section, level from zones where venue_id = $1 order by sort", [inv.venue_id]);
  const vendor = await vendorById(ctx, inv.venue_id, inv.vendor_id);
  return {
    event: { name: event!.name as string, code: event!.code as string, startsAt: event!.starts_at ? new Date(event!.starts_at).toISOString() : null, address: event!.address as string | null },
    areas: zones.map((z) => ({ id: z.id as string, name: z.name as string, code: z.code as string, location: `${z.section ?? ""}${z.level ?? ""}` })),
    vendor,
    expiresAt: new Date(inv.expires_at).toISOString(),
  };
}

export async function submitInvite(
  ctx: Ctx,
  token: string,
  input: { vendor: Omit<VendorInput, "isOpen">; items: Omit<ItemInput, "priceCheckedAt">[] },
): Promise<TeamVendor> {
  const inv = await openInvite(ctx.db, token);
  const scope: Scope = { venueId: inv.venue_id, actorId: inv.vendor_id, actorName: input.vendor.name };
  if (input.vendor.zoneId) {
    const [z] = await ctx.db.query("select 1 from zones where id = $1 and venue_id = $2", [input.vendor.zoneId, inv.venue_id]);
    if (!z) throw notFound("Pick an area from this event");
  }
  await updateVendor(ctx, scope, inv.vendor_id, { ...input.vendor, isOpen: true });
  for (const item of input.items) await saveItem(ctx, scope, inv.vendor_id, null, item);
  await ctx.db.query("update invites set used_at = now() where id = $1", [inv.id]);
  return vendorById(ctx, inv.venue_id, inv.vendor_id);
}
