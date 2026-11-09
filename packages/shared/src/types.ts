import type { AreaKind, PlanMeta, Shape } from "./plan";

/**
 * Domain types for the Layovr prototype.
 * Shared by the web app and the API. They mirror the tables in
 * apps/api/src/db/migrations (camelCase here, snake_case in Postgres).
 * Money is always integer kobo (₦1 = 100 kobo).
 */

export type VenueType =
  "Event" | "Mall" | "Campus" | "Neighbourhood" | "Airport" | "Office";

export type Venue = {
  id: string;
  code: string; // short code used in URLs, e.g. MOONSHOT
  name: string;
  city: string;
  type: VenueType;
  fill: Fill; // card colour on the Explore page
  isLive: boolean;
  feePct: number; // e.g. 0.04 = 4% of subtotal
  feeFlatKobo: number;
  absorbLimitKobo: number; // price gap we cover without calling the buyer
  floorPlanUrl?: string; // traced image drawn under the plan shapes
  isSample: boolean;
  /** Canvas, levels, sections and markers from the venue's layovr-plan file. */
  plan?: PlanMeta;
};

/** An area of a venue plan (a hall, lounge, food court, gate…). Orders are routed by zone. */
export type Zone = {
  id: string;
  venueId: string;
  /** Short code from the plan, e.g. EXH1. */
  code: string;
  name: string;
  restricted: boolean;
  /** Outline in plan canvas units. */
  shape: Shape;
  kind: AreaKind;
  /** Signposted part of the building, e.g. "B" for Zone B. */
  section?: string;
  /** Floor number; absent when the area spans every floor. */
  level?: number;
  approximate?: boolean;
  notes?: string;
};

export type Spot = {
  id: string;
  venueId: string;
  zoneId: string;
  code: string; // goes in the QR URL: /s/<code>
  label: string; // "Main Bowl, centre block, row F aisle"
  x: number; // % across the floor plan
  y: number; // % down the floor plan
  landmark?: string;
  /** Walking directions for runners, from the ops desk. */
  directions?: string;
  active: boolean;
};

export type Fulfilment = "deliver" | "collect_and_return" | "reserve_slot";

export type Vendor = {
  id: string;
  venueId: string;
  name: string;
  emoji: string;
  category: string;
  description: string;
  zoneId?: string;
  stallLabel: string;
  isOpen: boolean;
  prepMinutes: number;
  fill: Fill;
};

export type Product = {
  id: string;
  vendorId: string;
  category: string;
  kind: "goods" | "service";
  name: string;
  description?: string;
  priceKobo: number;
  priceCheckedAt: string; // ISO date the price was last confirmed at the stall
  imageUrl?: string;
  inStock: boolean;
  fulfilment: Fulfilment;
  durationMin?: number;
  ageRestricted?: boolean;
};

export type OrderStatus =
  | "awaiting_payment"
  | "paid"
  | "assigned"
  | "buying"
  | "on_the_way"
  | "delivered"
  | "not_delivered"
  | "cancelled";

export type ItemStatus = "ok" | "swapped" | "dropped";

export type OrderItem = {
  id: string;
  productId: string;
  name: string;
  unitPriceKobo: number;
  qty: number;
  status: ItemStatus;
  finalPriceKobo: number; // unit price after any change at the stall
  note?: string;
};

export type StopStatus = "pending" | "bought" | "unavailable";

export type OrderStop = {
  id: string;
  vendorId: string;
  status: StopStatus;
  items: OrderItem[];
};

export type Purchase = {
  id: string;
  orderId: string;
  stopId: string;
  runnerId: string;
  amountKobo: number;
  method: "cash" | "transfer";
  receiptUrl?: string;
  at: string;
};

export type OrderEvent = {
  at: string;
  status: OrderStatus;
  note?: string;
  by: string; // "buyer", "system", staff name
};

/** How the buyer told us where they are. */
export type LocateMethod = "qr" | "map" | "gps" | "list";

/** Where exactly the buyer is, when they tapped the map or used GPS (plan canvas units). */
export type Pinpoint = {
  method: LocateMethod;
  x?: number;
  y?: number;
  level?: number;
  accuracyM?: number;
};

/** A runner's last known position (staff only). Cleared when they have no active orders. */
export type RunnerPosition = {
  runnerId: string;
  x?: number;
  y?: number;
  accuracyM: number;
  updatedAt: string;
};

/** The colour a buyer and runner both hold up to find each other. See MATCH_SIGNALS. */
export type MatchSignal = { color: string; pattern: "solid" | "stripes" | "flash" };

export type Order = {
  id: string; // also the Flutterwave tx_ref
  code: string; // LV-7KQ2, shown to buyers and sent by SMS
  venueId: string;
  spotId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  landmark?: string;
  stops: OrderStop[];
  subtotalKobo: number;
  feeKobo: number;
  totalKobo: number;
  refundKobo: number;
  status: OrderStatus;
  runnerId?: string;
  etaAt?: string;
  /** Set when the runner says they're in the buyer's area. */
  arrivedAt?: string;
  match?: MatchSignal;
  pinpoint?: Pinpoint;
  /** Buyer view only: roughly how far the runner is, in metres, while on the way. */
  runnerDistanceM?: number;
  handoffPin: string;
  createdAt: string;
  events: OrderEvent[];
  payment?: {
    txRef: string;
    transactionId?: string;
    mode: "demo" | "flutterwave";
    amountKobo: number;
  };
};

export type StaffRole = "admin" | "dispatch" | "runner" | "capture";

export type Staff = {
  id: string;
  venueId: string;
  name: string;
  role: StaffRole;
  /** Empty for buyers; only staff see staff phone numbers. */
  phone: string;
  floatKobo: number;
  canEnterRestricted: boolean;
  onShift: boolean;
};

export type CartLine = {
  productId: string;
  qty: number;
  note?: string;
};

export type Fill = "sun" | "coral" | "lilac" | "mint" | "blush" | "card";

/** Live numbers the server computes so buyers never need other people's orders. */
export type Stats = {
  /** Open orders still waiting on each vendor (pending stops). */
  vendorActive: Record<string, number>;
  /** Runners on shift and not on an order, per venue. */
  runnersFree: Record<string, number>;
};

/**
 * Everything one screen can see, as returned by GET /api/snapshot.
 * The server scopes it: buyers get the public catalogue and their own orders;
 * staff also get the orders and purchases their role may see.
 */
export type DB = {
  venues: Venue[];
  zones: Zone[];
  spots: Spot[];
  vendors: Vendor[];
  products: Product[];
  staff: Staff[];
  orders: Order[];
  purchases: Purchase[];
  stats: Stats;
};

export type DemoAccount = { name: string; role: StaffRole; pin: string; eventCode: string };

export type Snapshot = DB & {
  me: Staff | null;
  /** Dispatch and admin only. */
  runnerPositions: RunnerPosition[];
  config: {
    paymentMode: "demo" | "flutterwave";
    allowReset: boolean;
    /** Only sent when the server runs with SHOW_DEMO_PINS=true (local dev). */
    demoAccounts: DemoAccount[];
  };
};

/** What /api/track returns: status only, never names, items or the order link. */
export type TrackResult = {
  code: string;
  status: OrderStatus;
  totalKobo: number;
  createdAt: string;
};

export type Session = {
  cart: CartLine[];
  cartVenueId?: string;
  spotId?: string;
  pinpoint?: Pinpoint;
  myOrderIds: string[];
  ageConfirmed?: boolean;
};
