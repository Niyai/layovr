# Third-party services shortlist

Nov 1, 2026 · for the headless roadmap ([REQUIREMENTS.md](REQUIREMENTS.md))

Services Layovr can use for location, tracking, verification, onboarding and
platform plumbing. Open-source and low-cost options come first. Prices are
**indicative** from public pages and listings checked in Oct 2026; several
vendors don't publish rates ("quote"), and some third-party figures conflict.
Confirm with the vendor before budgeting.

**Built now, at no cost:** buyers can say where they are without scanning a
QR code (tap the map, or phone GPS), and runners share their location while on
an order. See [Finding the buyer without a QR scan](#finding-the-buyer-without-a-qr-scan).

## Finding the buyer without a QR scan

| Method | Cost | Accuracy | Status |
| --- | --- | --- | --- |
| **Tap where you are on the venue map** (floor by floor) | Free | Room / seat-block level | **Built** (LOC-1) |
| **"Use my location"**: phone GPS placed on the venue plan, nearest spot suggested, buyer confirms | Free | Good outdoors and near doors; rough inside large halls (falls back to the map above 60 m) | **Built** (LOC-2). Needs the plan linked to GPS: Admin → Floor plan → "Link the plan to GPS" |
| Pick from a list | Free | Exact | Built |
| **Seat from ticket**: the ticket's block/row/seat maps to a spot | Free with a ticketing partner | Exact | Later (LOC-5, with TIX-4) |
| **Venue Wi-Fi presence**: which access point the phone is connected to → area. Cisco Meraki / Spaces location APIs; UniFi controller client lists; open-source [wifi-ap-associations](https://pypi.org/project/wifi-ap-associations/0.13.1/) | Depends on the venue's Wi-Fi | Area level | Later (LOC-4), per venue |
| **IndoorAtlas SDK** in a partner's native app (geomagnetic, no beacons, needs a venue survey) | ~€59–400/month dev, ~€349/venue/month pro (pages conflict) | Metre-level claimed | Only if a partner app needs it |

## Live location and tracking

| Need | Recommended | Cost | Notes | Alternatives |
| --- | --- | --- | --- | --- |
| Runner position while on an order | **Browser Geolocation API** in the runner web app | Free | **Built** (LOC-3). Shared only while the runner has an active order; latest position only, no history | — |
| Tracking with the phone locked | **Capacitor app + [@capgo/background-geolocation](https://capgo.app/blog/transistorsoft-background-geolocation-alternative/)** (MIT) | Free | Needed only if runners can't keep the app open | Transistorsoft (paid licence per app for release builds) |
| Fleet history, reports, GPS devices | **[Traccar](https://github.com/traccar/traccar)** (Apache-2.0, self-hosted, free [phone client](https://github.com/traccar/traccar-client)) | Free | 200+ device protocols if we add carts or vehicles | HyperTrack (~$99–119/month + usage) |
| Geofences (terminals, outdoor zones) | **Our plan geometry** (`areaAt`, `pointInShape`, `fitGeo` in packages/shared/src/plan.ts) | Free | Built | Radar (free-tier terms unclear; ~$0.02/tracked user) |
| Outdoor base map | **MapLibre GL + [Protomaps](https://protomaps.com/) PMTiles**, self-hosted | Free | One file, no per-request fees, no location data shared | Mapbox, Google (metered) |
| Realtime with more than one API server | **Postgres LISTEN/NOTIFY**, then **Centrifugo** (Apache-2.0) | Free | Replaces the in-process event bus | Soketi (AGPL, Pusher-compatible) |

## Verification and onboarding

| Need | Recommended | Cost | Notes | Alternatives |
| --- | --- | --- | --- | --- |
| Nigerian ID lookup (NIN / BVN) + selfie match for runners | **[Dojah](https://dojah.io/pricing)** | From ~$0.04–0.06 per call (list), $100 free test credit | NIN/BVN with selfie endpoints | [Smile ID](https://docs.usesmileid.com/getting-started/choose-a-product), [Prembly](https://prembly.com/pricing/), Youverify (pricing on request) |
| Liveness, face match, passports and foreign IDs (airports) | **[Didit](https://www.didit.me/pricing)** | 500 free checks/month, then ~$0.10 liveness, ~$0.05 face match | Don't use it for BVN ($0.80/call); use Dojah for that | Smile ID |
| Bank account name check before payouts | **[Paystack Resolve Account](https://paystack.com/docs/identity-verification/verify-account-number/)** | Free (Nigeria may need Paystack's approval) | Server-side only | Flutterwave account resolve |
| Phone OTP | **Termii Token** (SMS, WhatsApp, voice) | Rate card on request; market ~₦5–6.5 per SMS | Nigerian sender IDs | Africa's Talking, Twilio Verify |
| Onboarding workflow and review | **Our own statuses** (RUN-5) | Free | The flow is small | [Ballerine](https://www.github.com/ballerine-io/ballerine) (open source KYC/KYB workflows; non-standard licence, check first) |
| Background checks | Quote from Dojah / Prembly / Youverify | Quote | Airport-type venues only | — |

## Platform plumbing for the headless API

| Need | Recommended | Cost | Notes |
| --- | --- | --- | --- |
| Notifications (SMS, WhatsApp, push, in-app) | **Novu** (MIT, self-hosted; cloud free up to 10k workflow runs/month) + **Web Push (VAPID)** | Free / low | Termii as the SMS channel underneath |
| Outbound webhooks to partners (PLT-3) | **Svix server** (MIT, self-hosted) | Free | Convoy is Elastic-licensed |
| Partner OAuth 2.1 for the API and MCP (MCP-1) | **Logto** (MPL-2.0, multi-tenant, OAuth 2.1 + PKCE); Keycloak as fallback | Free self-hosted | Spike needed to confirm it meets the MCP authorization spec |
| Flight status and gates (AIR-2/3) | **AeroDataBox** | Small free tier; paid plans reportedly up to ~$150/month | OpenSky is free but has no gates or schedules |

## Recommended order

1. **Now (free, built):** map tap + GPS for buyers, runner live location. Calibrate the Moonshot plan with GPS on the next site visit.
2. **Runner onboarding (H3):** Dojah (ID) + Didit (biometrics) + Paystack resolve + Termii OTP. A few hundred naira per runner.
3. **Headless platform (H1/H2):** Novu + Web Push, Svix, Logto.
4. **Only if pilots show the need:** IndoorAtlas, Radar, HyperTrack, Transistorsoft, beacons.

## Sources

Tracking: [Traccar](https://github.com/traccar/traccar) · [Traccar download](https://www.traccar.org/download) · [Radar alternatives](https://www.woosmap.com/blog/best-alternatives-to-radar) · [Radar on APIbenchmarks](https://apibenchmarks.com/maps/radar) · [IndoorAtlas pricing](https://www.indooratlas.com/pricing/) · [IndoorAtlas SDK](https://www.indooratlas.com/solutions/indooratlas-positioning-sdk/) · [IndoorAtlas REST API](https://www.indooratlas.com/solutions/indooratlas-positioning-rest-api/) · [HyperTrack on GetApp](https://www.getapp.com/location-intelligence-software/a/hypertrack) · [HyperTrack on SaaSworthy](https://dev.saasworthy.com/product/hypertrack) · [Capgo vs Transistorsoft](https://capgo.app/blog/transistorsoft-background-geolocation-alternative/) · [Capawesome vs Transistorsoft](https://capawesome.io/blog/alternative-to-transistorsoft-background-geolocation/) · [Protomaps](https://protomaps.com/) · [Supabase + Protomaps](https://supabase.com/blog/self-host-maps-storage-protomaps.md) · [Centrifugo vs Soketi](https://www.pistack.xyz/posts/centrifugo-vs-mercure-vs-soketi-self-hosted-websocket-push-server-2026/) · [Cisco indoor location](https://blogs.cisco.com/developer/location-services-inside-buildings) · [wifi-ap-associations](https://pypi.org/project/wifi-ap-associations/0.13.1/)

Verification: [Dojah pricing](https://dojah.io/pricing) · [Dojah BVN/NIN selfie](https://docs.dojah.io/api-reference/individual-verification/nigeria/bvn-nin-selfie) · [Prembly pricing](https://prembly.com/pricing/) · [Who publishes prices (Ninja)](https://www.ninja.ng/blog/dojah-prembly-youverify-ninja-pricing/) · [Didit pricing](https://www.didit.me/pricing) · [Didit docs pricing](https://docs.didit.me/getting-started/pricing.md) · [Smile ID products](https://docs.usesmileid.com/getting-started/choose-a-product) · [Paystack verify account](https://paystack.com/docs/identity-verification/verify-account-number/) · [Ballerine](https://www.github.com/ballerine-io/ballerine) · [Termii pricing (third party)](https://zoftwarehub.com/products/termii/pricing) · [Nigeria SMS API comparison](https://martechafrica.com/blog/best-sms-api-providers-in-nigeria-for-2026-pricing-features-and-support-compared/)

Plumbing: [Novu pricing](https://novu.co/pricing.md) · [Novu pricing teardown](https://dev.to/beton/novu-pricing-teardown-2026-2oag) · [Svix vs Convoy](https://www.svix.com/vs/svix-dispatch-vs-convoy/) · [Open-source webhook tools](https://hookdeck.com/webhooks/platforms/best-open-source-webhook-tools.md) · [Logto vs Ory vs Keycloak](https://www.pkgpulse.com/guides/logto-vs-ory-vs-keycloak-open-source-identity-providers-2026) · [Flight data APIs](https://geekflare.com/guides/flight-data-api/) · [AeroDataBox](https://apis.io/providers/aerodatabox/)

Venue: [National Theatre coordinates](https://akarinohon.com/text/taketori.cgi/en.wikipedia.org/wiki/National_Arts_Theatre)
