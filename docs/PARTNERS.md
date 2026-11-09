# Running Layovr at your event

A guide for event planners and venue teams. Everything here happens in the
partner dashboard (`/dashboard`); platforms can do the same through the API or
MCP (`/developers`).

## 1. Create your account

Go to **/dashboard/signup**: your name, organisation, work email and a password.

## 2. Create the event (about 5 minutes)

**/dashboard → New event** walks you through five steps:

1. **Event:** name, dates, and an event code (made from the name if you leave it blank). Staff type the code to sign in.
2. **Location:** search for the venue (Google Places, or OpenStreetMap when Google isn't set up) or type the address and coordinates. This puts your map on GPS so buyers can tap "Use my location".
3. **Venue plan:** start from a Lagos venue in our library (Landmark Centre, Eko Convention Centre, National Theatre, Balmoral, MUSON…), a generic layout (ballroom, expo hall, stadium, festival grounds), a plan file you already have, or a blank plan. See [LAGOS-VENUES.md](LAGOS-VENUES.md) for how accurate each one is.
4. **Deliveries:** bring your own runners, or ask Layovr to handle deliveries (say how many runners you need; our team confirms).
5. **Review** and create. The event starts as a draft that buyers can't see.

## 3. Get the map right (Venue plan tab)

- **Draw area** (drag) for halls and rooms; **Draw shape** (click the corners) for odd shapes; **Round venue? Add a ring slice** for stadiums and round theatres.
- **Add spot** inside an area for every QR card you'll print. Codes follow the standard, e.g. `M0-HALLA-2`.
- **Add marker** for entrances, stairs, lifts and the ops desk. Tick **Blocked** on doors that are closed, with a reason runners will see.
- Mark VIP or backstage areas **Restricted**: only runners with access get those orders.
- Upload the venue's floor plan as a **tracing image** and draw over it.
- On site, **Link the plan to GPS** at two or more doors so locations are accurate.
- **Save plan**. Anything still wrong is listed under "things to check". The full format is in [PLAN-STANDARD.md](PLAN-STANDARD.md).

## 4. Vendors (Vendors tab)

Add each vendor, then send them an **invite link** (copy it or share on
WhatsApp). They open it on their phone and fill in their own stall location and
menu. The link works once and lasts 7 days. You can also add items yourself,
open or close a stall, and mark items out of stock.

## 5. Your team (Staff tab)

Add your **dispatcher** (runs the ops board), **runners**, any **on-site admin**
and **menu capture** staff. Each gets a 6-digit PIN, shown once, with a ready
WhatsApp message. They sign in at **/staff** with your event code and PIN. Give
runners a float (their budget for buying at stalls) and 🔑 access if they may
enter restricted areas.

If you asked Layovr to handle deliveries, our runners appear here marked
**Layovr** once approved.

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
