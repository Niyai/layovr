import type { Product, StaffRole, Vendor, VenuePlan } from "@layovr/shared";
import { QueryClient, useQuery } from "@tanstack/react-query";

/**
 * Partner dashboard data: typed calls to /api/partner/* with React Query.
 * (Buyer and event-staff screens use the live snapshot in store.ts instead.)
 */

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: false, refetchOnWindowFocus: true } },
});

export class PartnerApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function papi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? {} : { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new PartnerApiError(0, "No connection. Check your internet and try again.");
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new PartnerApiError(res.status, json?.error ?? "Something went wrong. Please try again.");
  return json as T;
}

/** Refetch everything under these keys after a change. */
export const refresh = (...keys: unknown[][]) =>
  Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));

/* ------------------------------------------------------------------ types */

export type PartnerMe = {
  user: { id: string; name: string; email: string; role: "owner" | "manager" | "operator" };
  partner: { id: string; name: string; kind: string };
};

export type EventSummary = {
  id: string;
  code: string;
  name: string;
  status: "draft" | "live" | "ended";
  startsAt: string | null;
  endsAt: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  templateCode: string | null;
  deliveryMode: "own_runners" | "layovr_runners";
  runnerRequest: { status: "none" | "requested" | "approved" | "declined"; runnersNeeded: number | null; note: string | null; reply: string | null };
  counts: { areas: number; spots: number; vendors: number; items: number; staff: number; orders: number };
};

export type EventDetail = EventSummary & {
  city: string;
  feePct: number;
  feeFlatKobo: number;
  absorbLimitKobo: number;
  floorPlanUrl: string | null;
  checklist: { key: string; label: string; done: boolean }[];
  buyerUrl: string;
};

export type VenueTemplate = {
  code: string;
  name: string;
  kind: "venue" | "generic";
  area?: string;
  lat?: number;
  lng?: number;
  capacity?: string;
  dataQuality: "measured" | "estimated" | "schematic";
  summary: string;
  sources: { label: string; url: string }[];
};

export type TeamVendor = Vendor & { contactName?: string; contactPhone?: string; products: Product[] };

export type TeamMember = {
  id: string;
  name: string;
  role: StaffRole;
  phone: string;
  canEnterRestricted: boolean;
  floatKobo: number;
  onShift: boolean;
  providedBy: "partner" | "layovr";
};

export type ApiKey = { id: string; name: string; prefix: string; scope: "read" | "write"; createdAt: string; lastUsedAt: string | null; revoked: boolean };

export type McpInfo = {
  name: string;
  version: string;
  url: string;
  tools: { name: string; title: string; description: string; write: boolean }[];
  resources: string[];
  prompts: string[];
};

export type PlanSaveResult = {
  ok: boolean;
  applied: boolean;
  errors: string[];
  warnings: string[];
  removedAreas?: number;
  removedSpots?: number;
  deactivatedSpots?: number;
};

/* ------------------------------------------------------------------ queries */

export const useMe = () =>
  useQuery({
    queryKey: ["me"],
    queryFn: () => papi<PartnerMe>("/partner/me"),
    retry: false,
  });

export const useEvents = () => useQuery({ queryKey: ["events"], queryFn: () => papi<EventSummary[]>("/partner/events") });
export const useEvent = (id: string) =>
  useQuery({ queryKey: ["events", id], queryFn: () => papi<EventDetail>(`/partner/events/${id}`) });
export const usePlan = (id: string) =>
  useQuery({ queryKey: ["events", id, "plan"], queryFn: () => papi<VenuePlan>(`/partner/events/${id}/plan`) });
export const useVendors = (id: string) =>
  useQuery({ queryKey: ["events", id, "vendors"], queryFn: () => papi<TeamVendor[]>(`/partner/events/${id}/vendors`) });
export const useStaff = (id: string) =>
  useQuery({ queryKey: ["events", id, "staff"], queryFn: () => papi<TeamMember[]>(`/partner/events/${id}/staff`) });
export const useTemplates = () =>
  useQuery({ queryKey: ["templates"], queryFn: () => papi<VenueTemplate[]>("/venue-templates"), staleTime: Infinity });
export const useKeys = () => useQuery({ queryKey: ["keys"], queryFn: () => papi<ApiKey[]>("/partner/keys") });
export const useRunnerRequests = () =>
  useQuery({ queryKey: ["runner-requests"], queryFn: () => papi<(EventSummary & { partnerName: string })[]>("/operator/runner-requests") });
export const useMcpInfo = () => useQuery({ queryKey: ["mcp-info"], queryFn: () => papi<McpInfo>("/mcp/info"), staleTime: Infinity });
export const useDemoLogins = () =>
  useQuery({
    queryKey: ["demo-logins"],
    queryFn: () => papi<{ label: string; email: string; password: string }[]>("/partner/demo-logins"),
    staleTime: Infinity,
  });
