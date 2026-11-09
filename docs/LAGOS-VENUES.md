# Lagos event venues: what's published, and our starting plans

Nov 6, 2026 · research for the venue library (`packages/shared/src/plans/library.ts`)

When a planner creates an event, they can start from one of these plans
instead of drawing from scratch, then edit their own copy in the dashboard.
This page records what we found online for each venue, so anyone improving a
template knows how much of it is measured and how much is estimated.

**Short version:** only **Landmark Centre** publishes hall dimensions online.
Every other venue publishes capacities and, at best, a total floor area. Floor
plans exist but are sent on request by the venues' events teams. Ask for them
when booking, then trace them in the dashboard (Venue plan → Tracing image).

## Venues

| Venue | Area | Published size / capacity | Plan online? | Our template | Quality |
| --- | --- | --- | --- | --- | --- |
| National Theatre (Wole Soyinka Centre) | Iganmu | Main Bowl ~5,000; round building, zones A–D, 7 floors | Event signage only | `NATIONAL-THEATRE` | Schematic, drawn from Moonshot 2026 signage |
| Landmark Centre | Oniru, Victoria Island | Main hall ABC **36.3 × 57.0 m** (2,230 m², 14 m high); Halls A+B 1,469 m²; Hall 2 1,452 m²; meeting rooms 520 m²; mezzanine 178 m²; 10–2,500 guests | **Yes**: dimensions on landmarklagos.com/floor-plans | `LANDMARK-CENTRE` | Measured (main hall); Hall 2, meeting rooms and foyer positions estimated |
| Eko Convention Centre (Eko Hotels & Suites) | Victoria Island | 5,151 m², divisible into 5 sections, ~270 booths, up to 3,000 dinner/conference; Eko Expo Centre 5,000+ seats | No (area only) | `EKO-CONVENTION` | Estimated |
| Balmoral Convention Centre (Federal Palace Hotel) | Victoria Island | 2,100 m² expandable to 5,000 m²; theatre 3,500–4,000, banquet 1,500–2,500; Federal Palace external ballroom 34 × 25 m (840 m²) | No | `BALMORAL-FPH` | Estimated (ballroom measured) |
| Harbour Point | Victoria Island | Hall A ~1,000 banquet; Hall B ~1,500; board & seminar rooms | No (plans on request) | `HARBOUR-POINT` | Estimated |
| The Civic Centre | Victoria Island | Grand Banquet Hall 500 seated / 550 banquet / 1,000 standing or theatre | No | `CIVIC-CENTRE` | Estimated |
| MUSON Centre | Onikan | Shell Nigeria Hall 1,000 seats; Agip Recital Hall ~144.5 × 62.4 ft (≈44 × 19 m), 258–340 seats | No | `MUSON-CENTRE` | Estimated (Agip hall measured from a listing) |
| Lagos Oriental Hotel | Lekki | 1,061 m² across 4 function rooms | No | `LAGOS-ORIENTAL` | Estimated |
| Teslim Balogun Stadium | Surulere | 24,325 | No | `TESLIM-BALOGUN` | Generic bowl sized for capacity |
| Mobolaji Johnson Arena (Onikan Stadium) | Lagos Island | ~10,000 | No | `MOBOLAJI-JOHNSON-ARENA` | Generic bowl sized for capacity |
| Lagos Arena | Lekki | 12,000; not open yet (opening slipped from Dec 2025) | — | not added | — |
| National Stadium | Surulere | 25,000–45,000 (sources conflict); under renovation | — | not added | — |

Generic layouts for venues not in the list: `GENERIC-BALLROOM`, `GENERIC-EXPO`,
`GENERIC-STADIUM`, `GENERIC-FESTIVAL`.

## How the estimated templates were sized

Where a venue publishes only a capacity, area ≈ capacity × a standard density:
theatre-style ≈ 0.7 m² per person, banquet ≈ 1.3, standing ≈ 0.5, exhibition
≈ 9 m² per booth plus aisles. Every guessed shape is marked `approximate`, so
it shows dashed in the editor and appears in the plan's "things to check" until
someone confirms it on a site walk.

Coordinates are included only where a source gives the venue's position
(National Theatre, Eko Hotels, Federal Palace, MUSON). For the others, the event
location the planner picks puts the plan on the map; it stays approximate until
calibrated on site (Venue plan → Link the plan to GPS).

## Improving a template

1. Get the venue's floor plan (ask their events team) or measure on a site walk.
2. Create an event from the template, upload the floor plan as the tracing image, and adjust the shapes in the editor.
3. Download the plan file and copy the shapes back into `packages/shared/src/plans/library.ts`; change `dataQuality` to `measured` and add the source.
4. `npm test` checks every template against the plan standard.

## Sources

- Landmark Centre: [floor plans](https://landmarklagos.com/floor-plans/), [about](https://landmarklagos.com/about-us/), [Nairametrics venue costs](https://nairametrics.com/2025/10/11/lagos-event-venues-top-8-most-expensive-corporate-spaces-in-2025/), [Hire Space](https://hirespace.com/Venues/Lagos/104930/Landmark-Events-Centre), [10times](https://10times.com/venues/landmark-events-centre)
- Eko Convention Centre: [Eko Hotels](https://ekohotels.com/eko-convention-center.php), [2exhibitions](https://www.2exhibitions.com/venue/eko-convention-centre/), [ITB Expo Centre](https://www.itbng.com/eko-expo-exhibition-centre/), [Wikipedia (coordinates)](https://en.wikipedia.org/wiki/Eko_Hotels_and_Suites)
- Balmoral / Federal Palace: [Balmoral](https://balmoral.com.ng/why-us/balmoral-convention-centre-vi/), [2exhibitions](https://www.2exhibitions.com/venue/balmoral-convention-center/), [10times Federal Palace](https://10times.com/venues/federal-palace-hotel), [Wikipedia (coordinates)](https://www.Wikipedia.com/wiki/Federal_Palace_Hotel)
- Harbour Point: [Lagos Arena guide](https://lagosarenaguide.com/victoria-island/venue/harbour-point-centre-1285/), [Events Nigeria](https://venue.eventsnigeria.com/venue/harbour-point-hall/), [Spacebook](https://spacebook.ng/space/harbour-point-142)
- The Civic Centre: [Cvent](https://www.cvent.com/venues/en-US/lagos/convention-center/the-civic-center/venue-3d7dfaa6-6e97-4a5c-a526-3ca1e465c4c1), [Venue Compass](https://www.venuecompass.com/venue/the-civic-centre-the-grand-banquet-hall-victoria-island-lagos-193)
- MUSON Centre: [Wikipedia](https://en.wikipedia.org/wiki/Muson_Centre), [Cvent](https://www.cvent.com/venues/lagos/entertainment-venue/the-muson-centre/venue-b8e37cab-ec45-4050-a40c-c9366aad748d), [Elite Planners price guide](https://eliteplanners.ng/blog/lagos-event-center-prices-2026), [AroundUs (coordinates)](https://aroundus.com/p/8616129-muson-centre)
- Lagos Oriental Hotel: [venue listing](https://www.amimagazine.global/Meeting-Event-Venues/Victoria-Island-Nigeria/Convention-Hotel/Lagos-Oriental-Hotel-Lekki-p58011914)
- Stadiums: [Teslim Balogun Stadium](https://Www.wikipedia.org/wiki/Teslim_Balogun_Stadium), [Onikan Stadium](https://en.wikipedia.org/wiki/Onikan_Stadium), [Lagos Arena](https://en.wikipedia.org/wiki/Lagos_Arena), [National Stadium renovation](https://www.nigeriahousingmarket.com/guides/lagos-national-stadium-renovation-updates-2026)
- Lists: [PrivateProperty top 10](https://privateproperty.ng/news/top-10-popular-event-centers-in-lagos/), [PropertyPro top 5](https://propertypro.ng/blog/5-top-event-centres-in-lagos/), [Top 15 largest event centres](https://www.top5.ng/top-15-largest-event-centers-in-lagos-with-over-1000-capacity/)
