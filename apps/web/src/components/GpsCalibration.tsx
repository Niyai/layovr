import { fitGeo } from "@layovr/shared";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Venue } from "@/lib/types";

type CalPoint = { x: number; y: number; lat: number; lng: number; accuracyM?: number };
type GeoPoint = { x: number; y: number; lat: number; lng: number };

/**
 * "Link the plan to GPS": stand somewhere recognisable, tap I'm here, then click
 * that place on the plan; repeat, then save. Used by on-site admin and the
 * partner dashboard. Wire `place` to a FloorPlan's onPlace while `awaitingClick`.
 */
export function useGpsCalibration(
  venue: Pick<Venue, "plan">,
  save: (points: GeoPoint[]) => Promise<{ residualM: number[] }>,
): { awaitingClick: boolean; place: (x: number, y: number) => void; panel: ReactNode } {
  const [geoPoints, setGeoPoints] = useState<CalPoint[]>([]);
  const [fix, setFix] = useState<{ lat: number; lng: number; accuracyM: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const fitNow = geoPoints.length >= 2 ? fitGeo(geoPoints) : null;
  const residuals = fitNow?.residualM ?? [];

  const imHere = () => {
    if (!("geolocation" in navigator)) {
      toast.error("This device can't share its location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy),
        });
        if (pos.coords.accuracy > 30) {
          toast("GPS is rough here (±" + Math.round(pos.coords.accuracy) + " m). Outdoors or by a door works better.");
        }
      },
      () => {
        setLocating(false);
        toast.error("Couldn't get your location. Allow location for this site and try again.");
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };
  const place = (x: number, y: number) => {
    if (!fix) return;
    setGeoPoints((pts) => [...pts, { x, y, ...fix }]);
    setFix(null);
  };
  const saveCalibration = async () => {
    try {
      const r = await save(geoPoints.map(({ x, y, lat, lng }) => ({ x, y, lat, lng })));
      toast.success(
        `Plan linked to GPS. Worst point is off by ${Math.round(Math.max(...r.residualM))} m.`,
      );
      setGeoPoints([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const panel = (
        <section className="card-pop bg-card p-5">
          <h2 className="text-xl font-extrabold">Link the plan to GPS</h2>
          <p className="mt-1 text-sm">
            Needed for "Use my location" and runner tracking. Stand somewhere you can
            find on the plan (a door, a stair, a hall entrance), tap <b>I'm here</b>,
            then click that place on the plan. Do this at two or more places at least
            20 m apart; three or four make it more accurate.
          </p>
          <p className="mt-2 text-xs font-bold">
            {venue.plan?.canvas.geo
              ? venue.plan.canvas.geo.approximate
                ? "Currently approximate (not calibrated on site)."
                : `Calibrated with ${venue.plan.canvas.geo.points.length} points.`
              : "Not linked to GPS yet."}
          </p>
          {geoPoints.length > 0 && (
            <ol className="mt-3 grid gap-1 text-sm">
              {geoPoints.map((p, i) => (
                <li key={i} className="font-mono text-xs">
                  {i + 1}. plan ({p.x.toFixed(1)}, {p.y.toFixed(1)}) ↔ {p.lat.toFixed(6)},{" "}
                  {p.lng.toFixed(6)}
                  {p.accuracyM !== undefined && ` ±${p.accuracyM} m`}
                  {residuals[i] !== undefined && ` · off by ${residuals[i]!.toFixed(1)} m`}
                </li>
              ))}
            </ol>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-sm bg-sun"
              disabled={locating}
              onClick={imHere}
            >
              {locating ? "Getting GPS…" : fix ? `Got it (±${fix.accuracyM} m): click the plan` : "📡 I'm here"}
            </button>
            <button
              type="button"
              className="btn btn-sm bg-coral"
              disabled={geoPoints.length < 2}
              onClick={() => void saveCalibration()}
            >
              Save {geoPoints.length} points
            </button>
            {geoPoints.length > 0 && (
              <button
                type="button"
                className="btn btn-sm bg-card"
                onClick={() => {
                  setGeoPoints([]);
                  setFix(null);
                }}
              >
                Start over
              </button>
            )}
          </div>
        </section>
  );

  return { awaitingClick: fix !== null, place, panel };
}
