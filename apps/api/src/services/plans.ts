import {
  PLAN_STANDARD,
  checkPlan,
  spotIdFor,
  zoneIdFor,
  type PlanCheck,
  type PlanMeta,
  type VenuePlan,
} from "@layovr/shared";
import type { Ctx } from "../context";
import type { Queryable } from "../db/client";
import { bad, conflict, notFound } from "../lib/errors";
import { notify } from "../lib/events";

export type ApplyResult = { removedAreas: number; removedSpots: number; deactivatedSpots: number };

/**
 * Applies a layovr-plan file to a venue: stores canvas/levels/sections/markers
 * on the venue and upserts areas (zones) and spots by code.
 * Without `prune`, areas and spots missing from the file are left alone.
 * With `prune` (the visual editor), they are removed, except spots that orders
 * point at, which are deactivated, and areas that still hold such spots.
 */
export async function applyPlan(
  q: Queryable,
  venueId: string,
  plan: VenuePlan,
  opts: { prune?: boolean } = {},
): Promise<ApplyResult> {
  const meta: PlanMeta = {
    standard: plan.standard,
    canvas: plan.canvas,
    levels: plan.levels,
    sections: plan.sections,
    markers: plan.markers,
  };
  await q.query(
    `update venues set plan = $2, name = $3, city = coalesce($4, city) where id = $1`,
    [venueId, JSON.stringify(meta), plan.venue.name, plan.venue.city ?? null],
  );

  const existing = await q.query("select id, code from zones where venue_id = $1", [venueId]);
  const zoneIds = new Map(existing.map((z) => [z.code as string, z.id as string]));
  for (const [i, a] of plan.areas.entries()) {
    const id = zoneIds.get(a.code) ?? zoneIdFor(venueId, a.code);
    zoneIds.set(a.code, id);
    await q.query(
      `insert into zones (id, venue_id, code, name, restricted, section, level, kind, shape, approximate, notes, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (id) do update set code = excluded.code, name = excluded.name,
         restricted = excluded.restricted, section = excluded.section, level = excluded.level,
         kind = excluded.kind, shape = excluded.shape, approximate = excluded.approximate,
         notes = excluded.notes, sort = excluded.sort`,
      [
        id, venueId, a.code, a.name, a.access === "restricted", a.section ?? null,
        a.level ?? null, a.kind, JSON.stringify(a.shape), a.approximate, a.notes ?? null, i,
      ],
    );
  }

  const codes = plan.spots.map((s) => s.code);
  for (const s of plan.spots) {
    const [row] = await q.query("select id from spots where venue_id = $1 and code = $2", [venueId, s.code]);
    await q.query(
      `insert into spots (id, venue_id, zone_id, code, label, x, y, landmark, directions, active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do update set zone_id = excluded.zone_id, label = excluded.label,
         x = excluded.x, y = excluded.y, landmark = excluded.landmark,
         directions = excluded.directions, active = excluded.active`,
      [
        row?.id ?? spotIdFor(venueId, s.code), venueId, zoneIds.get(s.area), s.code, s.label, s.x, s.y,
        s.landmark ?? null, s.directions ?? null, s.active,
      ],
    );
  }

  const result: ApplyResult = { removedAreas: 0, removedSpots: 0, deactivatedSpots: 0 };
  if (!opts.prune) return result;
  const gone = await q.query(
    `select s.id, exists (select 1 from orders o where o.spot_id = s.id) as used
     from spots s where s.venue_id = $1 and not (s.code = any($2))`,
    [venueId, codes],
  );
  for (const g of gone) {
    if (g.used) {
      await q.query("update spots set active = false where id = $1", [g.id]);
      result.deactivatedSpots++;
    } else {
      await q.query("delete from spots where id = $1", [g.id]);
      result.removedSpots++;
    }
  }
  const removed = await q.query(
    `delete from zones z where z.venue_id = $1 and not (z.code = any($2))
       and not exists (select 1 from spots s where s.zone_id = z.id)
     returning id`,
    [venueId, plan.areas.map((a) => a.code)],
  );
  result.removedAreas = removed.length;
  return result;
}

export type ImportResult = Omit<PlanCheck, "plan"> & { applied: boolean } & Partial<ApplyResult>;

/** Checks a plan file and, unless dryRun, applies it to the venue. The caller checks permission. */
export async function importPlan(
  ctx: Ctx,
  venueId: string,
  input: unknown,
  opts: { dryRun?: boolean; prune?: boolean } = {},
): Promise<ImportResult> {
  const dryRun = opts.dryRun ?? false;
  const check = checkPlan(input);
  const [venue] = await ctx.db.query("select code from venues where id = $1", [venueId]);
  if (!venue) throw notFound("Venue not found");
  if (check.plan && check.plan.venue.code !== venue.code) {
    check.errors.push(
      `This plan is for venue ${check.plan.venue.code}, but you're signed in to ${venue.code}. Change "venue.code" in the file.`,
    );
    check.ok = false;
  }
  if (!check.ok || dryRun || !check.plan) {
    const { plan: _plan, ...rest } = check;
    return { ...rest, applied: false };
  }
  const plan = check.plan;
  const applied = await ctx.db.tx((q) => applyPlan(q, venueId, plan, { prune: opts.prune ?? false }));
  notify({ venueId });
  const { plan: _plan, ...rest } = check;
  return { ...rest, ...applied, applied: true };
}

/** Rebuilds a plan file from the database, including edits made in admin since the import. */
export async function exportPlan(ctx: Ctx, venueId: string): Promise<VenuePlan> {
  const [venue] = await ctx.db.query("select * from venues where id = $1", [venueId]);
  if (!venue) throw notFound("Venue not found");
  const zones = await ctx.db.query("select * from zones where venue_id = $1 order by sort, code", [venue.id]);
  const spots = await ctx.db.query("select * from spots where venue_id = $1 order by code", [venue.id]);
  const meta = (venue.plan ?? null) as PlanMeta | null;
  const areaCode = new Map(zones.map((z) => [z.id as string, z.code as string]));
  if (!zones.length) throw bad("This venue has no areas yet. Import a plan first.");
  return {
    standard: PLAN_STANDARD,
    venue: { code: venue.code, name: venue.name, city: venue.city, type: venue.type },
    canvas: meta?.canvas ?? { width: 100, height: 75, unit: "units", north: 0 },
    levels: meta?.levels ?? [{ level: 0, name: "Ground floor" }],
    sections: meta?.sections ?? [],
    areas: zones.map((z) => ({
      code: z.code,
      name: z.name,
      ...(z.section ? { section: z.section } : {}),
      ...(z.level === null ? {} : { level: z.level }),
      kind: z.kind,
      access: z.restricted ? "restricted" : "open",
      shape: z.shape,
      approximate: z.approximate,
      ...(z.notes ? { notes: z.notes } : {}),
    })),
    spots: spots.map((s) => ({
      code: s.code,
      area: areaCode.get(s.zone_id) ?? "",
      label: s.label,
      x: s.x,
      y: s.y,
      ...(s.landmark ? { landmark: s.landmark } : {}),
      ...(s.directions ? { directions: s.directions } : {}),
      active: s.active,
    })),
    markers: meta?.markers ?? [],
  };
}
