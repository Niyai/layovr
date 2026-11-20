/* eslint-disable @typescript-eslint/no-explicit-any */
import { fitGeo, shapePoints, type GeoFit } from "@layovr/shared";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { planFrame, type PlanDot } from "@/components/FloorPlan";
import { googleEnabled, googleMapId, latLngOf, loadGoogle } from "@/lib/google";
import { buyerDots, runnerDots, vendorDots } from "@/lib/liveDots";
import type { Snapshot, Venue, Zone } from "@/lib/types";
import { cn } from "@/lib/utils";

type LatLng = { lat: number; lng: number };
export type MapOutline = { id: string; points: LatLng[]; color: string; dashed?: boolean };
export type MapMarker = LatLng & { id: string; icon: string; label: string };

/**
 * A Google map (satellite with labels) with an optional movable pin, plan
 * outlines and live markers. Only mounted when someone opens it, because
 * Google bills each map shown.
 */
export function VenueMap({
  center,
  zoom = 18,
  pin,
  outlines = [],
  markers = [],
  hint,
  className,
  children,
}: {
  center: LatLng;
  zoom?: number;
  pin?: LatLng & { onMove?: (p: LatLng) => void };
  outlines?: MapOutline[];
  markers?: MapMarker[];
  hint?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const g = useRef<{ google: any; map: any; Marker: any; Polygon: any } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!googleEnabled()) return;
    let cancelled = false;
    loadGoogle()
      .then(async (google) => {
        const { Map, Polygon } = await google.maps.importLibrary("maps");
        const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
        if (cancelled || !host.current) return;
        const map = new Map(host.current, {
          center,
          zoom,
          mapId: googleMapId(),
          mapTypeId: "hybrid",
          tilt: 0,
          streetViewControl: false,
          clickableIcons: false,
          gestureHandling: "cooperative",
        });
        g.current = { google, map, Marker: AdvancedMarkerElement, Polygon };
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
    // The map is created once; later prop changes update its pins and shapes below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The movable pin.
  const pinMarker = useRef<any>(null);
  const onMove = useRef(pin?.onMove);
  onMove.current = pin?.onMove;
  useEffect(() => {
    const cur = g.current;
    if (state !== "ready" || !cur) return;
    if (!pin) {
      if (pinMarker.current) pinMarker.current.map = null;
      pinMarker.current = null;
      return;
    }
    if (!pinMarker.current) {
      pinMarker.current = new cur.Marker({ map: cur.map, position: pin, gmpDraggable: Boolean(pin.onMove), title: "Drag to move" });
      pinMarker.current.addListener("dragend", () => onMove.current?.(latLngOf(pinMarker.current.position)));
    } else {
      pinMarker.current.position = { lat: pin.lat, lng: pin.lng };
    }
  }, [state, pin?.lat, pin?.lng, Boolean(pin)]);

  // Plan outlines.
  const shapes = useRef<any[]>([]);
  const fitted = useRef(false);
  useEffect(() => {
    const cur = g.current;
    if (state !== "ready" || !cur) return;
    for (const s of shapes.current) s.setMap(null);
    shapes.current = outlines.map(
      (o) =>
        new cur.Polygon({
          map: cur.map,
          paths: o.points,
          strokeColor: o.color,
          strokeOpacity: o.dashed ? 0.6 : 1,
          strokeWeight: o.dashed ? 1 : 2,
          fillColor: o.color,
          fillOpacity: o.dashed ? 0 : 0.2,
          clickable: false,
        }),
    );
    if (!fitted.current && outlines.length) {
      fitted.current = true;
      const b = new cur.google.maps.LatLngBounds();
      for (const o of outlines) for (const p of o.points) b.extend(p);
      cur.map.fitBounds(b, 24);
    }
  }, [state, outlines]);

  // Live markers.
  const live = useRef<any[]>([]);
  useEffect(() => {
    const cur = g.current;
    if (state !== "ready" || !cur) return;
    for (const m of live.current) m.map = null;
    live.current = markers.map((m) => {
      const el = document.createElement("div");
      el.className = "rounded-full border-2 border-ink bg-card px-2 py-0.5 text-xs font-bold shadow";
      el.textContent = `${m.icon} ${m.label}`;
      return new cur.Marker({ map: cur.map, position: { lat: m.lat, lng: m.lng }, content: el, title: m.label });
    });
  }, [state, markers]);

  if (!googleEnabled()) {
    return (
      <p className={cn("rounded-2xl border-2 border-dashed border-ink/40 p-4 text-sm", className)}>
        The street map isn't switched on. Add a Google Maps key (VITE_GOOGLE_MAPS_API_KEY) to show it here.
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      {hint && <p className="text-sm">{hint}</p>}
      <div className={cn("relative overflow-hidden rounded-2xl border-2 border-ink", className ?? "h-80")}>
        <div ref={host} className="absolute inset-0" />
        {state !== "ready" && (
          <div className="absolute inset-0 grid place-items-center bg-card text-sm">
            {state === "loading" ? "Loading map…" : "Couldn't load Google Maps. Check the key and that it allows this site."}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** The venue plan's ground-floor areas (plus areas on every floor) as map outlines. */
export function planOutlines(venue: Venue, zones: Zone[], fit: GeoFit, sectionColor?: Map<string, string>): MapOutline[] {
  const { canvas, levels } = planFrame(venue, zones);
  const ground = levels[0]!.level;
  const toGeo = (p: [number, number]): LatLng => {
    const [lat, lng] = fit.toGeo(p[0], p[1]);
    return { lat, lng };
  };
  const frame: MapOutline = {
    id: "canvas",
    color: "#ffffff",
    dashed: true,
    points: ([[0, 0], [canvas.width, 0], [canvas.width, canvas.height], [0, canvas.height]] as [number, number][]).map(toGeo),
  };
  return [
    frame,
    ...zones
      .filter((z) => z.level === undefined || z.level === ground)
      .map((z) => ({
        id: z.id,
        color: (z.section && sectionColor?.get(z.section)) || "#F2C230",
        points: shapePoints(z.shape).map(toGeo),
      })),
  ];
}

/** Plan dots (canvas units) placed on the map. */
const dotsToMarkers = (dots: PlanDot[], fit: GeoFit): MapMarker[] =>
  dots.map((dot) => {
    const [lat, lng] = fit.toGeo(dot.x, dot.y);
    return { id: dot.id, lat, lng, icon: dot.icon ?? "•", label: dot.label };
  });

/**
 * "Street map": the plan outline on Google's satellite map with everyone live,
 * for when people are outside the plan's edge (car parks, outdoor grounds).
 * Shown only for plans linked to GPS. With focusOrderId, only that buyer.
 */
export function StreetMapButton({ venue, d, focusOrderId }: { venue: Venue; d: Snapshot; focusOrderId?: string }) {
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => d.zones.filter((z) => z.venueId === venue.id), [d.zones, venue.id]);
  const fit = useMemo(() => (venue.plan?.canvas.geo ? fitGeo(venue.plan.canvas.geo.points) : null), [venue.plan]);
  const sectionColor = useMemo(
    () => new Map((venue.plan?.sections ?? []).map((s) => [s.code, s.color ?? "#F2C230"])),
    [venue.plan],
  );
  const outlines = useMemo(() => (fit ? planOutlines(venue, zones, fit, sectionColor) : []), [fit, venue, zones, sectionColor]);
  if (!fit || !googleEnabled()) return null;
  const centre = fit.toGeo((venue.plan?.canvas.width ?? 100) / 2, (venue.plan?.canvas.height ?? 75) / 2);
  const markers = dotsToMarkers(
    [
      ...(focusOrderId ? [] : runnerDots(d)),
      ...buyerDots(d, focusOrderId ? [focusOrderId] : undefined),
      ...vendorDots(d, venue.id),
    ],
    fit,
  );
  return (
    <>
      <button type="button" className="btn btn-sm bg-card" onClick={() => setOpen((x) => !x)}>
        {open ? "Hide street map" : "🛰️ Street map"}
      </button>
      {open && (
        <div className="basis-full">
          <VenueMap center={{ lat: centre[0], lng: centre[1] }} outlines={outlines} markers={markers} className="h-80" />
        </div>
      )}
    </>
  );
}
