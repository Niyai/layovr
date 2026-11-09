import { PLAN_STANDARD, type AreaKind, type Shape, type VenuePlanInput } from "../plan";
import { moonshotPlan } from "./moonshot";

/**
 * Venue library: starting plans for popular Lagos event venues, plus generic
 * layouts. Planners pick one when creating an event and then edit their copy.
 *
 * Plans are in metres where the venue publishes dimensions, otherwise sized from
 * published capacities with standard densities (theatre ≈ 0.7 m²/person,
 * banquet ≈ 1.3, standing ≈ 0.5) and marked approximate. Research notes and
 * sources: docs/LAGOS-VENUES.md.
 */

export type VenueTemplate = {
  code: string;
  name: string;
  kind: "venue" | "generic";
  area?: string;
  /** Only where a published source gives the venue's position. */
  lat?: number;
  lng?: number;
  capacity?: string;
  /** measured = published dimensions; estimated = sized from capacity; schematic = drawn from signage. */
  dataQuality: "measured" | "estimated" | "schematic";
  summary: string;
  sources: { label: string; url: string }[];
  plan: () => VenuePlanInput;
};

type AreaDef = {
  code: string;
  name: string;
  section?: string;
  level?: number;
  kind: AreaKind;
  shape: Shape;
  capacity?: number;
  access?: "open" | "restricted";
  approximate?: boolean;
  notes?: string;
};
type SpotDef = [area: string, label: string, x: number, y: number, directions?: string];
type MarkerDef = VenuePlanInput["markers"] extends (infer M)[] | undefined ? M : never;

const rect = (x: number, y: number, w: number, h: number): Shape => ({ type: "rect", x, y, w, h });

/** Builds a plan, numbering spot codes per area in the standard <section><level>-<area>-<n> format. */
function build(opts: {
  code: string;
  name: string;
  city: string;
  width: number;
  height: number;
  unit?: "m" | "units";
  notes: string;
  levels?: { level: number; name: string }[];
  sections: { code: string; name: string; color: string }[];
  areas: AreaDef[];
  spots: SpotDef[];
  markers?: MarkerDef[];
}): VenuePlanInput {
  const count = new Map<string, number>();
  const area = new Map(opts.areas.map((a) => [a.code, a]));
  return {
    standard: PLAN_STANDARD,
    venue: { code: opts.code, name: opts.name, city: opts.city, type: "Event" },
    canvas: { width: opts.width, height: opts.height, unit: opts.unit ?? "m", north: 0, notes: opts.notes },
    levels: opts.levels ?? [{ level: 0, name: "Ground floor" }],
    sections: opts.sections,
    areas: opts.areas.map((a) => ({ ...a, access: a.access ?? "open", approximate: a.approximate ?? false })),
    spots: opts.spots.map(([areaCode, label, x, y, directions]) => {
      const a = area.get(areaCode)!;
      const n = (count.get(areaCode) ?? 0) + 1;
      count.set(areaCode, n);
      const prefix = `${a.section ?? ""}${a.level ?? ""}`;
      return {
        code: `${prefix ? `${prefix}-` : ""}${areaCode}-${n}`,
        area: areaCode,
        label,
        x,
        y,
        ...(directions ? { directions } : {}),
      };
    }),
    markers: opts.markers ?? [],
  };
}

/** A stadium bowl: pitch in the middle, four stands as ring slices, concourse around them. */
function stadium(code: string, name: string, capacity: number, notes: string): VenuePlanInput {
  // Pitch ~105 × 68 m; stand depth grows with capacity.
  const depth = Math.min(45, 12 + capacity / 1500);
  const c = { cx: 100, cy: 80 };
  const r0 = 66;
  const r1 = r0 + depth;
  const stand = (code: string, name: string, a0: number, a1: number): AreaDef => ({
    code,
    name,
    section: code[0]!,
    level: 0,
    kind: "seating",
    shape: { type: "sector", ...c, r0, r1, a0, a1 },
    capacity: Math.round(capacity / 4),
    approximate: true,
  });
  const size = Math.ceil(r1 + 12) * 2;
  return build({
    code,
    name,
    city: "Lagos",
    width: size,
    height: size,
    notes: notes + " Stands are drawn as four equal ring slices; adjust to the real stand layout.",
    sections: [
      { code: "N", name: "North stand", color: "#1E5BFF" },
      { code: "E", name: "East stand", color: "#00A651" },
      { code: "S", name: "South stand", color: "#E8553B" },
      { code: "W", name: "West stand", color: "#8E24AA" },
    ],
    areas: (
      [
        {
          code: "PITCH",
          name: "Pitch / arena floor",
          level: 0,
          kind: "outdoor",
          // Already centred on the canvas; shift() leaves rectangles alone.
          shape: rect(size / 2 - 52, size / 2 - 34, 104, 68),
          notes: "No delivery spots: usually closed during play or shows.",
          access: "restricted",
        },
        stand("NSTAND", "North stand", 315, 405),
        stand("ESTAND", "East stand", 45, 135),
        stand("SSTAND", "South stand", 135, 225),
        stand("WSTAND", "West stand", 225, 315),
      ] satisfies AreaDef[]
    ).map((a): AreaDef => ({ ...a, shape: shift(a.shape, size / 2 - c.cx, size / 2 - c.cy) })),
    spots: [
      ["NSTAND", "North stand · centre, upper rows", size / 2, size / 2 - r0 - depth * 0.7],
      ["NSTAND", "North stand · centre, lower rows", size / 2, size / 2 - r0 - depth * 0.25],
      ["ESTAND", "East stand · centre", size / 2 + r0 + depth / 2, size / 2],
      ["SSTAND", "South stand · centre", size / 2, size / 2 + r0 + depth / 2],
      ["WSTAND", "West stand · centre", size / 2 - r0 - depth / 2, size / 2],
    ],
    markers: [
      { kind: "entrance", label: "Main gate", level: 0, x: size / 2, y: size - 4 },
      { kind: "ops_desk", label: "Layovr ops desk (set on site)", level: 0, x: size / 2 + 10, y: size - 6 },
    ],
  });
}

function shift(s: Shape, dx: number, dy: number): Shape {
  switch (s.type) {
    case "rect":
      return s;
    case "circle":
      return { ...s, cx: s.cx + dx, cy: s.cy + dy };
    case "sector":
      return { ...s, cx: s.cx + dx, cy: s.cy + dy };
    case "polygon":
      return { ...s, points: s.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
  }
}

export const VENUE_LIBRARY: VenueTemplate[] = [
  {
    code: "NATIONAL-THEATRE",
    name: "National Theatre (Wole Soyinka Centre), Iganmu",
    kind: "venue",
    area: "Iganmu",
    lat: 6.47639,
    lng: 3.36944,
    capacity: "Main Bowl ~5,000; halls, cinemas and exhibition halls around it",
    dataQuality: "schematic",
    summary: "Round building: Main Bowl, exhibition halls, cinemas 1–3, banquet hall, wings A–D on 7 floors. Drawn from the Moonshot 2026 signage.",
    sources: [{ label: "Moonshot 2026 venue signage", url: "https://en.wikipedia.org/wiki/National_Arts_Theatre" }],
    plan: () => moonshotPlan,
  },
  {
    code: "LANDMARK-CENTRE",
    name: "Landmark Centre, Oniru (Victoria Island)",
    kind: "venue",
    area: "Victoria Island",
    capacity: "10–2,500",
    dataQuality: "measured",
    summary: "Main hall ABC 36.3 × 57 m (2,230 m²) splitting into Halls A, B, C; Hall 2 (1,452 m²); 520 m² of meeting rooms; 178 m² mezzanine.",
    sources: [
      { label: "Landmark floor plans", url: "https://landmarklagos.com/floor-plans/" },
      { label: "Landmark about", url: "https://landmarklagos.com/about-us/" },
    ],
    plan: () =>
      build({
        code: "LANDMARK-CENTRE",
        name: "Landmark Centre",
        city: "Victoria Island, Lagos",
        width: 120,
        height: 90,
        notes: "Main hall from published dimensions (36.3 × 57.0 m, 14 m high). Hall 2, meeting rooms and foyer positions are approximate.",
        levels: [
          { level: 0, name: "Ground floor" },
          { level: 1, name: "Mezzanine" },
        ],
        sections: [
          { code: "M", name: "Main hall", color: "#E8553B" },
          { code: "H", name: "Hall 2", color: "#1E5BFF" },
          { code: "C", name: "Conference rooms", color: "#8E24AA" },
        ],
        areas: [
          { code: "HALLA", name: "Hall A", section: "M", level: 0, kind: "exhibition", shape: rect(8, 8, 36.3, 20.5), capacity: 570, notes: "≈744 m². Part of main hall ABC." },
          { code: "HALLB", name: "Hall B", section: "M", level: 0, kind: "exhibition", shape: rect(8, 28.5, 36.3, 20), capacity: 560, notes: "Halls A+B ≈1,469 m² (published)." },
          { code: "HALLC", name: "Hall C", section: "M", level: 0, kind: "exhibition", shape: rect(8, 48.5, 36.3, 16.5), capacity: 460 },
          { code: "HALL2", name: "Hall 2", section: "H", level: 0, kind: "exhibition", shape: rect(52, 8, 33, 44), capacity: 1100, approximate: true, notes: "1,452 m² published; shape and position estimated." },
          { code: "FOYER", name: "Foyer", section: "M", level: 0, kind: "lobby", shape: rect(8, 67, 77, 14), approximate: true },
          { code: "MR1", name: "Meeting room 1", section: "C", level: 0, kind: "meeting", shape: rect(90, 8, 14, 9.3), approximate: true },
          { code: "MR2", name: "Meeting room 2", section: "C", level: 0, kind: "meeting", shape: rect(90, 18.3, 14, 9.3), approximate: true },
          { code: "MR3", name: "Meeting room 3", section: "C", level: 0, kind: "meeting", shape: rect(90, 28.6, 14, 9.3), approximate: true },
          { code: "MR4", name: "Meeting room 4", section: "C", level: 0, kind: "meeting", shape: rect(90, 38.9, 14, 9.3), approximate: true, notes: "Meeting rooms total 520 m² (published)." },
          { code: "MEZZ", name: "Mezzanine", section: "M", level: 1, kind: "lounge", shape: rect(8, 8, 36.3, 4.9), approximate: true, notes: "178 m² published." },
        ],
        spots: [
          ["HALLA", "Hall A · front", 26, 13],
          ["HALLA", "Hall A · back", 26, 24],
          ["HALLB", "Hall B · front", 26, 33],
          ["HALLB", "Hall B · back", 26, 44],
          ["HALLC", "Hall C · centre", 26, 56],
          ["HALL2", "Hall 2 · front", 68, 15],
          ["HALL2", "Hall 2 · back", 68, 45],
          ["FOYER", "Foyer · by the main doors", 45, 76],
          ["MR1", "Meeting room 1", 97, 12],
          ["MR2", "Meeting room 2", 97, 23],
          ["MR3", "Meeting room 3", 97, 33],
          ["MR4", "Meeting room 4", 97, 43],
          ["MEZZ", "Mezzanine", 26, 10],
        ],
        markers: [
          { kind: "entrance", label: "Main entrance", level: 0, x: 45, y: 81 },
          { kind: "ops_desk", label: "Layovr ops desk (set on site)", level: 0, x: 70, y: 74 },
          { kind: "stairs", label: "Stairs to mezzanine", x: 10, y: 66 },
        ],
      }),
  },
  {
    code: "EKO-CONVENTION",
    name: "Eko Convention Centre, Eko Hotels (Victoria Island)",
    kind: "venue",
    area: "Victoria Island",
    lat: 6.4225,
    lng: 3.4272,
    capacity: "Up to 3,000 dinner/conference; ~270 booths; Expo Centre 5,000+",
    dataQuality: "estimated",
    summary: "5,151 m² convention centre that splits into 5 sections, plus the separate Eko Expo Centre.",
    sources: [
      { label: "Eko Convention Center", url: "https://ekohotels.com/eko-convention-center.php" },
      { label: "2exhibitions listing", url: "https://www.2exhibitions.com/venue/eko-convention-centre/" },
    ],
    plan: () =>
      build({
        code: "EKO-CONVENTION",
        name: "Eko Convention Centre",
        city: "Victoria Island, Lagos",
        width: 150,
        height: 120,
        notes: "Total area 5,151 m² is published; drawn as 5 equal sections of a 101 × 51 m hall. The Expo Centre is sized from its 5,000-seat capacity. All positions approximate.",
        sections: [
          { code: "E", name: "Convention centre", color: "#E8553B" },
          { code: "X", name: "Expo centre", color: "#1E5BFF" },
        ],
        areas: [
          ...[1, 2, 3, 4, 5].map(
            (n): AreaDef => ({
              code: `SEC${n}`,
              name: `Section ${n}`,
              section: "E",
              level: 0,
              kind: "exhibition",
              shape: rect(8 + (n - 1) * 20.2, 8, 20.2, 51),
              capacity: 600,
              approximate: true,
              notes: "≈1,030 m², one fifth of the hall.",
            }),
          ),
          { code: "FOYER", name: "Convention foyer", section: "E", level: 0, kind: "lobby", shape: rect(8, 59, 101, 12), approximate: true },
          { code: "EXPO", name: "Eko Expo Centre", section: "X", level: 0, kind: "hall", shape: rect(8, 78, 80, 36), capacity: 5000, approximate: true, notes: "Sized from 5,000 seats (theatre)." },
        ],
        spots: [
          ...[1, 2, 3, 4, 5].flatMap((n): SpotDef[] => [
            [`SEC${n}`, `Section ${n} · front`, 18 + (n - 1) * 20.2, 15],
            [`SEC${n}`, `Section ${n} · back`, 18 + (n - 1) * 20.2, 50],
          ]),
          ["FOYER", "Convention foyer · main doors", 58, 65],
          ["EXPO", "Expo Centre · front", 48, 85],
          ["EXPO", "Expo Centre · back", 48, 108],
        ],
        markers: [
          { kind: "entrance", label: "Convention centre entrance", level: 0, x: 58, y: 71 },
          { kind: "entrance", label: "Expo Centre entrance", level: 0, x: 88, y: 96 },
          { kind: "ops_desk", label: "Layovr ops desk (set on site)", level: 0, x: 100, y: 65 },
        ],
      }),
  },
  {
    code: "BALMORAL-FPH",
    name: "Balmoral Convention Centre, Federal Palace Hotel (Victoria Island)",
    kind: "venue",
    area: "Victoria Island",
    lat: 6.431413,
    lng: 3.407049,
    capacity: "Theatre 3,500–4,000; banquet 1,500–2,500",
    dataQuality: "estimated",
    summary: "2,100 m² hall expandable to 5,000 m², plus Federal Palace's 34 × 25 m external ballroom.",
    sources: [
      { label: "Balmoral Convention Centre", url: "https://balmoral.com.ng/why-us/balmoral-convention-centre-vi/" },
      { label: "Federal Palace venue listing", url: "https://10times.com/venues/federal-palace-hotel" },
    ],
    plan: () =>
      build({
        code: "BALMORAL-FPH",
        name: "Balmoral Convention Centre",
        city: "Victoria Island, Lagos",
        width: 120,
        height: 110,
        notes: "Main hall 2,100 m² and expansion to 5,000 m² are published; shapes are estimated. External ballroom 34 × 25 m is published.",
        sections: [
          { code: "B", name: "Balmoral", color: "#8E24AA" },
          { code: "F", name: "Federal Palace", color: "#00A651" },
        ],
        areas: [
          { code: "MAIN", name: "Balmoral main hall", section: "B", level: 0, kind: "hall", shape: rect(8, 8, 60, 35), capacity: 1600, approximate: true },
          { code: "EXT", name: "Balmoral expansion space", section: "B", level: 0, kind: "hall", shape: rect(8, 43, 60, 48), capacity: 2200, approximate: true, notes: "Opens up to make 5,000 m² in total." },
          { code: "BALL", name: "External Ballroom", section: "F", level: 0, kind: "hall", shape: rect(78, 8, 34, 25), capacity: 750 },
          { code: "FOYER", name: "Foyer", section: "B", level: 0, kind: "lobby", shape: rect(78, 40, 34, 20), approximate: true },
        ],
        spots: [
          ["MAIN", "Main hall · front", 38, 15],
          ["MAIN", "Main hall · back", 38, 38],
          ["EXT", "Expansion space · front", 38, 50],
          ["EXT", "Expansion space · back", 38, 84],
          ["BALL", "External Ballroom", 95, 20],
          ["FOYER", "Foyer", 95, 50],
        ],
        markers: [
          { kind: "entrance", label: "Main entrance", level: 0, x: 95, y: 60 },
          { kind: "ops_desk", label: "Layovr ops desk (set on site)", level: 0, x: 105, y: 55 },
        ],
      }),
  },
  {
    code: "HARBOUR-POINT",
    name: "Harbour Point, Victoria Island",
    kind: "venue",
    area: "Victoria Island",
    capacity: "Hall A ~1,000 banquet; Hall B ~1,500",
    dataQuality: "estimated",
    summary: "Two main halls plus board and seminar rooms. Floor plans are available from the venue on request.",
    sources: [
      { label: "Lagos Arena guide listing", url: "https://lagosarenaguide.com/victoria-island/venue/harbour-point-centre-1285/" },
      { label: "Events Nigeria listing", url: "https://venue.eventsnigeria.com/venue/harbour-point-hall/" },
    ],
    plan: () =>
      build({
        code: "HARBOUR-POINT",
        name: "Harbour Point",
        city: "Victoria Island, Lagos",
        width: 120,
        height: 80,
        notes: "Halls sized from published banquet capacities (~1.3 m²/guest). Ask the venue for its floor plan and adjust.",
        sections: [{ code: "H", name: "Harbour Point", color: "#1E5BFF" }],
        areas: [
          { code: "HALLA", name: "Hall A", section: "H", level: 0, kind: "hall", shape: rect(8, 8, 45, 29), capacity: 1000, approximate: true },
          { code: "HALLB", name: "Hall B", section: "H", level: 0, kind: "hall", shape: rect(60, 8, 50, 39), capacity: 1500, approximate: true },
          { code: "BOARD", name: "Board & seminar rooms", section: "H", level: 0, kind: "meeting", shape: rect(8, 44, 45, 14), approximate: true },
          { code: "FOYER", name: "Foyer", section: "H", level: 0, kind: "lobby", shape: rect(8, 62, 102, 12), approximate: true },
        ],
        spots: [
          ["HALLA", "Hall A · front", 30, 14],
          ["HALLA", "Hall A · back", 30, 32],
          ["HALLB", "Hall B · front", 85, 14],
          ["HALLB", "Hall B · back", 85, 42],
          ["BOARD", "Board & seminar rooms", 30, 51],
          ["FOYER", "Foyer", 59, 68],
        ],
        markers: [{ kind: "entrance", label: "Main entrance", level: 0, x: 59, y: 74 }],
      }),
  },
  {
    code: "CIVIC-CENTRE",
    name: "The Civic Centre, Victoria Island",
    kind: "venue",
    area: "Victoria Island",
    capacity: "Grand Banquet Hall 500 seated / 1,000 standing",
    dataQuality: "estimated",
    summary: "Grand Banquet Hall plus foyer and terrace.",
    sources: [{ label: "Cvent listing", url: "https://www.cvent.com/venues/en-US/lagos/convention-center/the-civic-center/venue-3d7dfaa6-6e97-4a5c-a526-3ca1e465c4c1" }],
    plan: () =>
      build({
        code: "CIVIC-CENTRE",
        name: "The Civic Centre",
        city: "Victoria Island, Lagos",
        width: 70,
        height: 55,
        notes: "Hall sized from 550 banquet / 1,000 theatre capacity. Positions approximate.",
        sections: [{ code: "C", name: "Civic Centre", color: "#00A651" }],
        areas: [
          { code: "GRAND", name: "Grand Banquet Hall", section: "C", level: 0, kind: "hall", shape: rect(8, 8, 35, 21), capacity: 550, approximate: true },
          { code: "FOYER", name: "Foyer", section: "C", level: 0, kind: "lobby", shape: rect(8, 33, 35, 10), approximate: true },
          { code: "TERRACE", name: "Waterfront terrace", section: "C", level: 0, kind: "outdoor", shape: rect(48, 8, 15, 35), approximate: true },
        ],
        spots: [
          ["GRAND", "Grand Banquet Hall · front", 25, 12],
          ["GRAND", "Grand Banquet Hall · back", 25, 25],
          ["FOYER", "Foyer", 25, 38],
          ["TERRACE", "Terrace", 55, 25],
        ],
        markers: [{ kind: "entrance", label: "Main entrance", level: 0, x: 25, y: 43 }],
      }),
  },
  {
    code: "MUSON-CENTRE",
    name: "MUSON Centre, Onikan",
    kind: "venue",
    area: "Onikan, Lagos Island",
    lat: 6.45488,
    lng: 3.4246,
    capacity: "Shell Hall 1,000 seats; Agip Recital Hall ~260–340",
    dataQuality: "estimated",
    summary: "Shell Nigeria Hall (1,000 seats) and Agip Recital Hall (~44 × 19 m), with foyer and grounds.",
    sources: [
      { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Muson_Centre" },
      { label: "Cvent listing", url: "https://www.cvent.com/venues/lagos/entertainment-venue/the-muson-centre/venue-b8e37cab-ec45-4050-a40c-c9366aad748d" },
    ],
    plan: () =>
      build({
        code: "MUSON-CENTRE",
        name: "MUSON Centre",
        city: "Onikan, Lagos",
        width: 110,
        height: 70,
        notes: "Agip Recital Hall from a published 144.5 × 62.4 ft; Shell Hall sized from 1,000 seats plus stage. Positions approximate.",
        sections: [{ code: "M", name: "MUSON", color: "#E8553B" }],
        areas: [
          { code: "SHELL", name: "Shell Nigeria Hall", section: "M", level: 0, kind: "hall", shape: rect(8, 8, 35, 30), capacity: 1000, approximate: true },
          { code: "AGIP", name: "Agip Recital Hall", section: "M", level: 0, kind: "hall", shape: rect(50, 8, 44, 19), capacity: 300 },
          { code: "FOYER", name: "Foyer", section: "M", level: 0, kind: "lobby", shape: rect(8, 42, 86, 10), approximate: true },
          { code: "GROUNDS", name: "Grounds & car park", section: "M", level: 0, kind: "outdoor", shape: rect(8, 55, 86, 12), approximate: true },
        ],
        spots: [
          ["SHELL", "Shell Hall · front stalls", 25, 16],
          ["SHELL", "Shell Hall · back stalls", 25, 33],
          ["AGIP", "Agip Recital Hall", 72, 17],
          ["FOYER", "Foyer", 50, 47],
          ["GROUNDS", "Grounds", 50, 61],
        ],
        markers: [{ kind: "entrance", label: "Main gate", level: 0, x: 50, y: 67 }],
      }),
  },
  {
    code: "LAGOS-ORIENTAL",
    name: "Lagos Oriental Hotel, Lekki",
    kind: "venue",
    area: "Lekki",
    capacity: "4 meeting rooms, 1,061 m² in total",
    dataQuality: "estimated",
    summary: "Four function rooms totalling 1,061 m².",
    sources: [{ label: "Venue listing", url: "https://www.amimagazine.global/Meeting-Event-Venues/Victoria-Island-Nigeria/Convention-Hotel/Lagos-Oriental-Hotel-Lekki-p58011914" }],
    plan: () =>
      build({
        code: "LAGOS-ORIENTAL",
        name: "Lagos Oriental Hotel",
        city: "Lekki, Lagos",
        width: 70,
        height: 50,
        notes: "Total 1,061 m² across four rooms is published; drawn as four equal rooms. Positions approximate.",
        sections: [{ code: "O", name: "Function rooms", color: "#8E24AA" }],
        areas: [1, 2, 3, 4].map(
          (n): AreaDef => ({
            code: `ROOM${n}`,
            name: `Function room ${n}`,
            section: "O",
            level: 0,
            kind: "meeting",
            shape: rect(5 + ((n - 1) % 2) * 31, 5 + Math.floor((n - 1) / 2) * 20, 29, 18),
            approximate: true,
          }),
        ),
        spots: [1, 2, 3, 4].map((n): SpotDef => [`ROOM${n}`, `Function room ${n}`, 19.5 + ((n - 1) % 2) * 31, 14 + Math.floor((n - 1) / 2) * 20]),
        markers: [{ kind: "entrance", label: "Lobby entrance", level: 0, x: 35, y: 47 }],
      }),
  },
  {
    code: "TESLIM-BALOGUN",
    name: "Teslim Balogun Stadium, Surulere",
    kind: "venue",
    area: "Surulere",
    capacity: "24,325",
    dataQuality: "estimated",
    summary: "Football stadium used for festivals and big gatherings. Generic bowl layout sized for 24,000.",
    sources: [{ label: "Wikipedia", url: "https://Www.wikipedia.org/wiki/Teslim_Balogun_Stadium" }],
    plan: () => stadium("TESLIM-BALOGUN", "Teslim Balogun Stadium", 24325, "Capacity 24,325 (published)."),
  },
  {
    code: "MOBOLAJI-JOHNSON-ARENA",
    name: "Mobolaji Johnson Arena (Onikan Stadium)",
    kind: "venue",
    area: "Onikan, Lagos Island",
    capacity: "~10,000",
    dataQuality: "estimated",
    summary: "Renovated city arena used for football and social events. Generic bowl layout sized for 10,000.",
    sources: [{ label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Onikan_Stadium" }],
    plan: () => stadium("MOBOLAJI-JOHNSON-ARENA", "Mobolaji Johnson Arena", 10000, "Capacity about 10,000 (published)."),
  },

  /* ---------------------------------------------------------------- generic */
  {
    code: "GENERIC-BALLROOM",
    name: "Hotel ballroom or banquet hall",
    kind: "generic",
    capacity: "~500",
    dataQuality: "estimated",
    summary: "One ballroom with front/middle/back spots, foyer and entrance. Resize the hall to your venue.",
    sources: [],
    plan: () =>
      build({
        code: "GENERIC-BALLROOM",
        name: "Ballroom",
        city: "Lagos",
        width: 50,
        height: 40,
        notes: "Generic layout: 30 × 22 m ballroom (~500 banquet). Resize to your venue.",
        sections: [{ code: "A", name: "Ballroom", color: "#E8553B" }],
        areas: [
          { code: "BALL", name: "Ballroom", section: "A", level: 0, kind: "hall", shape: rect(5, 4, 30, 22), capacity: 500 },
          { code: "FOYER", name: "Foyer", section: "A", level: 0, kind: "lobby", shape: rect(5, 28, 40, 8) },
        ],
        spots: [
          ["BALL", "Ballroom · front", 20, 8],
          ["BALL", "Ballroom · middle", 20, 15],
          ["BALL", "Ballroom · back", 20, 23],
          ["FOYER", "Foyer", 25, 32],
        ],
        markers: [{ kind: "entrance", label: "Entrance", level: 0, x: 25, y: 36 }],
      }),
  },
  {
    code: "GENERIC-EXPO",
    name: "Exhibition hall",
    kind: "generic",
    capacity: "~100 booths",
    dataQuality: "estimated",
    summary: "Expo floor split into four zones, food court and registration foyer.",
    sources: [],
    plan: () =>
      build({
        code: "GENERIC-EXPO",
        name: "Exhibition hall",
        city: "Lagos",
        width: 100,
        height: 70,
        notes: "Generic layout: 80 × 45 m expo floor in four zones (~100 booths at ~9 m² plus aisles).",
        sections: [{ code: "X", name: "Expo", color: "#1E5BFF" }],
        areas: [
          { code: "ZONEA", name: "Zone A", section: "X", level: 0, kind: "exhibition", shape: rect(5, 5, 40, 22) },
          { code: "ZONEB", name: "Zone B", section: "X", level: 0, kind: "exhibition", shape: rect(45, 5, 40, 22) },
          { code: "ZONEC", name: "Zone C", section: "X", level: 0, kind: "exhibition", shape: rect(5, 27, 40, 23) },
          { code: "ZONED", name: "Zone D", section: "X", level: 0, kind: "exhibition", shape: rect(45, 27, 40, 23) },
          { code: "FOOD", name: "Food court", section: "X", level: 0, kind: "food", shape: rect(87, 5, 10, 45) },
          { code: "FOYER", name: "Registration foyer", section: "X", level: 0, kind: "lobby", shape: rect(5, 53, 92, 12) },
        ],
        spots: [
          ["ZONEA", "Zone A · centre aisle", 25, 16],
          ["ZONEB", "Zone B · centre aisle", 65, 16],
          ["ZONEC", "Zone C · centre aisle", 25, 38],
          ["ZONED", "Zone D · centre aisle", 65, 38],
          ["FOOD", "Food court seating", 92, 27],
          ["FOYER", "Registration foyer", 50, 59],
        ],
        markers: [
          { kind: "entrance", label: "Main entrance", level: 0, x: 50, y: 65 },
          { kind: "ops_desk", label: "Layovr ops desk", level: 0, x: 80, y: 60 },
        ],
      }),
  },
  {
    code: "GENERIC-STADIUM",
    name: "Stadium or bowl",
    kind: "generic",
    capacity: "~20,000",
    dataQuality: "estimated",
    summary: "Pitch with four stands as ring slices. Good for stadium concerts and festivals.",
    sources: [],
    plan: () => stadium("GENERIC-STADIUM", "Stadium", 20000, "Generic bowl for ~20,000."),
  },
  {
    code: "GENERIC-FESTIVAL",
    name: "Open-air festival grounds",
    kind: "generic",
    capacity: "~5,000 standing",
    dataQuality: "estimated",
    summary: "Main stage field, food village, VIP enclosure (restricted), chill zone and entrance plaza.",
    sources: [],
    plan: () =>
      build({
        code: "GENERIC-FESTIVAL",
        name: "Festival grounds",
        city: "Lagos",
        width: 160,
        height: 110,
        notes: "Generic open-air layout. Stage field sized for ~5,000 standing (~0.5 m²/person plus circulation).",
        sections: [
          { code: "F", name: "Festival", color: "#FF7A00" },
          { code: "V", name: "VIP", color: "#8E24AA" },
        ],
        areas: [
          { code: "STAGE", name: "Main stage field", section: "F", level: 0, kind: "outdoor", shape: rect(10, 10, 80, 55), capacity: 5000 },
          { code: "FOOD", name: "Food village", section: "F", level: 0, kind: "food", shape: rect(95, 10, 55, 35) },
          { code: "CHILL", name: "Chill zone", section: "F", level: 0, kind: "outdoor", shape: rect(95, 50, 55, 25) },
          { code: "VIP", name: "VIP enclosure", section: "V", level: 0, kind: "lounge", shape: rect(10, 70, 40, 25), access: "restricted" },
          { code: "PLAZA", name: "Entrance plaza", section: "F", level: 0, kind: "lobby", shape: rect(55, 80, 95, 20) },
        ],
        spots: [
          ["STAGE", "Stage field · front left", 30, 25],
          ["STAGE", "Stage field · front right", 70, 25],
          ["STAGE", "Stage field · back", 50, 55],
          ["FOOD", "Food village · seating", 122, 27],
          ["CHILL", "Chill zone", 122, 62],
          ["VIP", "VIP enclosure", 30, 82],
          ["PLAZA", "Entrance plaza", 100, 90],
        ],
        markers: [
          { kind: "entrance", label: "Main gate", level: 0, x: 100, y: 100 },
          { kind: "ops_desk", label: "Layovr ops desk", level: 0, x: 130, y: 90 },
          { kind: "toilet", label: "Toilets", level: 0, x: 92, y: 70 },
          { kind: "first_aid", label: "First aid", level: 0, x: 60, y: 76 },
        ],
      }),
  },
];

export function venueTemplate(code: string): VenueTemplate | undefined {
  return VENUE_LIBRARY.find((t) => t.code === code.toUpperCase());
}
