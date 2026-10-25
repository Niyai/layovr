import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FloorPlan, type PlanDot } from "@/components/FloorPlan";
import { RequireStaff } from "@/components/RequireStaff";
import { Money, StatusChip } from "@/components/ui-bits";
import {
  ACTIVE_STATUSES,
  assignRunner,
  cancelOrder,
  formatNaira,
  markNotDelivered,
  runnerFloat,
  setEta,
  updateStaff,
  useDB,
  vendorWait,
} from "@/lib/store";
import type { DB, Order, Staff } from "@/lib/types";
import { cn, minutesFromNow, timeAgo } from "@/lib/utils";

export const Route = createFileRoute("/ops")({
  head: () => ({ meta: [{ title: "Ops board · Layovr" }] }),
  component: () => (
    <RequireStaff roles={["admin", "dispatch"]}>
      {(me) => <OpsBoard me={me} />}
    </RequireStaff>
  ),
});

const STALE_MIN = 25;

function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.18, ctx.currentTime + i * 0.16);
      g.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + i * 0.16 + 0.15,
      );
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.16);
      o.stop(ctx.currentTime + i * 0.16 + 0.16);
    });
  } catch {
    // Audio blocked until the page is clicked once.
  }
}

const DOT: Record<string, string> = {
  paid: "bg-sun",
  assigned: "bg-lilac",
  buying: "bg-blush",
  on_the_way: "bg-coral",
};

function OpsBoard({ me }: { me: Staff }) {
  const d = useDB();
  useTick(20_000);
  const venue = d.venues.find((v) => v.id === me.venueId);
  const orders = d.orders.filter((o) => o.venueId === me.venueId);
  const waiting = orders
    .filter((o) => o.status === "paid")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const working = orders.filter(
    (o) => o.status === "assigned" || o.status === "buying",
  );
  const enRoute = orders.filter((o) => o.status === "on_the_way");
  const done = orders
    .filter((o) =>
      ["delivered", "not_delivered", "cancelled"].includes(o.status),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);
  const runners = d.staff.filter(
    (s) => s.venueId === me.venueId && s.role === "runner",
  );
  const refundsDue = orders.filter((o) => o.refundKobo > 0);

  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (seen.current !== null && waiting.length > seen.current) {
      chime();
      toast("New order", { description: waiting.at(-1)?.code ?? "" });
    }
    seen.current = waiting.length;
  }, [waiting.length]);

  if (!venue) return null;
  const active = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const dots: PlanDot[] = active.flatMap((o) => {
    const s = d.spots.find((x) => x.id === o.spotId);
    return s
      ? [
          {
            id: o.id,
            x: s.x,
            y: s.y,
            className: DOT[o.status] ?? "bg-card",
            label: `${o.code} · ${o.status}`,
          },
        ]
      : [];
  });
  const delivered = orders.filter((o) => o.status === "delivered");
  const revenueFee = delivered.reduce((s, o) => s + o.feeKobo, 0);

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">Ops board</h1>
          <p className="text-muted-foreground">{venue.name} · updates live</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Stat
            label="Need a runner"
            value={waiting.length}
            tone={waiting.length ? "bg-sun" : "bg-card"}
          />
          <Stat
            label="In progress"
            value={working.length + enRoute.length}
            tone="bg-card"
          />
          <Stat
            label="Runners free"
            value={
              runners.filter(
                (r) =>
                  r.onShift &&
                  !active.some(
                    (o) => o.runnerId === r.id && o.status !== "paid",
                  ),
              ).length
            }
            tone="bg-mint"
          />
          <Stat label="Delivered" value={delivered.length} tone="bg-card" />
          <Stat
            label="Fees earned"
            value={formatNaira(revenueFee)}
            tone="bg-card"
          />
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_1fr_1fr_380px]">
        <Column
          title="Paid · assign a runner"
          count={waiting.length}
          tone="bg-sun"
        >
          {waiting.map((o) => (
            <OrderCard key={o.id} o={o} d={d} me={me} runners={runners} />
          ))}
        </Column>
        <Column title="Buying" count={working.length} tone="bg-lilac">
          {working.map((o) => (
            <OrderCard key={o.id} o={o} d={d} me={me} runners={runners} />
          ))}
        </Column>
        <Column title="On the way" count={enRoute.length} tone="bg-coral">
          {enRoute.map((o) => (
            <OrderCard key={o.id} o={o} d={d} me={me} runners={runners} />
          ))}
        </Column>

        <aside className="grid h-fit gap-4">
          <FloorPlan
            venue={venue}
            zones={d.zones.filter((z) => z.venueId === venue.id)}
            spots={d.spots.filter((s) => s.venueId === venue.id && s.active)}
            dots={dots}
            caption={
              <span className="flex flex-wrap gap-3 text-xs font-bold">
                <Legend c="bg-sun" t="Paid" />
                <Legend c="bg-lilac" t="Assigned" />
                <Legend c="bg-blush" t="Buying" />
                <Legend c="bg-coral" t="On the way" />
              </span>
            }
          />

          <section className="card-pop bg-card p-4">
            <h2 className="font-display text-lg font-bold">Runners & floats</h2>
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-1">Runner</th>
                  <th>Spent</th>
                  <th>Left</th>
                  <th className="text-right">On shift</th>
                </tr>
              </thead>
              <tbody>
                {runners.map((r) => {
                  const f = runnerFloat(d, r);
                  const busy = active.find((o) => o.runnerId === r.id);
                  return (
                    <tr key={r.id} className="border-t border-ink/10">
                      <td className="py-1.5">
                        <b>{r.name}</b>
                        {r.canEnterRestricted && " 🔑"}
                        <span className="block text-xs text-muted-foreground">
                          {busy ? `on ${busy.code}` : "free"}
                        </span>
                      </td>
                      <td className="tabular-nums">
                        {formatNaira(f.spentKobo)}
                      </td>
                      <td
                        className={cn(
                          "tabular-nums",
                          f.leftKobo < 500000 && "font-bold text-destructive",
                        )}
                      >
                        {formatNaira(f.leftKobo)}
                      </td>
                      <td className="text-right">
                        <input
                          type="checkbox"
                          aria-label={`${r.name} on shift`}
                          checked={r.onShift}
                          onChange={(e) =>
                            updateStaff(r.id, { onShift: e.target.checked })
                          }
                          className="h-5 w-5 accent-[var(--coral)]"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              🔑 = can enter restricted areas. Red = float below ₦5,000.
            </p>
          </section>

          <section className="card-pop bg-card p-4">
            <h2 className="font-display text-lg font-bold">Stall wait times</h2>
            <ul className="mt-2 grid gap-1 text-sm">
              {d.vendors
                .filter((v) => v.venueId === venue.id && v.isOpen)
                .map((v) => {
                  const w = vendorWait(d, v);
                  return (
                    <li key={v.id} className="flex justify-between">
                      <span>
                        {v.emoji} {v.name}
                      </span>
                      <span
                        className={cn(
                          "tabular-nums",
                          w.busy === "busy" && "font-bold text-destructive",
                        )}
                      >
                        ~{w.minutes} min · {w.active} open
                      </span>
                    </li>
                  );
                })}
            </ul>
          </section>

          {refundsDue.length > 0 && (
            <section className="card-pop bg-blush p-4">
              <h2 className="font-display text-lg font-bold">Refunds due</h2>
              <p className="text-xs">
                Refund these in the Flutterwave dashboard, then note it in the
                order.
              </p>
              <ul className="mt-2 grid gap-1 text-sm">
                {refundsDue.map((o) => (
                  <li key={o.id} className="flex justify-between">
                    <span className="font-mono font-bold">{o.code}</span>
                    <Money kobo={o.refundKobo} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card-pop bg-card p-4">
            <h2 className="font-display text-lg font-bold">
              Recently finished
            </h2>
            <ul className="mt-2 grid gap-1.5 text-sm">
              {done.length === 0 && (
                <li className="text-muted-foreground">Nothing yet.</li>
              )}
              {done.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="font-mono font-bold">{o.code}</span>
                  <StatusChip status={o.status} />
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border-2 border-ink px-4 py-2 shadow-pop",
        tone,
      )}
    >
      <div className="text-xs font-bold uppercase tracking-wider">{label}</div>
      <div className="font-display text-2xl font-extrabold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("h-3 w-3 rounded-full border-2 border-ink", c)} />
      {t}
    </span>
  );
}

function Column({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0">
      <h2
        className={cn(
          "flex items-center justify-between rounded-2xl border-2 border-ink px-4 py-2 font-display font-bold",
          tone,
        )}
      >
        {title}
        <span className="chip">{count}</span>
      </h2>
      <div className="mt-3 grid gap-3">
        {count === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function OrderCard({
  o,
  d,
  me,
  runners,
}: {
  o: Order;
  d: DB;
  me: Staff;
  runners: Staff[];
}) {
  const spot = d.spots.find((s) => s.id === o.spotId);
  const zone = spot ? d.zones.find((z) => z.id === spot.zoneId) : undefined;
  const runner = d.staff.find((s) => s.id === o.runnerId);
  const age = Math.round(
    (Date.now() - new Date(o.createdAt).getTime()) / 60_000,
  );
  const eta = minutesFromNow(o.etaAt);
  const late = eta !== null && eta < 0;
  const stale = age >= STALE_MIN;
  const eligible = runners.filter(
    (r) => r.onShift && (!zone?.restricted || r.canEnterRestricted),
  );
  const [runnerId, setRunnerId] = useState(o.runnerId ?? eligible[0]?.id ?? "");
  const [mins, setMins] = useState(15);

  return (
    <article
      className={cn(
        "card-pop bg-card p-4",
        (late || stale) && "ring-4 ring-coral/60",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-lg font-bold">{o.code}</div>
          <div className="text-xs text-muted-foreground">
            {timeAgo(o.createdAt)} · {o.customerName}
          </div>
        </div>
        <StatusChip status={o.status} />
      </header>
      <p className="mt-2 font-semibold">📍 {spot?.label ?? "Unknown spot"}</p>
      {zone?.restricted && (
        <p className="text-xs font-bold text-destructive">
          Restricted area: needs a 🔑 runner
        </p>
      )}
      {o.landmark && (
        <p className="text-sm text-muted-foreground">“{o.landmark}”</p>
      )}
      <ul className="mt-2 grid gap-0.5 text-sm">
        {o.stops.map((st) => {
          const v = d.vendors.find((x) => x.id === st.vendorId);
          return (
            <li key={st.id}>
              <b>
                {v?.emoji} {v?.name}
              </b>
              {st.status !== "pending" && (
                <span className="ml-1 chip px-1.5 py-0 text-[10px]">
                  {st.status}
                </span>
              )}
              :{" "}
              {st.items
                .map(
                  (i) =>
                    `${i.qty}× ${i.name}${i.status === "dropped" ? " (dropped)" : ""}`,
                )
                .join(", ")}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-bold">
          <Money kobo={o.totalKobo} />
          {o.refundKobo > 0 && (
            <span className="ml-1 text-destructive">
              · refund {formatNaira(o.refundKobo)}
            </span>
          )}
        </span>
        {runner && (
          <span className={cn("font-semibold", late && "text-destructive")}>
            {runner.name} ·{" "}
            {eta === null ? "no ETA" : late ? `${-eta} min late` : `${eta} min`}
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-2 border-t-2 border-ink/10 pt-3">
        {o.status === "paid" && (
          <div className="grid grid-cols-[1fr_5rem_auto] gap-2">
            <select
              className="field col-span-3 py-2 text-sm"
              value={runnerId}
              onChange={(e) => setRunnerId(e.target.value)}
              aria-label="Runner"
            >
              {eligible.length === 0 && (
                <option value="">No eligible runner on shift</option>
              )}
              {eligible.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <span className="self-center text-sm font-semibold">ETA (min)</span>
            <input
              className="field py-2 text-sm"
              type="number"
              min={1}
              value={mins}
              onChange={(e) => setMins(Number(e.target.value))}
              aria-label="ETA in minutes"
            />
            <button
              type="button"
              className="btn btn-sm bg-coral"
              disabled={!runnerId}
              onClick={() => {
                assignRunner(o.id, runnerId, mins, me.name);
                toast.success(
                  `${o.code} → ${d.staff.find((s) => s.id === runnerId)?.name}`,
                );
              }}
            >
              Assign
            </button>
          </div>
        )}
        {(o.status === "assigned" ||
          o.status === "buying" ||
          o.status === "on_the_way") && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-sm bg-card"
              onClick={() => setEta(o.id, Math.max(1, (eta ?? 0) + 5), me.name)}
            >
              +5 min
            </button>
            <a className="btn btn-sm bg-card" href={`tel:${o.customerPhone}`}>
              Call buyer
            </a>
            {o.status === "on_the_way" && (
              <button
                type="button"
                className="btn btn-sm bg-card"
                onClick={() =>
                  markNotDelivered(o.id, me.name, "Buyer not found")
                }
              >
                Not found
              </button>
            )}
          </div>
        )}
        <details>
          <summary className="cursor-pointer text-xs font-bold text-muted-foreground">
            More
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {o.status !== "paid" && (
              <select
                className="field py-1.5 text-sm"
                aria-label="Reassign"
                value=""
                onChange={(e) =>
                  e.target.value &&
                  assignRunner(
                    o.id,
                    e.target.value,
                    Math.max(eta ?? 10, 5),
                    me.name,
                  )
                }
              >
                <option value="">Reassign to…</option>
                {eligible
                  .filter((r) => r.id !== o.runnerId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            )}
            <button
              type="button"
              className="btn btn-sm bg-blush"
              onClick={() => {
                if (
                  window.confirm(`Cancel ${o.code} and mark a full refund due?`)
                )
                  cancelOrder(o.id, "Cancelled by ops", me.name);
              }}
            >
              Cancel & refund
            </button>
          </div>
        </details>
      </div>
    </article>
  );
}
