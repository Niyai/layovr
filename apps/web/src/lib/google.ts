/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Google Maps Platform, loaded only on pages that need it. Loading the script
 * is free; Google bills each map shown (Dynamic Maps) and each place lookup,
 * so maps open on a tap and place search asks for basic fields only.
 */

const KEY = import.meta.env["VITE_GOOGLE_MAPS_API_KEY"] as string | undefined;
const MAP_ID = import.meta.env["VITE_GOOGLE_MAPS_MAP_ID"] as string | undefined;

export const googleEnabled = () => Boolean(KEY);

/** Movable pins (Advanced Markers) need a Map ID; Google's demo ID works for local testing. */
export const googleMapId = () => MAP_ID || "DEMO_MAP_ID";

let loading: Promise<any> | null = null;

/** Loads the Maps JavaScript API once. Libraries come from google.maps.importLibrary(). */
export function loadGoogle(): Promise<any> {
  if (!KEY) return Promise.reject(new Error("No Google Maps key"));
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.google?.maps?.importLibrary) return resolve(w.google);
    w.__layovrMaps = () => resolve(w.google);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&loading=async&callback=__layovrMaps`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load Google Maps"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Opens Google Maps directions in the app or browser. A plain link, so Google doesn't bill it. */
export const directionsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

/** A marker's position as plain numbers (Google returns LatLng objects or literals). */
export function latLngOf(p: any): { lat: number; lng: number } {
  return typeof p.lat === "function" ? { lat: p.lat(), lng: p.lng() } : { lat: p.lat, lng: p.lng };
}
