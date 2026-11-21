import { DEMO_TICKETS, makeSeed, makeTestTickets, planSchema, seatKey } from "@layovr/shared";
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
           stall_label, is_open, prep_minutes, fill, mobile)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [v.id, v.venueId, v.zoneId ?? null, v.name, v.emoji, v.category, v.description,
         v.stallLabel, v.isOpen, v.prepMinutes, v.fill, v.mobile],
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
    await seedTickets(q, s.plans.find((p) => p.venueId === "v_moonshot")!.plan);
    for (const st of s.staff) {
      await q.query(
        `insert into staff (id, venue_id, name, role, phone, pin_hash, float_kobo,
           can_enter_restricted, on_shift, vendor_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [st.id, st.venueId, st.name, st.role, st.phone, hashPin(st.pin),
         st.floatKobo, st.canEnterRestricted, st.onShift, st.vendorId ?? null],
      );
    }
  });
}

/**
 * Test tickets for the Moonshot Main Bowl (the real chart isn't public): named
 * demo tickets in a friend group, one waiting seat change, and made-up tickets
 * filling about 60% of the other seats.
 */
async function seedTickets(q: Queryable, planInput: unknown) {
  const plan = planSchema.parse(planInput);
  await q.query("insert into ticket_groups (id, venue_id, code, name) values ('grp_demo', 'v_moonshot', 'MOONGANG', 'Moonshot crew')");
  const named = new Set(DEMO_TICKETS.map((t) => seatKey(t.block, t.row, t.seat)));
  const generated = makeTestTickets(plan.seating, { prefix: "MS", share: 0.6, gates: ["Zone B entrance", "Zone D entrance", "Zone A entrance"] })
    .filter((t) => !named.has(seatKey(t.block, t.row, t.seat)));
  for (const t of [...DEMO_TICKETS, ...generated]) {
    await q.query(
      `insert into tickets (id, venue_id, ticket_number, barcode, holder_name, tier, block, row_label, seat_number,
         checked_in_at, gate, group_id, share_seat)
       values ($1,'v_moonshot',$2,$3,$4,$5,$6,$7,$8, case when $9 then now() end, $10, $11, $12)`,
      [
        "id" in t ? t.id : `tkt_${t.number.toLowerCase().replace(/[^a-z0-9]/g, "")}`, t.number, t.barcode ?? null, t.name ?? "",
        t.tier ?? null, t.block, t.row, t.seat, Boolean(t.checkedIn), t.gate ?? null,
        "group" in t && t.group ? "grp_demo" : null, "shareSeat" in t ? t.shareSeat : true,
      ],
    );
  }
  await q.query(
    `insert into seat_requests (id, venue_id, ticket_id, want, note, from_seat)
     values ('srq_demo', 'v_moonshot', 'tkt_demo_bisi', 'friends', 'Can I sit with Ada and Chidi?', $1)`,
    [JSON.stringify({ block: "L", row: "K", seat: 2 })],
  );
}

export async function isEmpty(q: Queryable): Promise<boolean> {
  const [row] = await q.query<{ n: number }>("select count(*)::int as n from venues");
  return (row?.n ?? 0) === 0;
}

/** Admin → "Reset demo data": wipes every table and reloads the seed. */
export async function resetData(db: Db): Promise<void> {
  await db.exec(
    `truncate seat_requests, tickets, ticket_groups, api_audit, api_keys, invites, runner_locations, buyer_locations, vendor_locations, uploads, order_events, payments,
       purchases, order_items, order_stops, orders, products, vendors, spots, zones, staff,
       venues, partner_users, partners restart identity cascade`,
  );
  await seed(db);
}
