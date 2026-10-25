import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RequireStaff } from "@/components/RequireStaff";
import { Field, Money, StatusChip } from "@/components/ui-bits";
import {
  assignRunner,
  deliver,
  formatNaira,
  goOnTheWay,
  logPurchase,
  markNotDelivered,
  markStopUnavailable,
  runnerFloat,
  setItemStatus,
  startBuying,
  useDB,
} from "@/lib/store";
import type { DB, Order, OrderStop, Staff } from "@/lib/types";
import { cn, compressImage, minutesFromNow } from "@/lib/utils";

export const Route = createFileRoute("/runner")({
  head: () => ({ meta: [{ title: "Runner · Layovr" }] }),
  component: () => (
    <RequireStaff roles={["runner", "dispatch", "admin"]}>
      {(me) => <RunnerHome me={me} />}
    </RequireStaff>
  ),
});

function RunnerHome({ me }: { me: Staff }) {
  const d = useDB();
  const runners = d.staff.filter(
    (s) => s.venueId === me.venueId && s.role === "runner",
  );
  // Dispatch and admin can open any runner's view (handy when helping out).
  const [viewAs, setViewAs] = useState(
    me.role === "runner" ? me.id : (runners[0]?.id ?? me.id),
  );
  const runner = d.staff.find((s) => s.id === viewAs) ?? me;

  const mine = d.orders
    .filter(
      (o) =>
        o.runnerId === runner.id &&
        ["assigned", "buying", "on_the_way"].includes(o.status),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const waiting = d.orders.filter(
    (o) => o.venueId === me.venueId && o.status === "paid",
  );
  const f = runnerFloat(d, runner);

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold">Hi {runner.name}</h1>
        {me.role !== "runner" && (
          <select
            className="field w-auto py-2 text-sm"
            value={viewAs}
            onChange={(e) => setViewAs(e.target.value)}
            aria-label="View as runner"
          >
            {runners.map((r) => (
              <option key={r.id} value={r.id}>
                View as {r.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Mini label="Float" value={formatNaira(f.floatKobo)} />
        <Mini label="Spent" value={formatNaira(f.spentKobo)} />
        <Mini
          label="Left"
          value={formatNaira(f.leftKobo)}
          tone={f.leftKobo < 500000 ? "bg-blush" : "bg-mint"}
        />
      </div>

      {mine.length === 0 ? (
        <div className="card-pop mt-6 bg-card p-6 text-center">
          <div className="text-4xl">🛵</div>
          <p className="mt-2 font-bold">No orders assigned to you right now.</p>
          {waiting.length > 0 && (
            <div className="mt-4">
              <p className="text-sm">
                {waiting.length} order{waiting.length === 1 ? " is" : "s are"}{" "}
                waiting. Take the oldest if dispatch says so:
              </p>
              <button
                type="button"
                className="btn mt-3 bg-coral"
                onClick={() => {
                  const o = [...waiting].sort((a, b) =>
                    a.createdAt.localeCompare(b.createdAt),
                  )[0];
                  if (o) assignRunner(o.id, runner.id, 15, runner.name);
                }}
              >
                Take{" "}
                {
                  [...waiting].sort((a, b) =>
                    a.createdAt.localeCompare(b.createdAt),
                  )[0]?.code
                }
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 grid gap-6">
          {mine.map((o) => (
            <RunnerOrder key={o.id} o={o} d={d} runner={runner} />
          ))}
        </div>
      )}
    </div>
  );
}

function Mini({
  label,
  value,
  tone = "bg-card",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className={cn("rounded-2xl border-2 border-ink px-2 py-2", tone)}>
      <div className="text-[11px] font-bold uppercase tracking-wider">
        {label}
      </div>
      <div className="font-display font-extrabold tabular-nums">{value}</div>
    </div>
  );
}

function RunnerOrder({ o, d, runner }: { o: Order; d: DB; runner: Staff }) {
  const spot = d.spots.find((s) => s.id === o.spotId);
  const eta = minutesFromNow(o.etaAt);
  const [pin, setPin] = useState("");
  const pending = o.stops.filter((s) => s.status === "pending").length;

  return (
    <article className="card-pop overflow-hidden bg-card">
      <header className="flex items-center justify-between border-b-2 border-ink bg-sun px-4 py-3">
        <div>
          <div className="font-mono text-xl font-bold">{o.code}</div>
          <div className="text-sm">
            for <b>{o.customerName}</b> ·{" "}
            {eta === null
              ? "no ETA"
              : eta < 0
                ? `${-eta} min late`
                : `due in ${eta} min`}
          </div>
        </div>
        <StatusChip status={o.status} />
      </header>

      <ol className="divide-y-2 divide-ink/10">
        {o.stops.map((st, i) => (
          <Stop
            key={`${st.id}:${st.items.map((it) => it.status + it.finalPriceKobo).join()}`}
            n={i + 1}
            o={o}
            st={st}
            d={d}
            runner={runner}
          />
        ))}
        <li className={cn("p-4", o.status === "on_the_way" && "bg-coral/30")}>
          <div className="text-xs font-bold uppercase tracking-wider">
            Last stop · the buyer
          </div>
          <p className="mt-1 text-lg font-extrabold">📍 {spot?.label}</p>
          {o.landmark && <p>“{o.landmark}”</p>}
          {spot?.directions && (
            <p className="mt-1 text-sm text-muted-foreground">
              🧭 {spot.directions}
            </p>
          )}
          <a
            href={`tel:${o.customerPhone}`}
            className="btn btn-sm mt-3 bg-card"
          >
            📞 Call {o.customerName}
          </a>

          {o.status !== "on_the_way" ? (
            <button
              type="button"
              className="btn mt-4 w-full bg-coral"
              disabled={pending > 0}
              onClick={async () => {
                const err = await goOnTheWay(o.id, runner.name);
                if (err) toast.error(err);
              }}
            >
              {pending > 0
                ? `Buy at ${pending} more stall${pending === 1 ? "" : "s"} first`
                : "Head to the buyer"}
            </button>
          ) : (
            <form
              className="mt-4 grid gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await deliver(o.id, pin, runner.name))
                  toast.success(`${o.code} delivered 🎉`);
                else
                  toast.error(
                    "That code doesn't match. Ask the buyer to check their order page.",
                  );
              }}
            >
              <Field label="Buyer's 4-digit code">
                <input
                  className="field text-center font-mono text-2xl tracking-[0.4em]"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <button
                type="submit"
                className="btn bg-mint"
                disabled={pin.length !== 4}
              >
                Hand over · Delivered
              </button>
              <button
                type="button"
                className="text-sm font-bold underline"
                onClick={() => {
                  if (
                    window.confirm(
                      "Couldn't find the buyer? The order goes back to the ops desk.",
                    )
                  )
                    markNotDelivered(o.id, runner.name, "Buyer not found");
                }}
              >
                Can't find the buyer
              </button>
            </form>
          )}
        </li>
      </ol>
    </article>
  );
}

function Stop({
  n,
  o,
  st,
  d,
  runner,
}: {
  n: number;
  o: Order;
  st: OrderStop;
  d: DB;
  runner: Staff;
}) {
  const vendor = d.vendors.find((v) => v.id === st.vendorId);
  const venue = d.venues.find((v) => v.id === o.venueId);
  // What the runner should hand the stall: current prices, minus dropped items.
  const expected = st.items.reduce(
    (sum, i) => sum + (i.status === "dropped" ? 0 : i.finalPriceKobo * i.qty),
    0,
  );
  const [amount, setAmount] = useState(String(expected / 100));
  const [method, setMethod] = useState<"cash" | "transfer">("transfer");
  const [receipt, setReceipt] = useState<string | undefined>();
  const [changing, setChanging] = useState<string | null>(null);
  const [newPrice, setNewPrice] = useState("");

  const paidKobo = Math.round(Number(amount || 0) * 100);
  const gap = paidKobo - expected;

  if (st.status !== "pending") {
    const purchase = d.purchases.find((p) => p.stopId === st.id);
    return (
      <li className="flex items-center justify-between gap-3 bg-mint/30 p-4">
        <span>
          <b>
            {n}. {vendor?.emoji} {vendor?.name}
          </b>
          <span className="block text-sm">
            {st.status === "bought"
              ? `Bought · ${formatNaira(purchase?.amountKobo ?? 0)} by ${purchase?.method}`
              : "Unavailable, refunded"}
          </span>
        </span>
        <span className="text-2xl">{st.status === "bought" ? "✅" : "🚫"}</span>
      </li>
    );
  }

  return (
    <li className="p-4">
      <div className="text-xs font-bold uppercase tracking-wider">Stop {n}</div>
      <h3 className="text-lg font-extrabold">
        {vendor?.emoji} {vendor?.name}
      </h3>
      <p className="text-sm text-muted-foreground">📍 {vendor?.stallLabel}</p>

      <ul className="mt-3 grid gap-2">
        {st.items.map((it) => (
          <li key={it.id} className="rounded-xl border-2 border-ink/20 p-2">
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "font-semibold",
                  it.status === "dropped" && "line-through opacity-60",
                )}
              >
                {it.qty} × {it.name}
              </span>
              <Money kobo={it.unitPriceKobo * it.qty} className="text-sm" />
            </div>
            {it.status === "ok" && changing !== it.id && (
              <div className="mt-1 flex gap-3 text-xs font-bold">
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setItemStatus(
                      o.id,
                      st.id,
                      it.id,
                      "dropped",
                      undefined,
                      "Sold out",
                    );
                    toast(
                      `Dropped ${it.name}. Call ${o.customerName} to offer a swap.`,
                    );
                  }}
                >
                  Sold out
                </button>
                <button
                  type="button"
                  className="underline"
                  onClick={() => setChanging(it.id)}
                >
                  Price changed
                </button>
              </div>
            )}
            {changing === it.id && (
              <div className="mt-2 flex gap-2">
                <input
                  className="field py-1.5 text-sm"
                  inputMode="numeric"
                  placeholder="New unit price ₦"
                  value={newPrice}
                  onChange={(e) =>
                    setNewPrice(e.target.value.replace(/[^\d]/g, ""))
                  }
                />
                <button
                  type="button"
                  className="btn btn-sm bg-sun"
                  onClick={() => {
                    const k = Number(newPrice) * 100;
                    const diff = (k - it.unitPriceKobo) * it.qty;
                    setItemStatus(
                      o.id,
                      st.id,
                      it.id,
                      "swapped",
                      k,
                      `price now ${formatNaira(k)}`,
                    );
                    setChanging(null);
                    if (venue && diff > venue.absorbLimitKobo)
                      toast.warning(
                        `+${formatNaira(diff)}: call ${o.customerName} before buying`,
                      );
                    else
                      toast(
                        `Small change (${formatNaira(diff)}), we absorb it`,
                      );
                  }}
                >
                  Save
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-3 rounded-2xl bg-muted p-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Paid at stall (₦)">
            <input
              className="field py-2"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
          <Field label="How">
            <select
              className="field py-2"
              value={method}
              onChange={(e) => setMethod(e.target.value as "cash" | "transfer")}
            >
              <option value="transfer">Transfer</option>
              <option value="cash">Cash</option>
            </select>
          </Field>
        </div>
        {gap !== 0 && (
          <p
            className={cn(
              "text-xs font-bold",
              gap > 0 ? "text-destructive" : "",
            )}
          >
            {gap > 0
              ? `${formatNaira(gap)} more than the order`
              : `${formatNaira(-gap)} less than the order`}
          </p>
        )}
        <label className="text-sm font-bold">
          Receipt photo (optional)
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="mt-1 block w-full text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setReceipt(await compressImage(file, 800, 0.6));
            }}
          />
        </label>
        {receipt && (
          <img
            src={receipt}
            alt="Receipt"
            className="h-20 w-20 rounded-lg border-2 border-ink object-cover"
          />
        )}
        <div className="flex flex-wrap gap-2">
          {o.status === "assigned" && (
            <button
              type="button"
              className="btn btn-sm bg-card"
              onClick={() => startBuying(o.id, runner.name)}
            >
              I'm at the stall
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm flex-1 bg-coral"
            disabled={paidKobo <= 0}
            onClick={async () => {
              if (
                await logPurchase(o.id, st.id, runner.id, paidKobo, method, receipt)
              )
                toast.success(
                  `Logged ${formatNaira(paidKobo)} at ${vendor?.name}`,
                );
            }}
          >
            Bought · log {formatNaira(paidKobo)}
          </button>
          <button
            type="button"
            className="btn btn-sm bg-blush"
            onClick={() => {
              if (
                window.confirm(
                  `Nothing available at ${vendor?.name}? Those items will be refunded.`,
                )
              )
                markStopUnavailable(o.id, st.id);
            }}
          >
            Stall can't fill
          </button>
        </div>
      </div>
    </li>
  );
}
