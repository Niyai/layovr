import { fitGeo, geoPointsFor, placementOf, type VenuePlan } from "@layovr/shared";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { planOutlines, VenueMap } from "@/components/VenueMap";
import { Field } from "@/components/ui-bits";
import { googleEnabled } from "@/lib/google";
import { papi, refresh, type EventDetail } from "@/lib/partnerApi";
import { planAsFloor } from "./EventTabs";

type Placement = { lat: number; lng: number; rotationDeg: number; metresPerUnit: number };

/** Where the plan sits now, or a first guess: centred on the event location, north up, at the plan's own scale. */
function startingPlacement(event: EventDetail, plan: VenuePlan): Placement | null {
  const fit = plan.canvas.geo ? fitGeo(plan.canvas.geo.points) : null;
  if (fit) return placementOf(plan.canvas, fit);
  if (event.lat === null || event.lng === null) return null;
  const metresPerUnit = plan.canvas.unit === "ft" ? 0.3048 : 1;
  return { lat: event.lat, lng: event.lng, rotationDeg: 0, metresPerUnit };
}

/**
 * Line the plan up on a satellite map by eye: drag its centre, turn it, size
 * it. Saved as approximate GPS points, good enough for "Use my location" and
 * live tracking until someone calibrates on site.
 */
export function PlaceOnMap({ event, plan }: { event: EventDetail; plan: VenuePlan }) {
  const initial = useMemo(() => startingPlacement(event, plan), [event, plan]);
  const [p, setP] = useState<Placement | null>(initial);
  const [busy, setBusy] = useState(false);
  const floor = useMemo(() => planAsFloor(event, plan), [event, plan]);
  const sectionColor = useMemo(() => new Map(plan.sections.map((s) => [s.code, s.color ?? "#F2C230"])), [plan.sections]);
  const outlines = useMemo(() => {
    if (!p) return [];
    const fit = fitGeo(geoPointsFor(plan.canvas, p));
    return fit ? planOutlines(floor.venue, floor.zones, fit, sectionColor) : [];
  }, [p, plan.canvas, floor, sectionColor]);

  if (!googleEnabled()) return null;
  if (!p) {
    return (
      <section className="card-pop bg-card p-5">
        <h3 className="font-display text-lg font-bold">Place on map</h3>
        <p className="text-sm">Set the event's location in Settings first.</p>
      </section>
    );
  }
  const calibrated = plan.canvas.geo && !plan.canvas.geo.approximate;
  const set = (patch: Partial<Placement>) => setP({ ...p, ...patch });
  const save = async () => {
    if (calibrated && !window.confirm("This plan was linked to GPS on site. Replace that with this rough placement?")) return;
    setBusy(true);
    try {
      await papi(`/partner/events/${event.id}/plan/geo`, {
        method: "PATCH",
        body: { points: geoPointsFor(plan.canvas, p), approximate: true },
      });
      await refresh(["events", event.id, "plan"]);
      toast.success("Plan placed on the map");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const widthM = Math.round(plan.canvas.width * p.metresPerUnit);
  const heightM = Math.round(plan.canvas.height * p.metresPerUnit);

  return (
    <section className="card-pop grid gap-4 bg-card p-5">
      <div>
        <h3 className="font-display text-lg font-bold">Place on map</h3>
        <p className="text-sm">
          Line your plan up with the real building. Drag the pin to move it, then turn and size it until the outline sits on the roof. This
          puts buyers' "Use my location" and live tracking in the right place. For the best accuracy, also link the plan to GPS on site.
        </p>
      </div>
      <VenueMap
        center={p}
        pin={{ lat: p.lat, lng: p.lng, onMove: (c) => set(c) }}
        outlines={outlines}
        className="h-[420px]"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Turn: ${Math.round(p.rotationDeg)}°`}>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={p.rotationDeg}
            onChange={(e) => set({ rotationDeg: Number(e.target.value) })}
            aria-label="Turn the plan"
          />
        </Field>
        <Field label="Metres per plan unit" hint={`The plan is about ${widthM} × ${heightM} m`}>
          <input
            className="field"
            type="number"
            min={0.01}
            step={0.05}
            value={Number(p.metresPerUnit.toFixed(3))}
            onChange={(e) => Number(e.target.value) > 0 && set({ metresPerUnit: Number(e.target.value) })}
          />
        </Field>
        <div className="flex items-end gap-2">
          <button type="button" className="btn bg-sun" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save placement"}
          </button>
          {initial && (
            <button type="button" className="btn btn-sm bg-card" onClick={() => setP(initial)}>
              Undo
            </button>
          )}
        </div>
      </div>
      {calibrated && <p className="text-xs text-muted-foreground">This plan is already linked to GPS on site; saving here replaces that.</p>}
    </section>
  );
}
