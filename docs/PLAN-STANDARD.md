# Mapping a venue for Layovr (layovr-plan/1)

A Layovr plan is a single file that describes a building the way a visitor
experiences it: which floors there are, which halls and lounges sit where, where
each QR code is stuck, and which doors are open. Runners use it to find buyers;
dispatch uses it to see where orders are; organisers get a crowd map from it.

You don't need an architect's drawing. A photo of the venue's own signage and a
walk around the building are enough. The Moonshot plan in
[`templates/moonshot-national-theatre.plan.json`](templates/moonshot-national-theatre.plan.json)
was made exactly that way.

- Start from [`templates/venue-plan.template.json`](templates/venue-plan.template.json)
  (also downloadable from Admin → Floor plan → "⬇ Blank template").
- Upload it in Admin → Floor plan → "Upload a plan file". Layovr checks it first
  and lists anything wrong in plain words; nothing changes until you press **Apply**.
- Upload again whenever you change something. Areas and spots are matched by
  their codes and updated in place. Nothing is ever deleted by an upload.

## The five things a plan contains

| Part | What it is | Moonshot example |
| --- | --- | --- |
| **Levels** | The floors | 0 Ground floor … 6 Sixth floor |
| **Sections** | The big signposted parts of the building | Zone A, Zone B, Zone D |
| **Areas** | Rooms and spaces an order can be delivered to | Exhibition Hall 1, Banquet, Prime Lounge |
| **Spots** | Where a QR card is stuck: the delivery address | `B0-EXH1-1` "Exhibition Hall 1 · front" |
| **Markers** | Doors, stairs, lifts, the ops desk | "Zone C entrance", blocked |

## Step by step

### 1. Collect what the venue already shows

Photograph the "You are here" boards, floor signs and the event map. Write down:
the names of halls and rooms, which floor each is on, and the venue's own
location codes if it has them (Moonshot's signs used "B2 = Zone B, second floor").
**Always reuse the venue's own names and codes.** Visitors and staff already know them.

### 2. Draw the canvas

The canvas is a box you draw the building in. Pick a size and stick to it:

- If you know real distances, use metres (`"unit": "m"`, e.g. 180 × 120).
- If not, use `"unit": "units"` with 100 across. Moonshot uses 100 × 100.
- `0, 0` is the **top-left** corner. `x` grows to the right, `y` grows downwards.
- Draw the building the same way up as the venue's main map, so staff can compare
  them. If you know where north is, set `"north"` to its angle (0 = north is up).

### 3. Levels

`0` is the ground floor (the floor you enter from the street), `1` is the first
floor up, `-1` is the first basement. This matches how floors are numbered in
Nigeria and the UK. Give each level a plain name.

### 4. Sections

Sections are the large signposted parts: wings, zones, terminals, piers, blocks.
Give each a short code (1–6 letters/numbers) and, if the venue uses colours on
its signs, the same colour as a hex code (`"#E8553B"`). Areas in that section
are drawn in that colour.

### 5. Areas

One entry per room or space where someone might order. For each:

| Field | Meaning |
| --- | --- |
| `code` | Short and unique, capitals: `EXH1`, `BANQ`, `GATE12` |
| `name` | What the sign says: "Exhibition Hall 1" |
| `section` | Which section it's in (optional) |
| `level` | Which floor. **Leave it out** for spaces that span every floor, like a stadium bowl or atrium |
| `kind` | One of the kinds below |
| `access` | `open`, or `restricted` (VIP, backstage, airside). Only runners with access get restricted orders |
| `shape` | Its outline (see Shapes) |
| `capacity` | Seats or people, if known. Used to decide how many spots it needs |
| `approximate` | `true` if you're guessing where it is. It shows dashed until someone checks on site |
| `notes` | Anything useful: stage names, opening times |

Area kinds: `hall` (auditorium, stage room), `exhibition`, `meeting` (workshop,
deal room), `lounge` (VIP), `food` (food court, lunch area), `lobby` (entrance,
foyer, corridor), `outdoor` (forecourt, garden), `gate` (airport gate),
`retail` (shop), `service` (toilets, first aid, storage), `seating` (a block
of seats inside a hall).

### 6. Shapes

Pick the simplest shape that matches the room. Everything is in canvas units.

| Shape | Use it for | Fields |
| --- | --- | --- |
| `rect` | Most rooms | `x`, `y` (top-left corner), `w` (width), `h` (height) |
| `circle` | Round halls, bowls | `cx`, `cy` (centre), `r` (radius) |
| `sector` | A slice of a ring: stadiums, round theatres, round terminals | `cx`, `cy` (centre of the building), `r0` (inner edge, 0 for a pie slice), `r1` (outer edge), `a0`, `a1` (start and end angle) |
| `polygon` | Anything irregular | `points`: a list of `[x, y]` corners, in order |

Angles are in degrees, measured **clockwise from 12 o'clock**: 0 = top,
90 = right, 180 = bottom, 270 = left. A sector may cross 12 o'clock
(`"a0": 345, "a1": 375`).

The National Theatre is round, so Moonshot uses sectors: the Main Bowl is a circle
of radius 15 in the middle, the halls sit in a ring between radius 18 and 30,
and the wing entrances stick out between 31 and 47.

### 7. Spots

A spot is one QR card. It is the address runners walk to, so be specific.

**Code format:** `<section><level>-<area>-<number>`, e.g. `B0-EXH1-1`.
Anyone can read where it is from the code alone: Zone B, ground floor,
Exhibition Hall 1, card 1. For areas with no section or level, use the area and
a number (`BOWL-1`). Admin suggests the next free code when you click the plan.

| Field | Meaning |
| --- | --- |
| `area` | The area code it's in. The point must be inside that area's shape |
| `label` | What buyers and runners see: "Exhibition Hall 1 · front · B0" |
| `x`, `y` | Where it is on the canvas |
| `landmark` | Optional: "by the blue pillar" |
| `directions` | How a runner gets there from the ops desk or main entrance: "Zone B entrance → turn right → Exhibition Hall 1" |
| `active` | Set `false` to switch a card off without losing its history |

**How many spots:**

- Seated halls: one per 30–50 seats, and at least one near each door.
- Lobbies and food courts: one per seating cluster or every 15–20 metres.
- Every area people order from needs at least one. Layovr warns you about areas with none.
- Put cards where people stay (seats, tables, pillars by queues), not where they walk past.

### 8. Markers

Markers help runners navigate and let ops close routes on the day.

`entrance`, `stairs`, `lift`, `escalator`, `ops_desk`, `toilet`, `first_aid`,
`security`, `info`. Set `"status": "blocked"` on an entrance that is closed
(Moonshot's Zone C), with a `note` saying why. Leave `level` out for things
that connect every floor, like stairs.

### 9. Placing the plan on the real map (GPS)

This lets buyers press "Use my location" and lets dispatch see runners on the
plan. It needs two or more **control points**: places you can find both on the
plan and on the ground.

The easy way is on site, with a phone: Admin → Floor plan → **Link the plan to
GPS**. Stand at a recognisable place (a door, a stair, the middle of an
entrance), tap **I'm here**, then click that place on the plan. Repeat at two to
four places at least 20 m apart, as far apart as possible, then **Save**. Layovr
shows how far each point is off; anything over about 10 m is worth redoing.
GPS is best outdoors and by doors, so pick points there.

In the file it looks like this (`approximate: true` means nobody has calibrated
on site yet):

```json
"canvas": {
  "width": 100, "height": 100, "unit": "units",
  "geo": {
    "points": [
      { "x": 50, "y": 50, "lat": 6.47639, "lng": 3.36944 },
      { "x": 50, "y": 3,  "lat": 6.47702, "lng": 3.36944 }
    ],
    "approximate": true
  }
}
```

The plan is assumed to be drawn to scale. If it isn't (like the Moonshot
schematic), GPS suggestions are rougher, and buyers can always tap the map instead.

## Checks Layovr runs on upload

**Errors** (must be fixed before applying): missing or duplicate codes, an area
on a level that isn't listed, a spot pointing at an area that doesn't exist,
shapes with missing numbers, a file made for a different venue.

**Warnings** (apply anyway, but check them): a spot drawn outside its area, a
spot code that doesn't follow the format, an area with no spots, anything
outside the canvas, every `approximate` area, and GPS points that are
approximate or disagree by more than 25 m. GPS points that sit on top of each
other are an error.

## On the site walk

1. Print the plan from Admin and walk every floor with it.
2. For each `approximate` area, confirm where it is, fix the shape, and remove
   `"approximate": true`.
3. Stand where each card will go and check the label and directions make sense.
4. Time the walk from the ops desk to each area. These become ETA buffers.
5. Mark blocked doors and restricted areas. Ask the organiser who may enter each one.
6. Download the plan, make the changes, upload it again.

## For developers

The format is defined in `packages/shared/src/plan.ts` (`planSchema` plus
`checkPlan()` for the cross-field rules). The API exposes it at
`GET /api/admin/plan` (export) and `POST /api/admin/plan[?dryRun=1]` (check or
apply). Areas are stored as `zones`, spots as `spots`; canvas, levels, sections
and markers are stored on `venues.plan`.
