import { createFileRoute } from "@tanstack/react-router";
import { RequirePartner } from "@/components/DashboardChrome";
import { QrImage, spotUrl } from "@/components/QrImage";
import { useEvent, usePlan } from "@/lib/partnerApi";

export const Route = createFileRoute("/dashboard/events/$eventId_/print")({
  head: () => ({ meta: [{ title: "QR cards · Layovr partners" }] }),
  component: () => <RequirePartner>{() => <Print />}</RequirePartner>,
});

/** One A6 card per active spot, two per row; spare cards open the event page. */
function Print() {
  const { eventId } = Route.useParams();
  const event = useEvent(eventId);
  const plan = usePlan(eventId);
  if (!event.data || !plan.data) return <p className="p-8">Loading…</p>;
  const e = event.data;
  const spots = plan.data.spots.filter((s) => s.active);
  const card = (key: string, code: string, label: string, url: string) => (
    <div key={key} className="flex break-inside-avoid flex-col items-center rounded-3xl border-2 border-ink bg-sun p-6 text-center print:m-[4mm] print:h-[138mm]">
      <div className="font-display text-2xl font-extrabold">layovr</div>
      <p className="mt-2 font-display text-xl font-extrabold leading-tight">Scan to order. We bring it to this spot.</p>
      <div className="mt-4 rounded-2xl border-2 border-ink bg-white p-3">
        <QrImage value={url} size={190} />
      </div>
      <div className="mt-3 font-mono text-2xl font-bold tracking-wider">{code}</div>
      <div className="mt-1 min-h-5 text-sm font-semibold">{label}</div>
      <div className="mt-2 text-xs">{e.name}</div>
    </div>
  );
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <h1 className="text-3xl font-extrabold">QR cards · {e.name}</h1>
        <button type="button" className="btn bg-coral" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <p className="mt-1 text-sm print:hidden">{spots.length} spots plus 4 spare cards that open the event page.</p>
      <div className="mt-6 grid grid-cols-2 gap-4 print:mt-0 print:gap-0">
        {spots.map((s) => card(s.code, s.code, s.label, spotUrl(e.code, s.code)))}
        {[1, 2, 3, 4].map((n) => card(`spare${n}`, e.code, "Pick your spot after scanning", e.buyerUrl))}
      </div>
    </div>
  );
}
