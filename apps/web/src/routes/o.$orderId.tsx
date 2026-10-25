import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmptyCard, Money, Section, StatusChip } from "@/components/ui-bits";
import {
  STATUS_LABEL,
  formatNaira,
  rememberOrder,
  useDB,
  useHydrated,
} from "@/lib/store";
import type { Order, OrderStatus } from "@/lib/types";
import { clockTime, cn, minutesFromNow } from "@/lib/utils";

export const Route = createFileRoute("/o/$orderId")({
  head: () => ({ meta: [{ title: "Your order · Layovr" }] }),
  component: OrderPage,
});

const FLOW: OrderStatus[] = [
  "paid",
  "assigned",
  "buying",
  "on_the_way",
  "delivered",
];

function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function headline(
  o: Order,
  runner: string | undefined,
  vendors: string,
  spot: string,
): string {
  switch (o.status) {
    case "awaiting_payment":
      return "Finish paying to place your order";
    case "paid":
      return "Order received. Finding you a runner.";
    case "assigned":
      return `${runner ?? "Your runner"} is heading to ${vendors}`;
    case "buying":
      return `${runner ?? "Your runner"} is at ${vendors}, picking up your order`;
    case "on_the_way":
      return `${runner ?? "Your runner"} is on the way to ${spot}`;
    case "delivered":
      return "Delivered. Enjoy!";
    case "not_delivered":
      return "We couldn't find you. Collect at the ops desk or call us.";
    case "cancelled":
      return "This order was cancelled";
  }
}

function OrderPage() {
  const { orderId } = Route.useParams();
  const d = useDB();
  const hydrated = useHydrated();
  useTick(30_000);
  // Opening the order link (e.g. from SMS) keeps it on this phone and loads it.
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    void rememberOrder(orderId).then(() => setChecked(true));
  }, [orderId]);

  const order = d.orders.find((o) => o.id === orderId);
  if (!hydrated || (!order && !checked))
    return (
      <Section>
        <p className="text-center text-lg">Loading your order…</p>
      </Section>
    );
  if (!order) {
    return (
      <Section>
        <EmptyCard
          emoji="🔎"
          title="We can't find that order"
          action={
            <Link to="/track" className="btn bg-coral">
              Look it up
            </Link>
          }
        >
          <p>Try looking it up with your phone number or order code.</p>
        </EmptyCard>
      </Section>
    );
  }

  const venue = d.venues.find((v) => v.id === order.venueId);
  const spot = d.spots.find((s) => s.id === order.spotId);
  const runner = d.staff.find((s) => s.id === order.runnerId);
  const vendorNames = order.stops
    .map(
      (st) => d.vendors.find((v) => v.id === st.vendorId)?.name ?? "the stall",
    )
    .join(" & ");
  const eta = minutesFromNow(order.etaAt);
  const stepIndex = FLOW.indexOf(order.status);
  const live = ["paid", "assigned", "buying", "on_the_way"].includes(
    order.status,
  );

  return (
    <Section className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-lg font-bold">{order.code}</span>
        <StatusChip status={order.status} />
      </div>
      <h1 className="mt-3 text-3xl font-extrabold md:text-4xl">
        {headline(order, runner?.name, vendorNames, spot?.label ?? "your spot")}
      </h1>
      {live && eta !== null && (
        <p className="mt-2 text-lg font-semibold">
          {eta > 0 ? `About ${eta} min to go` : "Any minute now"}
        </p>
      )}

      {order.status === "awaiting_payment" && (
        <Link
          to="/pay/$orderId"
          params={{ orderId: order.id }}
          className="btn mt-6 bg-coral"
        >
          Pay {formatNaira(order.totalKobo)}
        </Link>
      )}

      {stepIndex >= 0 && (
        <ol className="mt-8 grid grid-cols-5 gap-2" aria-label="Order progress">
          {FLOW.map((s, i) => (
            <li key={s} className="text-center">
              <div
                className={cn(
                  "h-3 rounded-full border-2 border-ink",
                  i <= stepIndex ? "bg-coral" : "bg-card",
                )}
              />
              <span
                className={cn(
                  "mt-1 block text-[11px] font-bold leading-tight sm:text-xs",
                  i > stepIndex && "opacity-50",
                )}
              >
                {STATUS_LABEL[s]}
              </span>
            </li>
          ))}
        </ol>
      )}

      {live && (
        <div className="card-pop mt-8 grid gap-4 bg-sun p-6 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="rounded-2xl border-2 border-ink bg-card px-5 py-3 text-center">
            <div className="text-xs font-bold uppercase tracking-wider">
              Hand-off code
            </div>
            <div className="font-mono text-4xl font-extrabold tracking-[0.2em]">
              {order.handoffPin}
            </div>
          </div>
          <p>
            Show this code to your runner when they arrive. Don't share it
            before then.
          </p>
        </div>
      )}

      <div className="card-pop mt-8 bg-card p-6">
        <h2 className="text-xl font-extrabold">Delivering to</h2>
        <p className="mt-1 text-lg">📍 {spot?.label ?? "Your spot"}</p>
        {order.landmark && (
          <p className="text-muted-foreground">“{order.landmark}”</p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">{venue?.name}</p>

        <h2 className="mt-6 text-xl font-extrabold">Your order</h2>
        <ul className="mt-2 divide-y-2 divide-ink/10">
          {order.stops.flatMap((st) =>
            st.items.map((it) => (
              <li key={it.id} className="flex justify-between gap-3 py-2">
                <span
                  className={cn(
                    it.status === "dropped" && "line-through opacity-60",
                  )}
                >
                  {it.qty} × {it.name}
                  {it.status === "swapped" && it.note && (
                    <span className="block text-sm">Swapped: {it.note}</span>
                  )}
                  {it.status === "dropped" && (
                    <span className="block text-sm no-underline">
                      Unavailable, refunded
                    </span>
                  )}
                </span>
                <Money kobo={it.unitPriceKobo * it.qty} />
              </li>
            )),
          )}
        </ul>
        <dl className="mt-3 grid gap-1 border-t-2 border-ink pt-3">
          <div className="flex justify-between">
            <dt>Service fee</dt>
            <dd>
              <Money kobo={order.feeKobo} />
            </dd>
          </div>
          <div className="flex justify-between text-lg font-extrabold">
            <dt>Paid</dt>
            <dd>
              <Money kobo={order.totalKobo} />
            </dd>
          </div>
          {order.refundKobo > 0 && (
            <div className="flex justify-between font-bold text-destructive">
              <dt>Refund on its way</dt>
              <dd>
                <Money kobo={order.refundKobo} />
              </dd>
            </div>
          )}
        </dl>
      </div>

      <details className="mt-6">
        <summary className="cursor-pointer font-bold">Order history</summary>
        <ul className="mt-3 grid gap-2 text-sm">
          {[...order.events].reverse().map((e, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-14 shrink-0 tabular-nums text-muted-foreground">
                {clockTime(e.at)}
              </span>
              <span>
                <b>{STATUS_LABEL[e.status]}</b>
                {e.note && ` · ${e.note}`}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <p className="mt-8 text-sm text-muted-foreground">
        Keep this page open, or come back with the link we texted you. It
        updates on its own.
      </p>
    </Section>
  );
}
