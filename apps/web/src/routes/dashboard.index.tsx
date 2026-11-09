import { Link, createFileRoute } from "@tanstack/react-router";
import { RequirePartner } from "@/components/DashboardChrome";
import { EmptyCard } from "@/components/ui-bits";
import { useEvents, type EventSummary } from "@/lib/partnerApi";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({ meta: [{ title: "Your events · Layovr partners" }] }),
  component: () => <RequirePartner>{() => <Events />}</RequirePartner>,
});

const STATUS: Record<EventSummary["status"], { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-card" },
  live: { label: "Live", tone: "bg-mint" },
  ended: { label: "Ended", tone: "bg-muted" },
};

export function eventDates(e: Pick<EventSummary, "startsAt" | "endsAt">): string {
  if (!e.startsAt) return "Dates not set";
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
  return e.endsAt && fmt(e.endsAt) !== fmt(e.startsAt) ? `${fmt(e.startsAt)} – ${fmt(e.endsAt)}` : fmt(e.startsAt);
}

function Events() {
  const events = useEvents();
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">Your events</h1>
          <p className="text-muted-foreground">Set up the map, vendors and team, then publish.</p>
        </div>
        <Link to="/dashboard/events/new" className="btn bg-coral">
          + New event
        </Link>
      </div>

      {events.isLoading && <p className="mt-8">Loading…</p>}
      {events.data?.length === 0 && (
        <div className="mt-8">
          <EmptyCard
            emoji="🎪"
            title="No events yet"
            action={
              <Link to="/dashboard/events/new" className="btn bg-coral">
                Create your first event
              </Link>
            }
          >
            <p>It takes about five minutes: name, location, venue plan, deliveries.</p>
          </EmptyCard>
        </div>
      )}
      <ul className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {events.data?.map((e) => (
          <li key={e.id}>
            <Link
              to="/dashboard/events/$eventId"
              params={{ eventId: e.id }}
              className="card-pop block h-full bg-card p-5 transition hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-xs font-bold">{e.code}</span>
                <span className={cn("chip", STATUS[e.status].tone)}>{STATUS[e.status].label}</span>
              </div>
              <h2 className="mt-2 text-xl font-extrabold leading-tight">{e.name}</h2>
              <p className="text-sm">{eventDates(e)}</p>
              <p className="truncate text-sm text-muted-foreground">📍 {e.address ?? "Location not set"}</p>
              <dl className="mt-3 grid grid-cols-4 gap-1 text-center text-xs">
                {(
                  [
                    ["Spots", e.counts.spots],
                    ["Vendors", e.counts.vendors],
                    ["Team", e.counts.staff],
                    ["Orders", e.counts.orders],
                  ] as const
                ).map(([l, n]) => (
                  <div key={l} className="rounded-xl border-2 border-ink/20 py-1">
                    <dt className="font-bold">{n}</dt>
                    <dd>{l}</dd>
                  </div>
                ))}
              </dl>
              {e.deliveryMode === "layovr_runners" && (
                <p className="mt-3 text-xs font-bold">
                  🛵 Layovr runners:{" "}
                  {{ none: "not requested", requested: "requested, awaiting Layovr", approved: "approved", declined: "declined" }[e.runnerRequest.status]}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
