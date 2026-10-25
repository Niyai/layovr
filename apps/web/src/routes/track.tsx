import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Field, PageHero, Section, StatusChip } from "@/components/ui-bits";
import {
  formatNaira,
  trackLookup,
  useDB,
  useHydrated,
  useSession,
} from "@/lib/store";
import type { Order, TrackResult } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

export const Route = createFileRoute("/track")({
  head: () => ({ meta: [{ title: "Track an order · Layovr" }] }),
  component: Track,
});

/**
 * Lookup by code or phone runs on the server, is rate-limited and returns
 * status only. Full details need the order link, which only the buyer has.
 */
function Track() {
  const d = useDB();
  const session = useSession();
  const hydrated = useHydrated();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TrackResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mine = hydrated
    ? session.myOrderIds
        .map((id) => d.orders.find((o) => o.id === id))
        .filter((o): o is Order => Boolean(o))
    : [];

  const search = async () => {
    setError(null);
    try {
      setResults(await trackLookup(q));
    } catch (e) {
      setResults(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <PageHero
        eyebrow="Track an order"
        fill="bg-mint"
        title="Where's my order?"
      >
        Look up by your order code (it starts with LV-) or the phone number you
        ordered with.
      </PageHero>
      <Section className="grid gap-10 md:grid-cols-2">
        <form
          className="card-pop h-fit bg-card p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <Field label="Order code or phone number">
            <input
              className="field font-mono"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="LV-7KQ2 or 080…"
            />
          </Field>
          <button
            type="submit"
            className="btn mt-5 w-full bg-coral"
            disabled={!q.trim()}
          >
            Find my order
          </button>
          {error && <p className="mt-6 text-destructive">{error}</p>}
          {results && (
            <div className="mt-6">
              {results.length === 0 ? (
                <p>
                  No orders found. Make sure you're using the same number or
                  code you ordered with.
                </p>
              ) : (
                <>
                  <ul className="grid gap-3">
                    {results.map((r) => (
                      <li
                        key={r.code}
                        className="card-pop flex items-center justify-between gap-3 bg-card p-4"
                      >
                        <span>
                          <span className="block font-mono font-bold">
                            {r.code}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {formatNaira(r.totalKobo)} · {timeAgo(r.createdAt)}
                          </span>
                        </span>
                        <StatusChip status={r.status} />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-sm text-muted-foreground">
                    For full details and your hand-off code, open the order link
                    on the phone you ordered with, or ask a Layovr runner.
                  </p>
                </>
              )}
            </div>
          )}
        </form>
        <div>
          <h2 className="text-2xl font-extrabold">Ordered on this phone</h2>
          {mine.length === 0 ? (
            <p className="mt-2">Nothing yet.</p>
          ) : (
            <div className="mt-4">
              <OrderList orders={mine} />
            </div>
          )}
        </div>
      </Section>
    </>
  );
}

function OrderList({ orders }: { orders: Order[] }) {
  return (
    <ul className="grid gap-3">
      {orders.map((o) => (
        <li key={o.id}>
          <Link
            to="/o/$orderId"
            params={{ orderId: o.id }}
            className="card-pop flex items-center justify-between gap-3 bg-card p-4 hover:-translate-y-0.5"
          >
            <span>
              <span className="block font-mono font-bold">{o.code}</span>
              <span className="text-sm text-muted-foreground">
                {formatNaira(o.totalKobo)} · {timeAgo(o.createdAt)}
              </span>
            </span>
            <StatusChip status={o.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
