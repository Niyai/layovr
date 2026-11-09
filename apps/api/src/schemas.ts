import { shapeSchema } from "@layovr/shared";
import type { Context } from "hono";
import { z } from "zod";
import { bad } from "./lib/errors";

/**
 * Request schemas, shared by the REST routes, the OpenAPI document and the MCP
 * tools, so all three always accept exactly the same input.
 */

export const id = z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const minutes = z.number().int().min(1).max(240);
export const kobo = z.number().int().min(0).max(100_000_000);
export const shortText = (max = 200) => z.string().trim().max(max);
export const image = z.string().max(3_000_000).optional();

export const schemas = {
  login: z.object({
    code: z.string().trim().toUpperCase().min(2).max(24).describe("Event code, e.g. MOONSHOT"),
    pin: z.string().regex(/^\d{4,6}$/),
  }),
  createOrder: z.object({
    venueId: id,
    spotId: id,
    name: shortText(80).min(1),
    phone: z.string().trim().regex(/^\+?[0-9 ]{10,15}$/, "Please enter a valid phone number."),
    email: z.string().trim().email().max(120).optional(),
    landmark: shortText(200).optional(),
    cart: z
      .array(z.object({ productId: id, qty: z.number().int().min(1).max(20), note: shortText(200).optional() }))
      .min(1, "Your basket is empty")
      .max(40),
    pinpoint: z
      .object({
        method: z.enum(["qr", "map", "gps", "list"]),
        x: z.number().finite().optional(),
        y: z.number().finite().optional(),
        level: z.number().int().optional(),
        accuracyM: z.number().min(0).max(100_000).optional(),
      })
      .optional(),
  }),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().min(0).max(100_000),
  }),
  geo: z.object({
    points: z
      .array(z.object({ x: z.number(), y: z.number(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }))
      .min(2)
      .max(8),
  }),
  verify: z.object({ transactionId: z.string().min(1).max(40) }),
  assign: z.object({ runnerId: id, etaMinutes: minutes }),
  eta: z.object({ etaMinutes: minutes }),
  purchase: z.object({
    stopId: id,
    amountKobo: kobo.min(1),
    method: z.enum(["cash", "transfer"]),
    receiptUrl: image,
  }),
  item: z.object({
    stopId: id,
    status: z.enum(["ok", "swapped", "dropped"]),
    finalPriceKobo: kobo.optional(),
    note: shortText().optional(),
  }),
  pin: z.object({ pin: z.string().regex(/^\d{4}$/) }),
  note: z.object({ note: shortText().min(1) }),
  reason: z.object({ reason: shortText().min(1) }),
  venue: z.object({
    name: shortText(120).min(1).optional(),
    city: shortText(120).optional(),
    feePct: z.number().min(0).max(0.5).optional(),
    feeFlatKobo: kobo.optional(),
    absorbLimitKobo: kobo.optional(),
    floorPlanUrl: z.string().max(3_000_000).optional(),
    isLive: z.boolean().optional(),
  }),
  zone: z.object({
    name: shortText(80).min(1).optional(),
    restricted: z.boolean().optional(),
    shape: shapeSchema.optional(),
  }),
  spot: z.object({
    id,
    venueId: z.string().optional(),
    zoneId: id,
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,24}$/, "Codes use letters, numbers and dashes"),
    label: shortText(120).min(1),
    x: z.number().min(0).max(100_000),
    y: z.number().min(0).max(100_000),
    landmark: shortText().optional(),
    directions: shortText(400).optional(),
    active: z.boolean(),
  }),
  vendor: z.object({
    id,
    venueId: z.string().optional(),
    name: shortText(80).min(1),
    emoji: shortText(16),
    category: shortText(60),
    description: shortText(400),
    zoneId: id.optional(),
    stallLabel: shortText(120).min(1),
    isOpen: z.boolean(),
    prepMinutes: z.number().int().min(0).max(240),
    fill: z.enum(["sun", "coral", "lilac", "mint", "blush", "card"]),
  }),
  product: z.object({
    id,
    vendorId: id,
    category: shortText(60).min(1),
    kind: z.enum(["goods", "service"]),
    name: shortText(120).min(1),
    description: shortText(400).optional(),
    priceKobo: kobo.min(1),
    priceCheckedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
    imageUrl: image,
    inStock: z.boolean(),
    fulfilment: z.enum(["deliver", "collect_and_return", "reserve_slot"]),
    durationMin: z.number().int().min(1).max(1440).optional(),
    ageRestricted: z.boolean().optional(),
  }),
  staff: z.object({
    onShift: z.boolean().optional(),
    floatKobo: kobo.optional(),
    canEnterRestricted: z.boolean().optional(),
  }),
};

/** Drops undefined keys so zod output fits exactOptionalPropertyTypes. */
export function clean<T extends object>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
}

export async function body<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  const json = await c.req.json().catch(() => {
    throw bad("Expected a JSON body");
  });
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw bad(parsed.error.issues[0]?.message ?? "Invalid request");
  }
  return parsed.data;
}

export const ip = (c: Context) =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
  c.req.header("x-real-ip") ??
  "local";


/* ------------------------------------------------------------------ partners */

const password = z.string().min(8, "Use at least 8 characters for your password").max(200);
const isoDate = z.string().datetime({ offset: true }).describe("ISO 8601 date-time");
const location = z.object({
  address: shortText(300).min(3),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  placeId: shortText(300).optional().describe("Google Place ID, when picked from Google Places"),
  city: shortText(120).optional(),
});

export const partnerSchemas = {
  signup: z.object({
    name: shortText(80).min(2).describe("Your name"),
    organisation: shortText(120).min(2),
    kind: z.enum(["event_planner", "venue", "ticketing", "airport", "other"]).default("event_planner"),
    email: z.string().trim().toLowerCase().email().max(160),
    password,
    phone: shortText(20).optional(),
  }),
  login: z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }),
  createEvent: z.object({
    name: shortText(120).min(3),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{2,23}$/, "Event codes use 3–24 letters, numbers and dashes")
      .optional()
      .describe("Short code staff type to sign in; generated from the name if left out"),
    startsAt: isoDate.optional(),
    endsAt: isoDate.optional(),
    location: location.optional(),
    templateCode: shortText(60).optional().describe("Venue library template, e.g. LANDMARK-CENTRE (GET /api/venue-templates)"),
    plan: z.unknown().optional().describe("A layovr-plan/1 file to start from instead of a template"),
    deliveryMode: z.enum(["own_runners", "layovr_runners"]).default("own_runners"),
    runnersNeeded: z.number().int().min(1).max(500).optional(),
    runnerRequestNote: shortText(500).optional(),
  }),
  updateEvent: z.object({
    name: shortText(120).min(3).optional(),
    startsAt: isoDate.nullable().optional(),
    endsAt: isoDate.nullable().optional(),
    location: location.optional(),
    feePct: z.number().min(0).max(0.5).optional(),
    feeFlatKobo: kobo.optional(),
    absorbLimitKobo: kobo.optional(),
    floorPlanUrl: z.string().max(3_000_000).optional().describe("Tracing image as a data URL, or empty to remove"),
    deliveryMode: z.enum(["own_runners", "layovr_runners"]).optional(),
    status: z.enum(["draft", "live", "ended"]).optional().describe("live = published to buyers"),
  }),
  runnerRequest: z.object({
    runnersNeeded: z.number().int().min(1).max(500),
    note: shortText(500).optional(),
  }),
  runnerDecision: z.object({
    decision: z.enum(["approve", "decline"]),
    note: shortText(500).optional(),
  }),
  vendor: z.object({
    name: shortText(80).min(1),
    emoji: shortText(16).default("🍽️"),
    category: shortText(60).default("Food & drink"),
    description: shortText(400).default(""),
    zoneId: id.optional(),
    stallLabel: shortText(120).default(""),
    isOpen: z.boolean().default(true),
    prepMinutes: z.number().int().min(0).max(240).default(8),
    fill: z.enum(["sun", "coral", "lilac", "mint", "blush", "card"]).default("card"),
    contactName: shortText(80).optional(),
    contactPhone: shortText(20).optional(),
  }),
  product: schemas.product.omit({ id: true, vendorId: true, priceCheckedAt: true }).extend({
    priceCheckedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  }),
  staff: z.object({
    name: shortText(80).min(1),
    role: z.enum(["admin", "dispatch", "runner", "capture"]),
    phone: shortText(20).default(""),
    canEnterRestricted: z.boolean().default(false),
    floatKobo: kobo.default(0),
    onShift: z.boolean().default(true),
  }),
  staffPatch: z.object({
    name: shortText(80).min(1).optional(),
    phone: shortText(20).optional(),
    canEnterRestricted: z.boolean().optional(),
    floatKobo: kobo.optional(),
    onShift: z.boolean().optional(),
  }),
  apiKey: z.object({
    name: shortText(80).min(1),
    scope: z.enum(["read", "write"]).default("write"),
  }),
  inviteMenu: z.object({
    vendor: z.object({
      name: shortText(80).min(1),
      emoji: shortText(16).default("🍽️"),
      category: shortText(60).default("Food & drink"),
      description: shortText(400).default(""),
      zoneId: id.optional(),
      stallLabel: shortText(120).min(1),
      prepMinutes: z.number().int().min(0).max(240).default(8),
      fill: z.enum(["sun", "coral", "lilac", "mint", "blush", "card"]).default("card"),
      contactName: shortText(80).optional(),
      contactPhone: shortText(20).optional(),
    }),
    items: z
      .array(schemas.product.omit({ id: true, vendorId: true, priceCheckedAt: true }))
      .max(100),
  }),
};

export const planQuery = z.object({
  dryRun: z.enum(["0", "1"]).optional().describe("1 = check only, don't apply"),
  prune: z.enum(["0", "1"]).optional().describe("1 = remove areas/spots missing from the file (spots with orders are deactivated)"),
});
