import { makeSeed, planSchema } from "@layovr/shared";
import { hashPin } from "../lib/auth";
import { applyPlan } from "../services/plans";
import type { Db, Queryable } from "./client";

/** Loads the demo venues, the Moonshot plan (areas + spots), sample vendors and staff. */
export async function seed(db: Db): Promise<void> {
  const s = makeSeed();
  await db.tx(async (q) => {
    for (const v of s.venues) {
      await q.query(
        `insert into venues (id, code, name, city, type, fill, is_live, is_sample,
           fee_pct, fee_flat_kobo, absorb_limit_kobo, floor_plan_url)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [v.id, v.code, v.name, v.city, v.type, v.fill, v.isLive, v.isSample,
         v.feePct, v.feeFlatKobo, v.absorbLimitKobo, v.floorPlanUrl ?? null],
      );
    }
    for (const { venueId, plan } of s.plans) {
      await applyPlan(q, venueId, planSchema.parse(plan));
    }
    for (const v of s.vendors) {
      await q.query(
        `insert into vendors (id, venue_id, zone_id, name, emoji, category, description,
           stall_label, is_open, prep_minutes, fill)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [v.id, v.venueId, v.zoneId ?? null, v.name, v.emoji, v.category, v.description,
         v.stallLabel, v.isOpen, v.prepMinutes, v.fill],
      );
    }
    const venueOf = new Map(s.vendors.map((v) => [v.id, v.venueId]));
    for (const p of s.products) {
      await q.query(
        `insert into products (id, venue_id, vendor_id, category, kind, name, description,
           price_kobo, price_checked_at, image_url, in_stock, fulfilment, duration_min, age_restricted)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [p.id, venueOf.get(p.vendorId), p.vendorId, p.category, p.kind, p.name,
         p.description ?? null, p.priceKobo, p.priceCheckedAt, p.imageUrl ?? null,
         p.inStock, p.fulfilment, p.durationMin ?? null, p.ageRestricted ?? false],
      );
    }
    // Demo partner accounts (local development; see /api/partner/demo-logins).
    await q.query(
      `insert into partners (id, name, slug, kind) values
         ('ptn_layovr', 'Layovr', 'layovr', 'layovr'),
         ('ptn_demo', 'TechCabal (demo)', 'techcabal-demo', 'event_planner')`,
    );
    await q.query(
      `insert into partner_users (id, partner_id, email, name, password_hash, role) values
         ('pu_ops', 'ptn_layovr', 'ops@demo.layovr.app', 'Layovr Ops', $1, 'operator'),
         ('pu_planner', 'ptn_demo', 'planner@demo.layovr.app', 'Demo Planner', $1, 'owner')`,
      [hashPin("layovr-demo")],
    );
    await q.query(
      `update venues set partner_id = 'ptn_demo', status = 'live', address = 'National Theatre, Iganmu, Lagos',
         lat = 6.47639, lng = 3.36944, template_code = 'NATIONAL-THEATRE',
         starts_at = '2026-10-28T08:00:00+01:00', ends_at = '2026-10-29T20:00:00+01:00'
       where id = 'v_moonshot'`,
    );
    for (const st of s.staff) {
      await q.query(
        `insert into staff (id, venue_id, name, role, phone, pin_hash, float_kobo,
           can_enter_restricted, on_shift)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [st.id, st.venueId, st.name, st.role, st.phone, hashPin(st.pin),
         st.floatKobo, st.canEnterRestricted, st.onShift],
      );
    }
  });
}

export async function isEmpty(q: Queryable): Promise<boolean> {
  const [row] = await q.query<{ n: number }>("select count(*)::int as n from venues");
  return (row?.n ?? 0) === 0;
}

/** Admin → "Reset demo data": wipes every table and reloads the seed. */
export async function resetData(db: Db): Promise<void> {
  await db.exec(
    `truncate api_audit, api_keys, invites, runner_locations, uploads, order_events, payments,
       purchases, order_items, order_stops, orders, products, vendors, spots, zones, staff,
       venues, partner_users, partners restart identity cascade`,
  );
  await seed(db);
}
