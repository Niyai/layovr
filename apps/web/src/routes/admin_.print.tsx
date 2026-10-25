import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { QrImage, spotUrl } from "@/components/QrImage";
import { RequireStaff } from "@/components/RequireStaff";
import { useDB } from "@/lib/store";
import type { Staff } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Print-ready QR cards: A6 table tents or seat-back stickers, 4 per A4 page. */
export const Route = createFileRoute("/admin_/print")({
  head: () => ({ meta: [{ title: "Print QR cards · Layovr" }] }),
  component: () => (
    <RequireStaff roles={["admin"]}>
      {(me) => <PrintCards me={me} />}
    </RequireStaff>
  ),
});

function PrintCards({ me }: { me: Staff }) {
  const d = useDB();
  const venue = d.venues.find((v) => v.id === me.venueId);
  const zones = d.zones.filter((z) => z.venueId === me.venueId);
  const [zoneId, setZoneId] = useState("all");
  const [blanks, setBlanks] = useState(4);
  const spots = d.spots.filter(
    (s) =>
      s.venueId === me.venueId &&
      s.active &&
      (zoneId === "all" || s.zoneId === zoneId),
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <Link to="/admin" className="text-sm font-bold underline">
            ← Admin
          </Link>
          <h1 className="text-3xl font-extrabold">Print QR cards</h1>
          <p className="text-muted-foreground">
            {spots.length} cards. Print at 100% scale on A4, then cut. Laminate
            if you can.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="field w-auto py-2"
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            aria-label="Zone"
          >
            <option value="all">All zones</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm font-bold">
            Spare blank cards
            <input
              className="field w-20 py-2"
              type="number"
              min={0}
              max={20}
              value={blanks}
              onChange={(e) => setBlanks(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="btn bg-coral"
            onClick={() => window.print()}
          >
            🖨️ Print
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 print:mt-0 print:gap-0">
        {spots.map((s) => (
          <Card
            key={s.id}
            code={s.code}
            label={s.label}
            venueName={venue?.name ?? ""}
          />
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <Card
            key={`blank-${i}`}
            code=""
            label=""
            venueName={venue?.name ?? ""}
            venueCode={venue?.code ?? ""}
          />
        ))}
      </div>
    </div>
  );
}

/** Spare cards point at the whole venue; the buyer picks their spot after scanning. */
function Card({
  code,
  label,
  venueName,
  venueCode,
}: {
  code: string;
  label: string;
  venueName: string;
  venueCode?: string;
}) {
  const venueUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/l/${venueCode ?? ""}`;
  return (
    <div
      className={cn(
        "flex break-inside-avoid flex-col items-center rounded-3xl border-2 border-ink bg-sun p-6 text-center print:m-[4mm] print:h-[138mm]",
      )}
    >
      <div className="flex items-center gap-2 font-display text-2xl font-extrabold">
        <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-ink bg-card">
          <span className="h-2.5 w-2.5 rounded-full bg-coral ring-2 ring-ink" />
        </span>
        layovr
      </div>
      <p className="mt-2 font-display text-xl font-extrabold leading-tight">
        Scan to order. We bring it to this spot.
      </p>
      <div className="mt-4 rounded-2xl border-2 border-ink bg-white p-3">
        <QrImage value={code ? spotUrl(code) : venueUrl} size={190} />
      </div>
      <div className="mt-3 font-mono text-2xl font-bold tracking-wider">
        {code || venueCode}
      </div>
      <div className="mt-1 min-h-5 text-sm font-semibold">
        {label || "Spare card: you'll pick your spot after scanning"}
      </div>
      <div className="mt-auto pt-3 text-xs">
        Can't scan? Go to{" "}
        <b>{typeof window === "undefined" ? "" : window.location.host}/scan</b>{" "}
        and type the code · {venueName}
      </div>
    </div>
  );
}
