# Running Layovr at your event

A guide for event planners and venue teams. Everything here happens in the
partner dashboard (`/dashboard`); platforms can do the same through the API or
MCP (`/developers`).

## 1. Create your account

Go to **/dashboard/signup**: your name, organisation, work email and a password.

## 2. Create the event (about 5 minutes)

**/dashboard → New event** walks you through five steps:

1. **Event:** name, dates, and an event code (made from the name if you leave it blank). Staff type the code to sign in.
2. **Location:** search for the venue (Google Places, or OpenStreetMap when Google isn't set up) or type the address and coordinates. With Google you can also **adjust the pin** on a satellite map. This puts your map on GPS so buyers can tap "Use my location".
3. **Venue plan:** start from a Lagos venue in our library (Landmark Centre, Eko Convention Centre, National Theatre, Balmoral, MUSON…), a generic layout (ballroom, expo hall, stadium, festival grounds), a plan file you already have, or a blank plan. See [LAGOS-VENUES.md](LAGOS-VENUES.md) for how accurate each one is.
4. **Deliveries:** bring your own runners, or ask Layovr to handle deliveries (say how many runners you need; our team confirms).
5. **Review** and create. The event starts as a draft that buyers can't see.

## 3. Get the map right (Venue plan tab)

- **Draw area** (drag) for halls and rooms; **Draw shape** (click the corners) for odd shapes; **Round venue? Add a ring slice** for stadiums and round theatres.
- **Add spot** inside an area for every QR card you'll print. Codes follow the standard, e.g. `M0-HALLA-2`.
- **Add marker** for entrances, stairs, lifts and the ops desk. Tick **Blocked** on doors that are closed, with a reason runners will see.
- Mark VIP or backstage areas **Restricted**: only runners with access get those orders.
- Upload the venue's floor plan as a **tracing image** and draw over it.
- **Place on map:** drag, turn and size your plan's outline until it sits on the building in the satellite view, then save. Good enough for "Use my location" and live tracking before the day.
- On site, **Link the plan to GPS** at two or more doors so locations are exact.
- **Save plan**. Anything still wrong is listed under "things to check". The full format is in [PLAN-STANDARD.md](PLAN-STANDARD.md).

## 4. Vendors (Vendors tab)

Add each vendor, then send them an **invite link** (copy it or share on
WhatsApp). They open it on their phone and fill in their own stall location and
menu. The link works once and lasts 7 days. You can also add items yourself,
open or close a stall, and mark items out of stock.

Tick **🛒 Mobile** for carts and hawkers that walk around. Add whoever runs the
cart as **Vendor staff** (Staff tab); when they sign in and tap "Start sharing",
buyers see the cart move on the event map with roughly how far away it is.

## 5. Your team (Staff tab)

Add your **dispatcher** (runs the ops board), **runners**, any **on-site admin**
and **menu capture** staff. Each gets a 6-digit PIN, shown once, with a ready
WhatsApp message. They sign in at **/staff** with your event code and PIN. Give
runners a float (their budget for buying at stalls) and 🔑 access if they may
enter restricted areas.

If you asked Layovr to handle deliveries, our runners appear here marked
**Layovr** once approved.

## Seated events (Seating tab)

- **Seat blocks:** describe each block as the venue's seating chart does (rows from the front, seats across, the door guests use). Add the doors as **portal** markers in the Venue plan tab first. Block codes must match the section or block on your tickets.
- **Tickets:** import the CSV export from your ticketing system (ticket number, block, row, seat; barcode, name, ticket type, check-in and gate are optional). Press **Check file**, then **Import**. Not ready yet? **Fill with test tickets**.
- **Check-ins:** your ticketing system or gate scanners can report them as they happen (API: `POST /api/partner/events/:id/tickets/checkin`). Guests' directions then start from the gate they came in by.
- **Guests:** they open **Find my seat** (from the event page or the QR on your gate screens), scan their ticket or type its number, and get step-by-step directions, a seat chart, friends in their group, and "Order food to my seat".
- **Seat changes:** choose Off, You decide, or Automatic (free seats with the same ticket type). Requests show here and on the **Seats** screen for your on-site admin and dispatcher, with a suggested free seat.
- **Signs:** print the seat-finder QR for gate screens, and one per entrance and portal so lost guests can restart directions where they stand.

## Live tracking

Runners share their position while on an order; buyers can choose to share
theirs ("Share my live location") so the runner walks straight to them. Only
the latest position is kept, and it's deleted when the order closes. Dispatch
sees everyone on the plan; tap **Street map** for Google's satellite view when
people are outside the plan's edge.

## 6. Publish

On **Overview**, the checklist shows what's missing. Publishing needs a plan
with spots and at least one vendor with an item. Then:

- **Print QR cards** (one per spot, plus spares that open the event page).
- Share the **buyer page** link on screens, posters or your event app.
- On the day, your dispatcher signs in and runs the ops board; runners use their phones.

## Already have an event app?

Connect it instead of (or as well as) using the dashboard. Create an API key in
**/dashboard/keys** and see **/developers** for the REST API and the MCP server.
The MCP server lets AI assistants and agent platforms set up and run your event
in plain language, with previews before anything changes.
