import { fitGeo, nearestSpot } from "@layovr/shared";
import { useState } from "react";
import { FloorPlan, planFrame } from "@/components/FloorPlan";
import { SpotPicker } from "@/components/SpotPicker";
import type { DB, Pinpoint, Venue } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "map" | "gps" | "list";
type Candidate = { spotId: string; pinpoint: Pinpoint };

/** GPS fixes worse than this can't tell halls apart, so we ask the buyer to tap the map. */
const MAX_ACCURACY_M = 60;

/**
 * "Where are you?" without scanning a code: tap your position on the venue map,
 * let the phone's GPS suggest it, or pick from the list. Every route ends at a
 * spot (the delivery address) plus how the buyer located themselves.
 */
export function LocateMe({
  d,
  venue,
  value,
  onPick,
}: {
  d: DB;
  venue: Venue;
  value: string | undefined;
  onPick: (spotId: string, pinpoint: Pinpoint) => void;
}) {
  const zones = d.zones.filter((z) => z.venueId === venue.id);
  const spots = d.spots.filter((s) => s.venueId === venue.id && s.active);
  const { canvas, levels } = planFrame(venue, zones);
  const geoPoints = venue.plan?.canvas.geo?.points;
  const fit = geoPoints ? fitGeo(geoPoints) : null;
  const [tab, setTab] = useState<Tab>("map");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [gps, setGps] = useState<{ state: "idle" | "locating" } | { state: "note"; text: string }>({
    state: "idle",
  });
  /** A GPS fix too rough to use: shown on the map as a hint. */
  const [rough, setRough] = useState<{ x: number; y: number; level: number } | null>(null);

  const choose = (x: number, y: number, level: number | undefined, pinpoint: Pinpoint) => {
    const spot = nearestSpot(spots, zones, x, y, level);
    if (spot) setCandidate({ spotId: spot.id, pinpoint });
  };

  const findMe = () => {
    if (!fit || !("geolocation" in navigator)) return;
    setGps({ state: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const [x, y] = fit.toCanvas(pos.coords.latitude, pos.coords.longitude);
        const accuracyM = Math.round(pos.coords.accuracy);
        const inside = x >= 0 && y >= 0 && x <= canvas.width && y <= canvas.height;
        const ground = levels[0]!.level;
        if (!inside) {
          setGps({ state: "note", text: "You seem to be outside this venue. Tap where you are on the map instead." });
          setTab("map");
          return;
        }
        if (accuracyM > MAX_ACCURACY_M) {
          // Too rough to pick a hall: show it on the map and let the buyer tap.
          setGps({
            state: "note",
            text: `Your phone could only find you to within ${accuracyM} m. We've marked roughly where; tap your exact spot.`,
          });
          setCandidate(null);
          setTab("map");
          setRough({ x, y, level: ground });
          return;
        }
        setGps({ state: "idle" });
        choose(x, y, ground, { method: "gps", x, y, level: ground, accuracyM });
      },
      (err) =>
        setGps({
          state: "note",
          text:
            err.code === err.PERMISSION_DENIED
              ? "Location is blocked for this site. Tap where you are on the map instead."
              : "We couldn't get your location. Tap where you are on the map instead.",
        }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
    );
  };
  const picked = spots.find((s) => s.id === candidate?.spotId);
  const pin =
    candidate?.pinpoint.x !== undefined && candidate.pinpoint.y !== undefined
      ? {
          x: candidate.pinpoint.x,
          y: candidate.pinpoint.y,
          ...(candidate.pinpoint.level === undefined ? {} : { level: candidate.pinpoint.level }),
        }
      : (rough ?? undefined);

  return (
    <div className="grid gap-3">
      <div className="flex gap-1" role="tablist" aria-label="How to tell us where you are">
        {(
          [
            ["map", "🗺️ Tap the map"],
            ["gps", "📡 Use my location"],
            ["list", "📋 Choose from list"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 rounded-full border-2 border-ink px-2 py-1.5 text-xs font-bold sm:text-sm",
              tab === key ? "bg-sun" : "bg-card",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {gps.state === "note" && (
        <p className="rounded-xl border-2 border-ink bg-blush/50 p-2 text-sm" role="status">
          {gps.text}
        </p>
      )}

      {tab === "map" && (
        <FloorPlan
          venue={venue}
          zones={zones}
          spots={spots}
          {...(candidate ? { highlightSpotId: candidate.spotId } : {})}
          {...(pin ? { pin } : {})}
          onPlace={(x, y, level) => {
            setRough(null);
            choose(x, y, level, { method: "map", x, y, level });
          }}
          caption="Tap where you are. Use the floor buttons if you're upstairs."
        />
      )}

      {tab === "gps" &&
        (fit ? (
          <div className="grid gap-2 rounded-2xl border-2 border-ink bg-card p-4 text-sm">
            <p>
              We'll use your phone's location to find the nearest delivery spot. It
              works best outdoors and near doors; inside big halls, tap the map.
            </p>
            <button
              type="button"
              className="btn btn-sm w-fit bg-coral"
              disabled={gps.state === "locating"}
              onClick={findMe}
            >
              {gps.state === "locating" ? "Finding you…" : "📡 Find me"}
            </button>
          </div>
        ) : (
          <p className="rounded-2xl border-2 border-ink bg-card p-4 text-sm">
            This venue's map isn't linked to GPS yet. Tap where you are on the map
            instead.
          </p>
        ))}

      {tab === "list" && (
        <SpotPicker
          d={d}
          venueId={venue.id}
          value={value}
          onChange={(id) => onPick(id, { method: "list" })}
        />
      )}

      {candidate && picked && tab !== "list" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-ink bg-mint/60 p-3">
          <div className="text-sm">
            <div className="font-bold">📍 Near {picked.label}</div>
            {candidate.pinpoint.method === "gps" && (
              <div>From your location, accurate to about {candidate.pinpoint.accuracyM} m</div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-sm bg-coral"
            onClick={() => onPick(candidate.spotId, candidate.pinpoint)}
          >
            Deliver here
          </button>
        </div>
      )}
    </div>
  );
}
