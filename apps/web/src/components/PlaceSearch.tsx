import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/ui-bits";
import { papi } from "@/lib/partnerApi";

export type PickedPlace = { address: string; lat: number; lng: number; placeId?: string; city?: string };

const GOOGLE_KEY = import.meta.env["VITE_GOOGLE_MAPS_API_KEY"] as string | undefined;

/* eslint-disable @typescript-eslint/no-explicit-any */
let googleLoading: Promise<any> | null = null;

/** Loads the Maps JavaScript API once (Places library, new Autocomplete element). */
function loadGoogle(key: string): Promise<any> {
  if (googleLoading) return googleLoading;
  googleLoading = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.google?.maps?.importLibrary) return resolve(w.google);
    w.__layovrMaps = () => resolve(w.google);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&libraries=places&callback=__layovrMaps`;
    s.async = true;
    s.onerror = () => reject(new Error("Couldn't load Google Maps"));
    document.head.appendChild(s);
  });
  return googleLoading;
}

/**
 * Where is the event? Google Places Autocomplete when VITE_GOOGLE_MAPS_API_KEY
 * is set; otherwise OpenStreetMap search through our API; or type it in.
 */
export function PlaceSearch({ value, onChange }: { value: PickedPlace | null; onChange: (p: PickedPlace) => void }) {
  const [mode, setMode] = useState<"google" | "osm" | "manual">(GOOGLE_KEY ? "google" : "osm");
  return (
    <div className="grid gap-3">
      {value && (
        <div className="rounded-2xl border-2 border-ink bg-mint/60 p-3 text-sm">
          <div className="font-bold">📍 {value.address}</div>
          <div className="font-mono text-xs">
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)} ·{" "}
            <a
              className="underline"
              target="_blank"
              rel="noreferrer"
              href={`https://www.google.com/maps/search/?api=1&query=${value.lat},${value.lng}`}
            >
              check on Google Maps
            </a>
          </div>
        </div>
      )}
      {mode === "google" && GOOGLE_KEY && <GooglePlaces apiKey={GOOGLE_KEY} onPick={onChange} onFail={() => setMode("osm")} />}
      {mode === "osm" && <OsmSearch onPick={onChange} />}
      {mode === "manual" && <ManualPlace value={value} onPick={onChange} />}
      <p className="text-xs">
        {mode !== "manual" ? (
          <button type="button" className="font-bold underline" onClick={() => setMode("manual")}>
            Enter the address and coordinates yourself
          </button>
        ) : (
          <button type="button" className="font-bold underline" onClick={() => setMode(GOOGLE_KEY ? "google" : "osm")}>
            Search for the place instead
          </button>
        )}
      </p>
    </div>
  );
}

function GooglePlaces({ apiKey, onPick, onFail }: { apiKey: string; onPick: (p: PickedPlace) => void; onFail: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let el: any;
    let cancelled = false;
    loadGoogle(apiKey)
      .then(async (google) => {
        if (cancelled || !host.current) return;
        const { PlaceAutocompleteElement } = await google.maps.importLibrary("places");
        el = new PlaceAutocompleteElement({ includedRegionCodes: ["ng"] });
        el.setAttribute("placeholder", "Search for the venue, e.g. Landmark Centre");
        el.addEventListener("gmp-select", async ({ placePrediction }: any) => {
          const place = placePrediction.toPlace();
          await place.fetchFields({ fields: ["displayName", "formattedAddress", "location", "id", "addressComponents"] });
          const city = place.addressComponents?.find((c: any) => c.types.includes("locality"))?.longText;
          onPick({
            address: place.formattedAddress ?? place.displayName,
            lat: place.location.lat(),
            lng: place.location.lng(),
            placeId: place.id,
            ...(city ? { city } : {}),
          });
        });
        host.current.replaceChildren(el);
      })
      .catch(onFail);
    return () => {
      cancelled = true;
      el?.remove();
    };
  }, [apiKey]);
  return (
    <div>
      <div ref={host} className="rounded-2xl border-2 border-ink bg-card p-1" />
      <p className="mt-1 text-xs text-muted-foreground">Powered by Google</p>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function OsmSearch({ onPick }: { onPick: (p: PickedPlace) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedPlace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      setResults(await papi<PickedPlace[]>(`/geo/search?q=${encodeURIComponent(q)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <input
          className="field flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
          placeholder="Venue name or address, e.g. Landmark Centre Oniru"
          aria-label="Search for the venue"
        />
        <button type="button" className="btn btn-sm bg-sun" disabled={q.trim().length < 3 || busy} onClick={() => void search()}>
          {busy ? "…" : "Search"}
        </button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {results && results.length === 0 && <p className="text-sm">No matches. Try a shorter name, or enter it yourself.</p>}
      {results && results.length > 0 && (
        <ul className="grid gap-1">
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button type="button" className="w-full rounded-xl border-2 border-ink/20 bg-card px-3 py-2 text-left text-sm hover:border-ink" onClick={() => onPick(r)}>
                {r.address}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Map data © OpenStreetMap contributors</p>
    </div>
  );
}

function ManualPlace({ value, onPick }: { value: PickedPlace | null; onPick: (p: PickedPlace) => void }) {
  const [address, setAddress] = useState(value?.address ?? "");
  const [coords, setCoords] = useState(value ? `${value.lat}, ${value.lng}` : "");
  const parsed = coords.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  return (
    <div className="grid gap-3">
      <Field label="Address">
        <input className="field" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Plot 3&4 Water Corporation Rd, Oniru, Lagos" />
      </Field>
      <Field label="Coordinates" hint="In Google Maps, right-click the venue and click the numbers to copy them">
        <input className="field font-mono" value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="6.4278, 3.4447" />
      </Field>
      <button
        type="button"
        className="btn btn-sm w-fit bg-sun"
        disabled={address.trim().length < 3 || !parsed}
        onClick={() => parsed && onPick({ address: address.trim(), lat: Number(parsed[1]), lng: Number(parsed[2]) })}
      >
        Use this location
      </button>
    </div>
  );
}
