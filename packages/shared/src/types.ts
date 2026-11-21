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
  /** Canvas, levels, sections, markers and seat blocks from the venue's layovr-plan file. */
  plan?: PlanMeta;
  /** Whether guests can ask to change seats: off, reviewed by organisers, or approved automatically when free and the same ticket type. */
  seatChanges?: SeatChanges;
};

export type SeatChanges = "off" | "review" | "auto";

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
  /** A cart or hawker that moves around; can share a live position. */
  mobile: boolean;
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
export type LocateMethod = "qr" | "map" | "gps" | "list" | "seat";

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

/**
 * Where a buyer is right now, when they chose to share it for an order.
 * Sent only to that order's runner and to dispatch/admin. Deleted when the order closes.
 */
export type BuyerPosition = {
  orderId: string;
  x?: number;
  y?: number;
  level?: number;
  accuracyM: number;
  updatedAt: string;
};

/**
 * A mobile vendor's live position (public). Only fresh (2 min), accurate
 * (100 m) fixes are sent, and only while the vendor is open.
 */
export type VendorPosition = {
  vendorId: string;
  x: number;
  y: number;
  updatedAt: string;
};

/* ------------------------------------------------------------------ seats and tickets */

/** A seat as tickets name it. */
export type SeatRef = { block: string; row: string; seat: number };

export type SeatRequestStatus = "pending" | "approved" | "declined" | "cancelled";
/** A specific seat, anywhere in a block, or next to the guest's friend group. */
export type SeatRequestWant = "seat" | "block" | "friends";

export type SeatRequest = {
  id: string;
  venueId: string;
  ticketId: string;
  want: SeatRequestWant;
  wantBlock?: string;
  wantRow?: string;
  wantSeat?: number;
  note?: string;
  status: SeatRequestStatus;
  /** The seat when the request was made. */
  from: SeatRef;
  /** The new seat, once approved. */
  to?: SeatRef;
  decisionNote?: string;
  createdAt: string;
  decidedAt?: string;
  /** Organiser and staff views only. */
  guestName?: string;
  ticketNumber?: string;
  tier?: string;
  /** Organiser and staff views only: friends' seats, for "sit with my friends". */
  friends?: SeatRef[];
  /** Organiser and staff views only: a free seat that fits the request, if there is one. */
  suggestion?: SeatRef;
};

/** Someone in a guest's friend group. Exact seats only when that friend chose to share them. */
export type FriendSeat = {
  firstName: string;
  block: string;
  row?: string;
  seat?: number;
  checkedIn: boolean;
  isMe: boolean;
};

/** A ticket as its holder sees it (by the unguessable id saved on their phone). */
export type GuestTicket = {
  id: string;
  venueId: string;
  ticketNumber: string;
  firstName: string;
  tier?: string;
  seat: SeatRef;
  checkedInAt?: string;
  /** Entrance the ticket was scanned at. */
  gate?: string;
  /** Show my exact seat to my friend group. */
  shareSeat: boolean;
  group?: { code: string; name: string; members: FriendSeat[] };
  requests: SeatRequest[];
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

export type StaffRole = "admin" | "dispatch" | "runner" | "capture" | "vendor";

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
  /** Vendor staff: the stall or cart they work for. */
  vendorId?: string;
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
  /** The runner of an order (their own active orders) and dispatch/admin only. */
  buyerPositions: BuyerPosition[];
  /** Mobile vendors that are open and sharing. Public. */
  vendorPositions: VendorPosition[];
  /** The caller's own tickets (by the ids saved on this phone). */
  tickets: GuestTicket[];
  /** Admin and dispatch only: seat change requests at their venue. */
  seatRequests: SeatRequest[];
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
  /** "Block C · Row F · Seat 106" when ordering to a ticket's seat; prefills the landmark note. */
  seatNote?: string;
  myOrderIds: string[];
  /** Tickets this phone looked up (unguessable ids). */
  myTicketIds?: string[];
  ageConfirmed?: boolean;
};
