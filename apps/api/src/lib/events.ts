import { EventEmitter } from "node:events";

/**
 * In-process change feed. Every write calls notify(); GET /api/stream relays it
 * to browsers as server-sent events and they refetch their snapshot.
 * Fine for one API instance; with several, swap for Postgres LISTEN/NOTIFY.
 */
export type Change = { venueId: string; orderId?: string };

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function notify(change: Change) {
  bus.emit("change", change);
}

export function onChange(fn: (c: Change) => void): () => void {
  bus.on("change", fn);
  return () => bus.off("change", fn);
}
