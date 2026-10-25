import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type {
  CartLine,
  ItemStatus,
  Order,
  Product,
  Session,
  Snapshot,
  Spot,
  Staff,
  TrackResult,
  Vendor,
  Venue,
  Zone,
} from "./types";

export {
  ACTIVE_STATUSES,
  STATUS_LABEL,
  feeFor,
  formatNaira,
  itemsTotal,
  runnerFloat,
  runnersFree,
  spotByCode,
  uid,
  vendorWait,
  venueByCode,
} from "@layovr/shared";

/**
 * CLIENT STORE
 * ------------
 * Pages read one snapshot of everything they're allowed to see (GET /api/snapshot)
 * and call the actions below, which POST to the API. The server pushes a
 * "change" event over /api/stream whenever anything is written, and every
 * open screen refetches, so phones, the ops laptop and runners stay in sync.
 *
 * Only the buyer's basket, chosen spot and order ids live in this browser.
 */

const SESSION_KEY = "layovr:session:v1";
const emptySession = (): Session => ({ cart: [], myOrderIds: [] });

const emptySnapshot: Snapshot = {
  venues: [],
  zones: [],
  spots: [],
  vendors: [],
  products: [],
  staff: [],
  orders: [],
  purchases: [],
  stats: { vendorActive: {}, runnersFree: {} },
  me: null,
  config: { paymentMode: "demo", allowReset: false, demoAccounts: [] },
};

export type Connection = "loading" | "ready" | "offline";

let snap: Snapshot = emptySnapshot;
let session: Session = emptySession();
let connection: Connection = "loading";
let started = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/* ------------------------------------------------------------------ api */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers:
        init.body === undefined ? {} : { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new ApiError(0, "No connection. Check your data and try again.");
  }
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      json?.error ?? "Something went wrong. Please try again.",
    );
  }
  return json as T;
}

/** Runs a write, shows any error as a toast, then refreshes. Returns false on failure. */
async function act(path: string, body: unknown = {}, method = "POST") {
  try {
    await api(path, { method, body });
    return true;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    void refresh();
  }
}

/* ------------------------------------------------------------ live sync */

let inFlight: Promise<void> | null = null;
let again = false;

export function refresh(): Promise<void> {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      const ids = session.myOrderIds.join(",");
      snap = await api<Snapshot>(`/snapshot${ids ? `?orders=${ids}` : ""}`);
      connection = "ready";
    } catch {
      if (connection !== "ready") connection = "offline";
    } finally {
      inFlight = null;
      emit();
      if (again) {
        again = false;
        void refresh();
      }
    }
  })();
  return inFlight;
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (raw) session = { ...emptySession(), ...(JSON.parse(raw) as Session) };
  } catch {
    // Private mode or blocked storage: keep in memory.
  }
  window.addEventListener("storage", (e) => {
    if (e.key !== SESSION_KEY || !e.newValue) return;
    try {
      session = { ...emptySession(), ...(JSON.parse(e.newValue) as Session) };
      emit();
      void refresh();
    } catch {
      // ignore
    }
  });

  // EventSource reconnects on its own; "ready" fires on every (re)connect,
  // so we also catch up on anything missed while offline.
  const events = new EventSource("/api/stream");
  events.addEventListener("change", () => void refresh());
  events.addEventListener("ready", () => void refresh());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  // Keep retrying while the API can't be reached.
  window.setInterval(() => {
    if (connection === "offline") void refresh();
  }, 5_000);
  void refresh();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  start();
  return () => {
    listeners.delete(fn);
  };
}

function commitSession(next: Session) {
  session = next;
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
  emit();
}

/* ------------------------------------------------------------------ hooks */

export function useDB(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snap,
    () => emptySnapshot,
  );
}

export function useSession(): Session {
  const empty = emptySessionRef;
  return useSyncExternalStore(
    subscribe,
    () => session,
    () => empty,
  );
}
const emptySessionRef = emptySession();

export function useConnection(): Connection {
  return useSyncExternalStore(
    subscribe,
    () => connection,
    () => "loading" as Connection,
  );
}

/** True once the first snapshot has loaded in the browser. */
export function useHydrated(): boolean {
  return useConnection() === "ready";
}

export function getDB(): Snapshot {
  return snap;
}

/* ------------------------------------------------------------ buyer cart */

export function setSpot(spotId: string | undefined) {
  const next: Session = { ...session };
  if (spotId) next.spotId = spotId;
  else delete next.spotId;
  commitSession(next);
}

export function addToCart(product: Product, venueId: string, qty = 1) {
  // A basket belongs to one venue; switching venue starts a new basket.
  const cart =
    session.cartVenueId && session.cartVenueId !== venueId
      ? []
      : [...session.cart];
  const line = cart.find((l) => l.productId === product.id);
  if (line) line.qty += qty;
  else cart.push({ productId: product.id, qty });
  commitSession({ ...session, cart, cartVenueId: venueId });
}

export function setQty(productId: string, qty: number) {
  const cart: CartLine[] = session.cart
    .map((l) => (l.productId === productId ? { ...l, qty } : l))
    .filter((l) => l.qty > 0);
  commitSession({ ...session, cart });
}

export function clearCart() {
  const next: Session = { ...session, cart: [] };
  delete next.cartVenueId;
  commitSession(next);
}

export function confirmAge() {
  commitSession({ ...session, ageConfirmed: true });
}

/** Keeps an order on this phone (also used when a buyer opens their order link). */
export function rememberOrder(orderId: string): Promise<void> {
  if (session.myOrderIds.includes(orderId)) return Promise.resolve();
  commitSession({
    ...session,
    myOrderIds: [orderId, ...session.myOrderIds].slice(0, 20),
  });
  return refresh();
}

/* ------------------------------------------------------------ checkout */

export type PlaceOrderInput = {
  venueId: string;
  spotId: string;
  name: string;
  phone: string;
  email?: string;
  landmark?: string;
};

export type StartedPayment = { mode: "demo" | "flutterwave"; link: string };

/** The server prices the basket, creates the order and starts payment. */
export async function placeOrder(
  input: PlaceOrderInput,
): Promise<{ order: Order; payment: StartedPayment }> {
  const res = await api<{ order: Order; payment: StartedPayment }>("/orders", {
    body: {
      ...input,
      name: input.name.trim(),
      phone: input.phone.trim(),
      cart: session.cart,
    },
  });
  const next: Session = {
    ...session,
    cart: [],
    myOrderIds: [res.order.id, ...session.myOrderIds].slice(0, 20),
  };
  delete next.cartVenueId;
  commitSession(next);
  void refresh();
  return res;
}

export function startPayment(orderId: string): Promise<StartedPayment> {
  return api<StartedPayment>(`/orders/${orderId}/pay`, { body: {} });
}

/** Asks the server to check a Flutterwave transaction; it marks the order paid if it matches. */
export async function verifyPayment(
  orderId: string,
  transactionId: string,
): Promise<boolean> {
  const res = await api<{ ok: boolean }>(`/orders/${orderId}/verify`, {
    body: { transactionId },
  });
  await refresh();
  return res.ok;
}

/** Demo mode only (server has no Flutterwave key). */
export async function demoPay(orderId: string) {
  await act(`/orders/${orderId}/demo-pay`);
}

export function trackLookup(q: string): Promise<TrackResult[]> {
  return api<TrackResult[]>(`/track?q=${encodeURIComponent(q.trim())}`);
}

/* ------------------------------------------------------------ dispatch + runner */
// The `by` arguments are kept so pages don't change; the server records the
// signed-in staff member's name instead of trusting the browser.

export function assignRunner(
  orderId: string,
  runnerId: string,
  etaMinutes: number,
  _by?: string,
) {
  return act(`/orders/${orderId}/assign`, {
    runnerId,
    etaMinutes: Math.max(1, Math.round(etaMinutes)),
  });
}

export function setEta(orderId: string, etaMinutes: number, _by?: string) {
  return act(`/orders/${orderId}/eta`, {
    etaMinutes: Math.max(1, Math.round(etaMinutes)),
  });
}

export function startBuying(orderId: string, _by?: string) {
  return act(`/orders/${orderId}/start-buying`);
}

export function logPurchase(
  orderId: string,
  stopId: string,
  _runnerId: string,
  amountKobo: number,
  method: "cash" | "transfer",
  receiptUrl?: string,
) {
  return act(`/orders/${orderId}/purchases`, {
    stopId,
    amountKobo,
    method,
    ...(receiptUrl ? { receiptUrl } : {}),
  });
}

export function setItemStatus(
  orderId: string,
  stopId: string,
  itemId: string,
  status: ItemStatus,
  finalPriceKobo?: number,
  note?: string,
) {
  return act(`/orders/${orderId}/items/${itemId}`, {
    stopId,
    status,
    ...(finalPriceKobo !== undefined ? { finalPriceKobo } : {}),
    ...(note ? { note } : {}),
  });
}

export function markStopUnavailable(orderId: string, stopId: string) {
  return act(`/orders/${orderId}/stops/${stopId}/unavailable`);
}

/** Runner leaves for the buyer. Returns an error message, or null when it worked. */
export async function goOnTheWay(
  orderId: string,
  _by?: string,
): Promise<string | null> {
  try {
    await api(`/orders/${orderId}/on-the-way`, { body: {} });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    void refresh();
  }
}

export async function deliver(
  orderId: string,
  enteredPin: string,
  _by?: string,
): Promise<boolean> {
  try {
    const res = await api<{ ok: boolean }>(`/orders/${orderId}/deliver`, {
      body: { pin: enteredPin.trim() },
    });
    return res.ok;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    void refresh();
  }
}

export function markNotDelivered(orderId: string, _by: string, note: string) {
  return act(`/orders/${orderId}/not-delivered`, { note });
}

export function cancelOrder(orderId: string, reason: string, _by?: string) {
  return act(`/orders/${orderId}/cancel`, { reason });
}

/* ------------------------------------------------------------ staff */

export async function staffLogin(pinEntered: string): Promise<Staff | null> {
  try {
    const me = await api<Staff>("/auth/login", {
      body: { pin: pinEntered.trim() },
    });
    await refresh();
    return me;
  } catch (e) {
    if (e instanceof ApiError && e.status !== 401) toast.error(e.message);
    return null;
  }
}

export async function staffLogout() {
  await act("/auth/logout");
}

export function updateStaff(
  id: string,
  patch: Partial<Pick<Staff, "onShift" | "floatKobo" | "canEnterRestricted">>,
) {
  return act(`/staff/${id}`, patch, "PATCH");
}

/* ------------------------------------------------------------ admin + capture */

export function updateVenue(id: string, patch: Partial<Venue>) {
  return act(`/admin/venues/${id}`, patch, "PATCH");
}

export function updateZone(id: string, patch: Partial<Zone>) {
  return act(`/admin/zones/${id}`, patch, "PATCH");
}

export function upsertSpot(spot: Spot) {
  return act(`/admin/spots/${spot.id}`, spot, "PUT");
}

export function deleteSpot(id: string) {
  return act(`/admin/spots/${id}`, {}, "DELETE");
}

export function upsertVendor(vendor: Vendor) {
  return act(`/admin/vendors/${vendor.id}`, vendor, "PUT");
}

export function upsertProduct(product: Product) {
  return act(`/admin/products/${product.id}`, product, "PUT");
}

export function deleteProduct(id: string) {
  return act(`/admin/products/${id}`, {}, "DELETE");
}

export async function resetDemo() {
  const ok = await act("/admin/reset");
  if (ok) commitSession({ ...emptySession() });
  return ok;
}
