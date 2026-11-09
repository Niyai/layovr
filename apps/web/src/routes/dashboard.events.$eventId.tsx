import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { RequirePartner } from "@/components/DashboardChrome";
import { DeliveriesTab, OverviewTab, PlanTab, SettingsTab, StaffTab, VendorsTab } from "@/components/dashboard/EventTabs";
import { usePlan, useEvent } from "@/lib/partnerApi";
import { cn } from "@/lib/utils";
import { eventDates } from "./dashboard.index";

const TABS = [
  ["overview", "Overview"],
  ["plan", "Venue plan"],
  ["vendors", "Vendors"],
  ["staff", "Staff"],
  ["deliveries", "Deliveries"],
  ["settings", "Settings"],
] as const;
type Tab = (typeof TABS)[number][0];

export const Route = createFileRoute("/dashboard/events/$eventId")({
  validateSearch: (s) =>
    z.object({ tab: z.enum(["overview", "plan", "vendors", "staff", "deliveries", "settings"]).optional() }).parse(s),
  head: () => ({ meta: [{ title: "Event · Layovr partners" }] }),
  component: () => <RequirePartner>{() => <EventPage />}</RequirePartner>,
});

function EventPage() {
  const { eventId } = Route.useParams();
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate();
  const event = useEvent(eventId);
  const plan = usePlan(eventId);
  if (event.isError) return <p className="p-8">That event wasn't found.</p>;
  if (!event.data) return <p className="p-8">Loading…</p>;
  const e = event.data;
  const setTab = (t: Tab) => void navigate({ to: "/dashboard/events/$eventId", params: { eventId }, search: { tab: t }, replace: true });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="font-mono text-xs font-bold">{e.code}</span>
          <h1 className="text-3xl font-extrabold">{e.name}</h1>
          <p className="text-sm text-muted-foreground">
            {eventDates(e)} · {e.address ?? "location not set"}
          </p>
        </div>
        <span className={cn("chip", e.status === "live" ? "bg-mint" : "bg-card")}>
          {e.status === "live" ? "Live" : e.status === "ended" ? "Ended" : "Draft"}
        </span>
      </div>
      <div className="mt-5 flex flex-wrap gap-2" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn("rounded-full border-2 border-ink px-4 py-2 text-sm font-bold", tab === key ? "bg-sun shadow-pop" : "bg-card")}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "overview" && <OverviewTab event={e} />}
        {tab === "plan" && <PlanTab event={e} />}
        {tab === "vendors" && <VendorsTab event={e} plan={plan.data} />}
        {tab === "staff" && <StaffTab event={e} />}
        {tab === "deliveries" && <DeliveriesTab event={e} />}
        {tab === "settings" && <SettingsTab event={e} />}
      </div>
    </div>
  );
}
