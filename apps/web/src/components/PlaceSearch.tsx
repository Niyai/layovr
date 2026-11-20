import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/ui-bits";
import { VenueMap } from "@/components/VenueMap";
import { googleEnabled, loadGoogle } from "@/lib/google";
import { papi } from "@/lib/partnerApi";

export type PickedPlace = { address: string; lat: number; lng: number; placeId?: string; city?: string };

const GOOGLE_KEY = googleEnabled();

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Where is the event? Google Places Autocomplete when VITE_GOOGLE_MAPS_API_KEY
 * is set; otherwise OpenStreetMap search through our API; or type it in.
 */
export function PlaceSearch({ value, onChange }: { value: PickedPlace | null; onChange: (p: PickedPlace) => void }) {
  const [mode, setMode] = useState<"google" | "osm" | "manual">(GOOGLE_KEY ? "google" : "osm");
  const [adjust, setAdjust] = useState(false);
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
          {GOOGLE_KEY && (
            <button type="button" className="mt-2 font-bold underline" onClick={() => setAdjust((x) => !x)}>
              {adjust ? "Done adjusting" : "Adjust the pin on a map"}
            </button>
          )}
        </div>
      )}
      {value && adjust && (
        <VenueMap
          center={value}
          pin={{ ...value, onMove: (p) => onChange({ ...value, ...p }) }}
          hint="Drag the pin onto the venue's main entrance or building."
          className="h-72"
        />
      )}
      {mode === "google" && GOOGLE_KEY && <GooglePlaces onPick={onChange} onFail={() => setMode("osm")} />}
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

function GooglePlaces({ onPick, onFail }: { onPick: (p: PickedPlace) => void; onFail: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let el: any;
    let cancelled = false;
    loadGoogle()
      .then(async (google) => {
        if (cancelled || !host.current) return;
        const { PlaceAutocompleteElement } = await google.maps.importLibrary("places");
        el = new PlaceAutocompleteElement({ includedRegionCodes: ["ng"] });
        el.setAttribute("placeholder", "Search for the venue, e.g. Landmark Centre");
        el.addEventListener("gmp-select", async ({ placePrediction }: any) => {
          const place = placePrediction.toPlace();
          // Basic fields only (Place Details Essentials). The name comes free with the suggestion;
          // asking Google for displayName would bill the pricier Pro lookup.
          await place.fetchFields({ fields: ["formattedAddress", "location", "id", "addressComponents"] });
          const city = place.addressComponents?.find((c: any) => c.types.includes("locality"))?.longText;
          const name: string | undefined = placePrediction.mainText?.text;
          const address: string = place.formattedAddress ?? name ?? "";
          onPick({
            address: name && !address.startsWith(name) ? `${name}, ${address}` : address,
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
  }, []);
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
