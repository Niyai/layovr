import type { Ctx } from "../context";
import { HttpError } from "../lib/errors";

/**
 * Place search for when no Google Maps key is configured: OpenStreetMap's
 * Nominatim, called from the server. Nominatim's usage policy asks for at most
 * one request per second and an identifying User-Agent, so results are cached
 * and calls are spaced out.
 * https://operations.osmfoundation.org/policies/nominatim/
 */

export type PlaceResult = { address: string; lat: number; lng: number; city?: string; source: "osm" };

const cache = new Map<string, { at: number; results: PlaceResult[] }>();
let last = 0;

export async function searchPlaces(ctx: Ctx, query: string): Promise<PlaceResult[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < 24 * 3_600_000) return hit.results;

  const wait = last + 1_100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "ng");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  const fetcher = ctx.fetch ?? fetch;
  const res = await fetcher(url, {
    headers: { "User-Agent": ctx.env.geoUserAgent, "Accept-Language": "en" },
  }).catch(() => null);
  if (!res || !res.ok) throw new HttpError(502, "Place search is unavailable right now. Enter the address and pin by hand.");
  const json = (await res.json()) as {
    display_name: string;
    lat: string;
    lon: string;
    address?: { city?: string; town?: string; state?: string; suburb?: string };
  }[];
  const results: PlaceResult[] = json.map((r) => {
    const city = r.address?.city ?? r.address?.town ?? r.address?.state;
    return {
      address: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
      ...(city ? { city } : {}),
      source: "osm" as const,
    };
  });
  cache.set(q, { at: Date.now(), results });
  return results;
}
