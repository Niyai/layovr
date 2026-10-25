# Layovr — Moonshot prototype frontend

Built on your Lovable project (TanStack Start, React 19, Tailwind v4) in the same
visual style as layovrr.lovable.app: cream paper, ink outlines, pop shadows,
Bricolage Grotesque headings and DM Sans body text.

## Run it

From the repo root: `npm install && npm run dev` (see the root README).
Demo staff PINs are listed there and on `/staff` in dev.

## Screens

| Route                                | Who      | What                                                                     |
| ------------------------------------ | -------- | ------------------------------------------------------------------------ |
| `/`                                  | buyer    | Home                                                                     |
| `/how-it-works`, `/explore`          | buyer    | Recreated from the saved Lovable pages                                   |
| `/scan`                              | buyer    | Camera QR scan (BarcodeDetector) or type a code                          |
| `/s/$spot`                           | buyer    | **What every printed QR opens.** Sets the spot, shows that venue         |
| `/l/$code`                           | buyer    | Venue: vendors, open/closed, wait estimate, "Delivering to" spot         |
| `/vendor/$vendorId`                  | buyer    | Menu, sold-out, services, 18+ gate, sticky basket bar                    |
| `/checkout`                          | buyer    | Basket by stall, spot, name, phone, service fee, pay                     |
| `/pay/$orderId`                      | buyer    | Flutterwave return + verify; demo checkout when no keys                  |
| `/o/$orderId`                        | buyer    | Live tracking, ETA, hand-off PIN, refunds                                |
| `/track`                             | buyer    | Find an order by LV- code or phone                                       |
| `/staff`                             | staff    | PIN sign-in                                                              |
| `/ops`                               | dispatch | Live board, assign runner + ETA, late flags, chime, plan dots, floats    |
| `/runner`                            | runner   | Stops in order, log what was paid, sold out / price change, PIN hand-off |
| `/admin`                             | admin    | Spots & QR, click-to-place on floor plan, menus, plan upload, fees       |
| `/admin/print`                       | admin    | Print-ready QR cards (+ spare venue-wide cards)                          |
| `/admin/capture`                     | capture  | Record a stall's menu on a phone in ~5 minutes                           |
| `/become-a-vendor`, `/partners`, ... | anyone   | Light info pages (`src/routes/$page.tsx`)                                |

## Data

Pages read and write through `src/lib/store.ts`, which talks to the API
(`apps/api`) and refetches when the server streams a change. Only the basket,
chosen spot and the buyer's order ids are kept in the browser.

## Floor plan

The National Theatre plan is a schematic of the five known areas (Main entrance,
Main Bowl, Theatres 1–3). After the site walk, upload the real plan in
Admin → Floor plan and click to place or move spots. Each spot has runner
directions from the ops desk, shown in the runner view.
