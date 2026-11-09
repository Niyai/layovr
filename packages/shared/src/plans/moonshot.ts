import { PLAN_STANDARD, polar, type VenuePlanInput } from "../plan";

/**
 * Moonshot 2026 by TechCabal at the National Theatre, Iganmu, Lagos.
 *
 * Transcribed from the event's venue signage (Oct 2026): the "Moonshot venue map"
 * board, the "Zone B, Ground Floor" sign and the "You are at B2" totem.
 * - The building is round: the Main Bowl in the middle, a ring of halls around it,
 *   and wings A–D sticking out. Moonshot used zones A, B and D on floors 0–6.
 * - Location codes follow the signage: zone letter + floor number (B0 = Zone B, ground floor).
 * - Orientation matches the event map board: B at the top, D at the bottom, A on the left.
 *   (The ground-floor wall sign is drawn the other way up.)
 * - Ground-floor halls are placed from the drawings. Rooms on upper floors (Deal Room,
 *   Grey Exhibition, Roundtable, Prime Lounge, Exhibition 3, Mixer) only appear in the
 *   board's list, so they are placed in their wing on their floor and marked approximate.
 * Canvas units are not to scale.
 */

const C = 50; // centre of the Main Bowl
const at = (angle: number, r: number) => {
  const [x, y] = polar(C, C, r, angle);
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
};
const ring = (a0: number, a1: number, r0 = 18, r1 = 30) =>
  ({ type: "sector", cx: C, cy: C, r0, r1, a0, a1 }) as const;
const wing = (a0: number, a1: number) => ring(a0, a1, 31, 47);

// Wing centres: B = 0° (top), C = 90°, D = 180°, A = 270°.
export const moonshotPlan: VenuePlanInput = {
  standard: PLAN_STANDARD,
  venue: {
    code: "MOONSHOT",
    name: "Moonshot 2026 · National Theatre",
    city: "Iganmu, Lagos",
    type: "Event",
  },
  canvas: {
    width: 100,
    height: 100,
    unit: "units",
    north: 0,
    notes: "Schematic from event signage, not to scale. Upper-floor rooms are approximate.",
    geo: {
      // Main Bowl centre at the National Theatre's published coordinates. The second
      // point assumes the Zone B entrance faces north, about 70 m out: calibrate on site.
      points: [
        { x: 50, y: 50, lat: 6.47639, lng: 3.36944 },
        { x: 50, y: 3, lat: 6.47702, lng: 3.36944 },
      ],
      approximate: true,
    },
  },
  levels: [
    { level: 0, name: "Ground floor" },
    { level: 1, name: "First floor" },
    { level: 2, name: "Second floor" },
    { level: 3, name: "Third floor" },
    { level: 4, name: "Fourth floor" },
    { level: 5, name: "Fifth floor" },
    { level: 6, name: "Sixth floor" },
  ],
  sections: [
    { code: "A", name: "Zone A", color: "#2B2257" },
    { code: "B", name: "Zone B", color: "#E8553B" },
    { code: "D", name: "Zone D", color: "#6B3FA0" },
  ],
  areas: [
    {
      code: "BOWL",
      name: "Main Bowl",
      kind: "hall",
      shape: { type: "circle", cx: C, cy: C, r: 15 },
      capacity: 5000,
      notes:
        "Spans every floor. Enter from D5 or B5. Stages: Emerging Tech, Future of Money, Future of Commerce, Government Policy & Regulation, Creative Economy.",
    },

    // Ground floor (0)
    { code: "EXH1", name: "Exhibition Hall 1", section: "B", level: 0, kind: "exhibition", shape: ring(18, 52) },
    { code: "EXH2", name: "Exhibition Hall 2", section: "B", level: 0, kind: "exhibition", shape: ring(308, 342) },
    { code: "BANQ", name: "Banquet (lunch area)", section: "D", level: 0, kind: "food", shape: ring(200, 252) },
    { code: "CIN1", name: "Cinema Hall 1", section: "D", level: 0, kind: "hall", shape: ring(146, 163), notes: "Startup & Fuel Stage; Big Tech & Enterprise Stage" },
    { code: "CIN2", name: "Cinema Hall 2", section: "D", level: 0, kind: "hall", shape: ring(130, 146), notes: "Climate Tech Stage; Technical Workshops" },
    { code: "CIN3", name: "Cinema Hall 3", section: "D", level: 0, kind: "hall", shape: ring(114, 130), notes: "Climate Tech Stage; Technical Workshops" },
    { code: "A-LOBBY", name: "Zone A entrance", section: "A", level: 0, kind: "lobby", shape: wing(255, 285) },
    { code: "B-LOBBY", name: "Zone B entrance", section: "B", level: 0, kind: "lobby", shape: wing(345, 375) },
    { code: "D-LOBBY", name: "Zone D entrance", section: "D", level: 0, kind: "lobby", shape: wing(165, 195) },
    {
      code: "FOOD",
      name: "Food Village",
      section: "B",
      level: 0,
      kind: "outdoor",
      shape: wing(290, 342),
      notes: "Outside the building, between zones A and B.",
    },

    // Upper floors (approximate: listed on the board, not drawn)
    { code: "DEAL", name: "Deal Room", section: "D", level: 2, kind: "meeting", shape: ring(165, 195), approximate: true },
    { code: "GREY", name: "Grey Exhibition", section: "D", level: 3, kind: "exhibition", shape: ring(160, 200, 18, 47), approximate: true },
    {
      code: "RT",
      name: "Roundtable & Startup Showcase",
      section: "B",
      level: 4,
      kind: "meeting",
      shape: ring(338, 360, 18, 47),
      approximate: true,
    },
    {
      code: "PRIME",
      name: "Prime Lounge",
      section: "B",
      level: 4,
      kind: "lounge",
      access: "restricted",
      shape: ring(0, 22, 18, 47),
      approximate: true,
      notes: "VIP. Confirm which runners may enter.",
    },
    { code: "EXH3", name: "Exhibition 3", section: "B", level: 5, kind: "exhibition", shape: ring(20, 70, 16, 26), approximate: true },
    { code: "MIXER", name: "Mixer", section: "B", level: 6, kind: "food", shape: ring(340, 380, 18, 47), approximate: true },
  ],
  spots: [
    { code: "D5-BOWL-1", area: "BOWL", label: "Main Bowl · D5 entrance, left aisle", ...at(172, 11), directions: "Zone D stairs to floor 5 → Main Bowl doors → left aisle" },
    { code: "D5-BOWL-2", area: "BOWL", label: "Main Bowl · D5 entrance, right aisle", ...at(188, 11), directions: "Zone D stairs to floor 5 → Main Bowl doors → right aisle" },
    { code: "B5-BOWL-1", area: "BOWL", label: "Main Bowl · B5 entrance, left aisle", ...at(352, 11), directions: "Zone B stairs to floor 5 → Main Bowl doors → left aisle" },
    { code: "B5-BOWL-2", area: "BOWL", label: "Main Bowl · B5 entrance, right aisle", ...at(8, 11), directions: "Zone B stairs to floor 5 → Main Bowl doors → right aisle" },
    { code: "B5-BOWL-3", area: "BOWL", label: "Main Bowl · centre seating", ...at(0, 3), directions: "Enter at B5 → down the centre aisle" },

    { code: "B0-EXH1-1", area: "EXH1", label: "Exhibition Hall 1 · front · B0", ...at(35, 21), directions: "Zone B entrance → turn right → Exhibition Hall 1" },
    { code: "B0-EXH1-2", area: "EXH1", label: "Exhibition Hall 1 · back · B0", ...at(35, 27), directions: "Zone B entrance → turn right → Exhibition Hall 1, back wall" },
    { code: "B0-EXH2-1", area: "EXH2", label: "Exhibition Hall 2 · front · B0", ...at(325, 21), directions: "Zone B entrance → turn left → Exhibition Hall 2" },
    { code: "B0-EXH2-2", area: "EXH2", label: "Exhibition Hall 2 · back · B0", ...at(325, 27), directions: "Zone B entrance → turn left → Exhibition Hall 2, back wall" },

    { code: "D0-BANQ-1", area: "BANQ", label: "Banquet · lunch area, near doors · D0", ...at(226, 22), directions: "Zone D entrance → turn right → Banquet" },
    { code: "D0-BANQ-2", area: "BANQ", label: "Banquet · lunch area, far side · D0", ...at(226, 27), directions: "Zone D entrance → turn right → Banquet, far side" },
    { code: "D0-CIN1-1", area: "CIN1", label: "Cinema Hall 1 · back rows · D0", ...at(154, 24), directions: "Zone D entrance → turn left → first cinema" },
    { code: "D0-CIN2-1", area: "CIN2", label: "Cinema Hall 2 · back rows · D0", ...at(138, 24), directions: "Zone D entrance → turn left → second cinema" },
    { code: "D0-CIN3-1", area: "CIN3", label: "Cinema Hall 3 · back rows · D0", ...at(122, 24), directions: "Zone D entrance → turn left → third cinema" },

    { code: "B0-FOOD-1", area: "FOOD", label: "Food Village · seating near Zone B", ...at(330, 38), directions: "Outside, between zones A and B" },
    { code: "B0-FOOD-2", area: "FOOD", label: "Food Village · seating near Zone A", ...at(302, 40), directions: "Outside, between zones A and B, A side" },
    { code: "A0-LOBBY-1", area: "A-LOBBY", label: "Zone A entrance hall · A0", ...at(270, 38) },
    { code: "B0-LOBBY-1", area: "B-LOBBY", label: "Zone B entrance hall · B0", ...at(0, 38) },
    { code: "D0-LOBBY-1", area: "D-LOBBY", label: "Zone D entrance hall · D0", ...at(180, 38) },

    { code: "D2-DEAL-1", area: "DEAL", label: "Deal Room · D2", ...at(180, 24), directions: "Zone D stairs to floor 2" },
    { code: "D3-GREY-1", area: "GREY", label: "Grey Exhibition · D3", ...at(180, 32), directions: "Zone D stairs to floor 3" },
    { code: "B4-RT-1", area: "RT", label: "Roundtable & Startup Showcase · B4", ...at(349, 32), directions: "Zone B stairs to floor 4 → left" },
    { code: "B4-PRIME-1", area: "PRIME", label: "Prime Lounge · B4", ...at(11, 32), directions: "Zone B stairs to floor 4 → right (VIP)" },
    { code: "B5-EXH3-1", area: "EXH3", label: "Exhibition 3 · B5", ...at(45, 21), directions: "Zone B stairs to floor 5 → around the bowl to the right" },
    { code: "B6-MIXER-1", area: "MIXER", label: "Mixer · B6", ...at(0, 32), directions: "Zone B stairs to floor 6" },
  ],
  markers: [
    { kind: "entrance", label: "Zone A entrance", level: 0, ...at(270, 47) },
    { kind: "entrance", label: "Zone B entrance", level: 0, ...at(0, 47) },
    { kind: "entrance", label: "Zone D entrance", level: 0, ...at(180, 47) },
    { kind: "entrance", label: "Zone C entrance", level: 0, ...at(90, 47), status: "blocked", note: "Zone C not used by Moonshot" },
    { kind: "stairs", label: "Zone A stairs", ...at(270, 32) },
    { kind: "stairs", label: "Zone B stairs", ...at(0, 32) },
    { kind: "stairs", label: "Zone D stairs", ...at(180, 32) },
    { kind: "ops_desk", label: "Layovr ops desk (confirm on site)", level: 0, ...at(195, 42) },
  ],
};
