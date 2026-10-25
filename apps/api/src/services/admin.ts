import type { Product, Spot, Staff, Vendor, Venue, Zone } from "@layovr/shared";
import type { Ctx, StaffRow } from "../context";
import { bad, conflict, forbidden, notFound } from "../lib/errors";
import { notify } from "../lib/events";
import { persistImage } from "../lib/images";

/** Venue setup and menu capture. Everything is scoped to the signed-in staff member's venue. */

function need(staff: StaffRow, ...roles: StaffRow["role"][]) {
  if (!roles.includes(staff.role)) throw forbidden();
}

export async function updateVenue(
  ctx: Ctx,
  staff: StaffRow,
  id: string,
  patch: Partial<Pick<Venue, "name" | "city" | "feePct" | "feeFlatKobo" | "absorbLimitKobo" | "floorPlanUrl" | "isLive">>,
) {
  need(staff, "admin");
  if (id !== staff.venue_id) throw notFound("Venue not found");
  await ctx.db.tx(async (q) => {
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const set = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (patch.name !== undefined) set("name", patch.name);
    if (patch.city !== undefined) set("city", patch.city);
    if (patch.feePct !== undefined) set("fee_pct", patch.feePct);
    if (patch.feeFlatKobo !== undefined) set("fee_flat_kobo", patch.feeFlatKobo);
    if (patch.absorbLimitKobo !== undefined) set("absorb_limit_kobo", patch.absorbLimitKobo);
    if (patch.isLive !== undefined) set("is_live", patch.isLive);
    if (patch.floorPlanUrl !== undefined) {
      set("floor_plan_url", await persistImage(q, id, patch.floorPlanUrl));
    }
    if (sets.length) await q.query(`update venues set ${sets.join(", ")} where id = $1`, vals);
  });
  notify({ venueId: id });
}

export async function updateZone(
  ctx: Ctx,
  staff: StaffRow,
  id: string,
  patch: Partial<Pick<Zone, "name" | "restricted" | "rect">>,
) {
  need(staff, "admin");
  const rows = await ctx.db.query(
    `update zones set name = coalesce($3, name), restricted = coalesce($4, restricted),
       rect = coalesce($5, rect)
     where id = $1 and venue_id = $2 returning id`,
    [id, staff.venue_id, patch.name ?? null, patch.restricted ?? null, patch.rect ? JSON.stringify(patch.rect) : null],
  );
  if (!rows.length) throw notFound("Zone not found");
  notify({ venueId: staff.venue_id });
}

export async function upsertSpot(ctx: Ctx, staff: StaffRow, spot: Spot) {
  need(staff, "admin");
  const [zone] = await ctx.db.query("select 1 from zones where id = $1 and venue_id = $2", [
    spot.zoneId,
    staff.venue_id,
  ]);
  if (!zone) throw bad("Pick a zone at this venue");
  const [clash] = await ctx.db.query("select id, venue_id from spots where code = $1 and id <> $2", [
    spot.code,
    spot.id,
  ]);
  if (clash) throw conflict(`Code ${spot.code} is already used.`);
  const [existing] = await ctx.db.query("select venue_id from spots where id = $1", [spot.id]);
  if (existing && existing.venue_id !== staff.venue_id) throw notFound("Spot not found");
  await ctx.db.query(
    `insert into spots (id, venue_id, zone_id, code, label, x, y, landmark, directions, active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id) do update set zone_id = excluded.zone_id, code = excluded.code,
       label = excluded.label, x = excluded.x, y = excluded.y, landmark = excluded.landmark,
       directions = excluded.directions, active = excluded.active`,
    [
      spot.id, staff.venue_id, spot.zoneId, spot.code, spot.label, spot.x, spot.y,
      spot.landmark ?? null, spot.directions ?? null, spot.active,
    ],
  );
  notify({ venueId: staff.venue_id });
}

/** Spots that orders point at are deactivated instead of deleted. */
export async function deleteSpot(ctx: Ctx, staff: StaffRow, id: string) {
  need(staff, "admin");
  const [used] = await ctx.db.query("select 1 from orders where spot_id = $1 limit 1", [id]);
  if (used) {
    await ctx.db.query("update spots set active = false where id = $1 and venue_id = $2", [id, staff.venue_id]);
  } else {
    await ctx.db.query("delete from spots where id = $1 and venue_id = $2", [id, staff.venue_id]);
  }
  notify({ venueId: staff.venue_id });
}

export async function upsertVendor(ctx: Ctx, staff: StaffRow, v: Vendor) {
  need(staff, "admin", "capture");
  const [existing] = await ctx.db.query("select venue_id from vendors where id = $1", [v.id]);
  if (existing && existing.venue_id !== staff.venue_id) throw notFound("Vendor not found");
  if (v.zoneId) {
    const [zone] = await ctx.db.query("select 1 from zones where id = $1 and venue_id = $2", [v.zoneId, staff.venue_id]);
    if (!zone) throw bad("Pick a zone at this venue");
  }
  await ctx.db.query(
    `insert into vendors (id, venue_id, zone_id, name, emoji, category, description,
       stall_label, is_open, prep_minutes, fill, captured_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (id) do update set zone_id = excluded.zone_id, name = excluded.name,
       emoji = excluded.emoji, category = excluded.category, description = excluded.description,
       stall_label = excluded.stall_label, is_open = excluded.is_open,
       prep_minutes = excluded.prep_minutes, fill = excluded.fill`,
    [
      v.id, staff.venue_id, v.zoneId ?? null, v.name, v.emoji, v.category, v.description,
      v.stallLabel, v.isOpen, v.prepMinutes, v.fill, staff.id,
    ],
  );
  notify({ venueId: staff.venue_id });
}

export async function upsertProduct(ctx: Ctx, staff: StaffRow, p: Product) {
  need(staff, "admin", "capture");
  await ctx.db.tx(async (q) => {
    const [vendor] = await q.query("select 1 from vendors where id = $1 and venue_id = $2", [
      p.vendorId,
      staff.venue_id,
    ]);
    if (!vendor) throw bad("Unknown vendor");
    const [existing] = await q.query("select venue_id from products where id = $1", [p.id]);
    if (existing && existing.venue_id !== staff.venue_id) throw notFound("Item not found");
    const image = await persistImage(q, staff.venue_id, p.imageUrl);
    await q.query(
      `insert into products (id, venue_id, vendor_id, category, kind, name, description,
         price_kobo, price_checked_at, image_url, in_stock, fulfilment, duration_min, age_restricted)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (id) do update set vendor_id = excluded.vendor_id, category = excluded.category,
         kind = excluded.kind, name = excluded.name, description = excluded.description,
         price_kobo = excluded.price_kobo, price_checked_at = excluded.price_checked_at,
         image_url = excluded.image_url, in_stock = excluded.in_stock,
         fulfilment = excluded.fulfilment, duration_min = excluded.duration_min,
         age_restricted = excluded.age_restricted`,
      [
        p.id, staff.venue_id, p.vendorId, p.category, p.kind, p.name, p.description ?? null,
        p.priceKobo, p.priceCheckedAt, image, p.inStock, p.fulfilment, p.durationMin ?? null,
        p.ageRestricted ?? false,
      ],
    );
  });
  notify({ venueId: staff.venue_id });
}

export async function deleteProduct(ctx: Ctx, staff: StaffRow, id: string) {
  need(staff, "admin");
  await ctx.db.query("delete from products where id = $1 and venue_id = $2", [id, staff.venue_id]);
  notify({ venueId: staff.venue_id });
}

export async function updateStaff(
  ctx: Ctx,
  staff: StaffRow,
  id: string,
  patch: Partial<Pick<Staff, "onShift" | "floatKobo" | "canEnterRestricted">>,
) {
  need(staff, "admin", "dispatch");
  const rows = await ctx.db.query(
    `update staff set on_shift = coalesce($3, on_shift), float_kobo = coalesce($4, float_kobo),
       can_enter_restricted = coalesce($5, can_enter_restricted)
     where id = $1 and venue_id = $2 returning id`,
    [id, staff.venue_id, patch.onShift ?? null, patch.floatKobo ?? null, patch.canEnterRestricted ?? null],
  );
  if (!rows.length) throw notFound("Staff member not found");
  notify({ venueId: staff.venue_id });
}
