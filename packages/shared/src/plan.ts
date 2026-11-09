import { z } from "zod";

/**
 * Venue plans: the "layovr-plan/1" standard.
 *
 * A plan describes a building the way a visitor experiences it:
 *   canvas   – the drawing area, in any consistent unit (metres if known)
 *   levels   – floors; 0 = ground, 1 = first floor up, -1 = first basement
 *   sections – the big signposted parts of a building (Zone A, Terminal 2, Pier B)
 *   areas    – rooms and spaces orders can go to (halls, lounges, food courts, gates)
 *   spots    – where a QR card sits; the delivery address
 *   markers  – entrances, stairs, lifts, the ops desk; entrances can be blocked
 *
 * Human guide: docs/PLAN-STANDARD.md. Blank template: docs/templates/.
 */

export const PLAN_STANDARD = "layovr-plan/1";

/* ------------------------------------------------------------------ shapes */

/** Angles are in degrees, clockwise from the top of the canvas (12 o'clock). */
export const shapeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rect"),
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
  }),
  z.object({
    type: z.literal("circle"),
    cx: z.number(),
    cy: z.number(),
    r: z.number().positive(),
  }),
  /** A slice of a ring: stadiums, theatres, round terminals. r0 = inner radius (0 for a pie slice). */
  z.object({
    type: z.literal("sector"),
    cx: z.number(),
    cy: z.number(),
    r0: z.number().min(0),
    r1: z.number().positive(),
    a0: z.number(),
    a1: z.number(),
  }),
  z.object({
    type: z.literal("polygon"),
    points: z.array(z.tuple([z.number(), z.number()])).min(3),
  }),
]);
export type Shape = z.infer<typeof shapeSchema>;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Point at `angle` degrees clockwise from 12 o'clock, `r` units from (cx, cy). */
export function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.sin(rad(angle)), cy - r * Math.cos(rad(angle))];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** SVG path data for a shape. */
export function shapePath(s: Shape): string {
  switch (s.type) {
    case "rect":
      return `M${s.x} ${s.y}h${s.w}v${s.h}h${-s.w}Z`;
    case "circle":
      return `M${s.cx - s.r} ${s.cy}a${s.r} ${s.r} 0 1 0 ${2 * s.r} 0a${s.r} ${s.r} 0 1 0 ${-2 * s.r} 0Z`;
    case "polygon":
      return `M${s.points.map(([x, y]) => `${x} ${y}`).join("L")}Z`;
    case "sector": {
      const sweep = s.a1 - s.a0;
      const large = sweep > 180 ? 1 : 0;
      const [ox0, oy0] = polar(s.cx, s.cy, s.r1, s.a0).map(round) as [number, number];
      const [ox1, oy1] = polar(s.cx, s.cy, s.r1, s.a1).map(round) as [number, number];
      if (s.r0 === 0) {
        return `M${s.cx} ${s.cy}L${ox0} ${oy0}A${s.r1} ${s.r1} 0 ${large} 1 ${ox1} ${oy1}Z`;
      }
      const [ix1, iy1] = polar(s.cx, s.cy, s.r0, s.a1).map(round) as [number, number];
      const [ix0, iy0] = polar(s.cx, s.cy, s.r0, s.a0).map(round) as [number, number];
      return `M${ox0} ${oy0}A${s.r1} ${s.r1} 0 ${large} 1 ${ox1} ${oy1}L${ix1} ${iy1}A${s.r0} ${s.r0} 0 ${large} 0 ${ix0} ${iy0}Z`;
    }
  }
}

/** Where to put an area's label. */
export function shapeCentre(s: Shape): [number, number] {
  switch (s.type) {
    case "rect":
      return [s.x + s.w / 2, s.y + s.h / 2];
    case "circle":
      return [s.cx, s.cy];
    case "polygon": {
      const n = s.points.length;
      return [
        s.points.reduce((a, p) => a + p[0], 0) / n,
        s.points.reduce((a, p) => a + p[1], 0) / n,
      ];
    }
    case "sector":
      return polar(s.cx, s.cy, (s.r0 + s.r1) / 2, (s.a0 + s.a1) / 2);
  }
}

const norm = (a: number) => ((a % 360) + 360) % 360;

export function pointInShape(x: number, y: number, s: Shape): boolean {
  switch (s.type) {
    case "rect":
      return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
    case "circle":
      return Math.hypot(x - s.cx, y - s.cy) <= s.r;
    case "sector": {
      const d = Math.hypot(x - s.cx, y - s.cy);
      if (d < s.r0 || d > s.r1) return false;
      const angle = norm((Math.atan2(x - s.cx, s.cy - y) * 180) / Math.PI);
      const start = norm(s.a0);
      const sweep = s.a1 - s.a0;
      return norm(angle - start) <= sweep;
    }
    case "polygon": {
      let inside = false;
      const p = s.points;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i]!;
        const [xj, yj] = p[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
  }
}

/** Smallest area containing the point (so a stall inside a hall wins over the hall). */
export function areaAt<T extends { shape: Shape; level?: number | undefined }>(
  areas: T[],
  x: number,
  y: number,
  level?: number,
): T | undefined {
  const hits = areas.filter(
    (a) =>
      (level === undefined || a.level === undefined || a.level === level) &&
      pointInShape(x, y, a.shape),
  );
  return hits.sort((a, b) => shapeSize(a.shape) - shapeSize(b.shape))[0];
}

/** Area of a shape in canvas units², used to pick label sizes and the innermost area. */
export function shapeSize(s: Shape): number {
  switch (s.type) {
    case "rect":
      return s.w * s.h;
    case "circle":
      return Math.PI * s.r * s.r;
    case "sector":
      return (Math.PI * (s.r1 ** 2 - s.r0 ** 2) * (s.a1 - s.a0)) / 360;
    case "polygon": {
      let a = 0;
      const p = s.points;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j]![0] + p[i]![0]) * (p[j]![1] - p[i]![1]);
      return Math.abs(a / 2);
    }
  }
}

/* ------------------------------------------------------------------ the standard */

export const AREA_KINDS = {
  hall: "Main hall, auditorium or stage room",
  exhibition: "Exhibition or expo floor with stands",
  meeting: "Meeting, workshop or deal room",
  lounge: "Lounge or VIP area",
  food: "Food court, restaurant or lunch area",
  lobby: "Entrance hall, foyer or corridor",
  outdoor: "Outdoor area (forecourt, garden, car park)",
  gate: "Airport gate or boarding area",
  retail: "Shop or retail unit",
  service: "Back-of-house, toilets, first aid, storage",
  seating: "Seating block inside a larger hall",
} as const;
export type AreaKind = keyof typeof AREA_KINDS;

export const MARKER_KINDS = {
  entrance: "Door or gate people use to get in or out",
  stairs: "Stairs between levels",
  lift: "Lift / elevator",
  escalator: "Escalator",
  ops_desk: "Layovr ops desk (runners start here)",
  toilet: "Toilets",
  first_aid: "First aid",
  security: "Security check or screening",
  info: "Information point",
} as const;

const code = (max: number) =>
  z.string().trim().toUpperCase().regex(new RegExp(`^[A-Z0-9][A-Z0-9-]{0,${max - 1}}$`), "Codes use letters, numbers and dashes");

export const planSchema = z.object({
  standard: z.literal(PLAN_STANDARD),
  venue: z.object({
    code: code(24),
    name: z.string().min(1).max(120),
    city: z.string().max(120).optional(),
    type: z.enum(["Event", "Mall", "Campus", "Neighbourhood", "Airport", "Office"]).default("Event"),
  }),
  canvas: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    unit: z.enum(["m", "ft", "units"]).default("units"),
    /** Degrees clockwise from the top of the canvas to true north (0 = north is up). */
    north: z.number().default(0),
    notes: z.string().max(500).optional(),
    /**
     * Places the plan on the real map: two or more points whose canvas position
     * and GPS position are both known. Enables "Use my location" and runner tracking.
     */
    geo: z
      .object({
        points: z
          .array(
            z.object({
              x: z.number(),
              y: z.number(),
              lat: z.number().min(-90).max(90),
              lng: z.number().min(-180).max(180),
            }),
          )
          .min(2)
          .max(8),
        /** True until someone calibrates on site with a phone. */
        approximate: z.boolean().default(false),
      })
      .optional(),
  }),
  levels: z
    .array(z.object({ level: z.number().int().min(-10).max(200), name: z.string().min(1).max(60) }))
    .min(1),
  sections: z
    .array(
      z.object({
        code: code(6),
        name: z.string().min(1).max(60),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      }),
    )
    .default([]),
  areas: z
    .array(
      z.object({
        code: code(12),
        name: z.string().min(1).max(80),
        section: code(6).optional(),
        /** Omit for spaces that span every level (an atrium, a stadium bowl). */
        level: z.number().int().optional(),
        kind: z.enum(Object.keys(AREA_KINDS) as [AreaKind, ...AreaKind[]]).default("hall"),
        access: z.enum(["open", "restricted"]).default("open"),
        shape: shapeSchema,
        capacity: z.number().int().positive().optional(),
        /** True when the outline is a best guess that needs checking on a site walk. */
        approximate: z.boolean().default(false),
        notes: z.string().max(500).optional(),
      }),
    )
    .min(1),
  spots: z
    .array(
      z.object({
        code: code(24),
        area: code(12),
        label: z.string().min(1).max(120),
        x: z.number(),
        y: z.number(),
        landmark: z.string().max(200).optional(),
        directions: z.string().max(400).optional(),
        active: z.boolean().default(true),
      }),
    )
    .default([]),
  markers: z
    .array(
      z.object({
        kind: z.enum(Object.keys(MARKER_KINDS) as [keyof typeof MARKER_KINDS, ...(keyof typeof MARKER_KINDS)[]]),
        label: z.string().min(1).max(80),
        level: z.number().int().optional(),
        x: z.number(),
        y: z.number(),
        status: z.enum(["open", "blocked"]).default("open"),
        note: z.string().max(200).optional(),
      }),
    )
    .default([]),
});

export type VenuePlan = z.infer<typeof planSchema>;
/** What a plan file looks like before defaults are filled in (what people write). */
export type VenuePlanInput = z.input<typeof planSchema>;
export type PlanMarker = VenuePlan["markers"][number];

/** Stored on the venue: everything in the plan except areas and spots (those are rows). */
export type PlanMeta = Pick<VenuePlan, "standard" | "canvas" | "levels" | "sections" | "markers">;

export type PlanCheck = { ok: boolean; errors: string[]; warnings: string[]; plan?: VenuePlan };

/** Schema check plus the rules a schema can't express. */
export function checkPlan(input: unknown): PlanCheck {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "plan"}: ${i.message}`),
      warnings: [],
    };
  }
  const plan = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const dupes = (list: string[], what: string) => {
    const seen = new Set<string>();
    for (const c of list) {
      if (seen.has(c)) errors.push(`Two ${what} use the code ${c}`);
      seen.add(c);
    }
  };
  dupes(plan.sections.map((s) => s.code), "sections");
  dupes(plan.areas.map((a) => a.code), "areas");
  dupes(plan.spots.map((s) => s.code), "spots");
  dupes(plan.levels.map((l) => String(l.level)), "levels");

  const levels = new Set(plan.levels.map((l) => l.level));
  const sections = new Set(plan.sections.map((s) => s.code));
  const areas = new Map(plan.areas.map((a) => [a.code, a]));
  const inCanvas = (x: number, y: number) =>
    x >= 0 && y >= 0 && x <= plan.canvas.width && y <= plan.canvas.height;

  for (const a of plan.areas) {
    if (a.section && !sections.has(a.section)) errors.push(`Area ${a.code} uses unknown section ${a.section}`);
    if (a.level !== undefined && !levels.has(a.level)) errors.push(`Area ${a.code} is on level ${a.level}, which isn't in levels`);
    if (!inCanvas(...shapeCentre(a.shape))) warnings.push(`Area ${a.code} sits outside the canvas`);
    if (a.approximate) warnings.push(`Area ${a.code} is approximate: confirm on the site walk`);
  }
  for (const s of plan.spots) {
    const a = areas.get(s.area);
    if (!a) {
      errors.push(`Spot ${s.code} points at unknown area ${s.area}`);
      continue;
    }
    if (!pointInShape(s.x, s.y, a.shape)) warnings.push(`Spot ${s.code} is drawn outside its area ${a.code}`);
    if (!inCanvas(s.x, s.y)) warnings.push(`Spot ${s.code} is outside the canvas`);
    const prefix = `${a.section ?? ""}${a.level ?? ""}`;
    if (prefix && !s.code.startsWith(`${prefix}-`)) {
      warnings.push(`Spot ${s.code}: the standard starts codes with section + level (${prefix}-…)`);
    }
  }
  for (const m of plan.markers) {
    if (m.level !== undefined && !levels.has(m.level)) errors.push(`Marker "${m.label}" is on unknown level ${m.level}`);
  }
  if (plan.canvas.geo) {
    const fit = fitGeo(plan.canvas.geo.points);
    if (!fit) errors.push("canvas.geo: the points are too close together to place the plan on the map");
    else if (plan.canvas.geo.approximate) warnings.push("The plan's map position is approximate: calibrate with GPS on site");
    else if (Math.max(...fit.residualM) > 25) warnings.push(`canvas.geo: points disagree by up to ${Math.round(Math.max(...fit.residualM))} m; re-check them`);
  }
  const withSpots = new Set(plan.spots.map((s) => s.area));
  for (const a of plan.areas) {
    if (!withSpots.has(a.code) && a.kind !== "service") warnings.push(`Area ${a.code} has no spots yet`);
  }
  return { ok: errors.length === 0, errors, warnings, ...(errors.length === 0 ? { plan } : {}) };
}

/** A starter file for a new venue: one level, one section, one area, one spot. */
export const PLAN_TEMPLATE: VenuePlanInput = {
  standard: PLAN_STANDARD,
  venue: { code: "MY-VENUE", name: "My venue", city: "Lagos", type: "Event" },
  canvas: { width: 100, height: 75, unit: "units", north: 0, notes: "Replace with metres if you have a scaled drawing." },
  levels: [{ level: 0, name: "Ground floor" }],
  sections: [{ code: "A", name: "Zone A", color: "#E8553B" }],
  areas: [
    {
      code: "HALL1",
      name: "Hall 1",
      section: "A",
      level: 0,
      kind: "hall",
      access: "open",
      shape: { type: "rect", x: 10, y: 10, w: 40, h: 30 },
      capacity: 300,
    },
  ],
  spots: [
    {
      code: "A0-HALL1-1",
      area: "HALL1",
      label: "Hall 1 · front rows",
      x: 30,
      y: 18,
      directions: "Main doors → straight ahead → front rows",
    },
  ],
  markers: [{ kind: "entrance", label: "Main entrance", level: 0, x: 30, y: 72, status: "open" }],
};

/** Stable row ids, so re-importing a plan updates areas and spots instead of duplicating them. */
export const zoneIdFor = (venueId: string, areaCode: string) =>
  `z_${venueId.replace(/^v_/, "")}_${areaCode.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
export const spotIdFor = (venueId: string, spotCode: string) =>
  `s_${venueId.replace(/^v_/, "")}_${spotCode.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

/* ------------------------------------------------------------------ GPS */

type GeoPoint = { x: number; y: number; lat: number; lng: number };

/** Great-circle distance in metres. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type GeoFit = {
  toCanvas: (lat: number, lng: number) => [number, number];
  toGeo: (x: number, y: number) => [number, number];
  /** Real-world metres per canvas unit. */
  metresPerUnit: number;
  /** How far each control point lands from where it should, in metres. */
  residualM: number[];
};

/**
 * Fits canvas ↔ GPS from control points as a similarity transform (move,
 * rotate, scale), least squares when there are more than two points. Works in
 * local metres around the points, which is exact enough for one venue.
 * Returns null if the points don't spread out enough to fix scale and rotation.
 */
export function fitGeo(points: GeoPoint[]): GeoFit | null {
  if (points.length < 2) return null;
  const lat0 = points.reduce((a, p) => a + p.lat, 0) / points.length;
  const lng0 = points.reduce((a, p) => a + p.lng, 0) / points.length;
  const kx = 111_320 * Math.cos(rad(lat0));
  const ky = 110_540;
  // Complex numbers as [re, im]. Canvas y grows downwards, so flip it to match north-up metres.
  const m = points.map((p) => [(p.lng - lng0) * kx, (p.lat - lat0) * ky] as const);
  const c = points.map((p) => [p.x, -p.y] as const);
  const mean = (v: (readonly [number, number])[]) =>
    [v.reduce((a, q) => a + q[0], 0) / v.length, v.reduce((a, q) => a + q[1], 0) / v.length] as const;
  const [mx, my] = mean(m);
  const [cx, cy] = mean(c);
  let nr = 0, ni = 0, d = 0;
  for (let i = 0; i < points.length; i++) {
    const ar = m[i]![0] - mx, ai = m[i]![1] - my;
    const br = c[i]![0] - cx, bi = c[i]![1] - cy;
    // (b) * conj(a)
    nr += br * ar + bi * ai;
    ni += bi * ar - br * ai;
    d += ar * ar + ai * ai;
  }
  if (d < 1) return null; // control points less than ~1 m apart
  const sr = nr / d, si = ni / d; // canvas = s * metres + t
  const scale = Math.hypot(sr, si);
  if (scale === 0) return null;
  const tr = cx - (sr * mx - si * my);
  const ti = cy - (sr * my + si * mx);

  const toCanvas = (lat: number, lng: number): [number, number] => {
    const ar = (lng - lng0) * kx, ai = (lat - lat0) * ky;
    return [sr * ar - si * ai + tr, -(sr * ai + si * ar + ti)];
  };
  const toGeo = (x: number, y: number): [number, number] => {
    const br = x - tr, bi = -y - ti;
    // (b) / s
    const den = sr * sr + si * si;
    const ar = (br * sr + bi * si) / den, ai = (bi * sr - br * si) / den;
    return [lat0 + ai / ky, lng0 + ar / kx];
  };
  const residualM = points.map((p) => {
    const [x, y] = toCanvas(p.lat, p.lng);
    return Math.hypot(x - p.x, y - p.y) / scale;
  });
  return { toCanvas, toGeo, metresPerUnit: 1 / scale, residualM };
}

/**
 * The spot to deliver to for a point someone tapped or a GPS fix: the nearest
 * active spot in the same area if the area has one, otherwise the nearest on that floor.
 */
export function nearestSpot<
  S extends { id: string; zoneId: string; x: number; y: number; active: boolean },
  Z extends { id: string; shape: Shape; level?: number | undefined },
>(spots: S[], zones: Z[], x: number, y: number, level?: number): S | undefined {
  const zoneLevel = new Map(zones.map((z) => [z.id, z.level]));
  const onFloor = spots.filter((s) => {
    const l = zoneLevel.get(s.zoneId);
    return s.active && (level === undefined || l === undefined || l === level);
  });
  const area = areaAt(zones, x, y, level);
  const inArea = area ? onFloor.filter((s) => s.zoneId === area.id) : [];
  const pool = inArea.length ? inArea : onFloor;
  let best: S | undefined;
  let bestD = Infinity;
  for (const s of pool) {
    const dd = Math.hypot(s.x - x, s.y - y);
    if (dd < bestD) {
      bestD = dd;
      best = s;
    }
  }
  return best;
}
