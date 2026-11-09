import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import type { Env } from "./lib/env";
import type { Access, RouteDoc } from "./http";

/**
 * OpenAPI 3.1 document built from the route registry (src/http.ts) and the zod
 * schemas the server validates with, so the docs always match the server.
 */

const TAGS: { name: string; description: string }[] = [
  { name: "Partner account", description: "Sign up, sign in, and who you are." },
  { name: "Events", description: "Create events, set location, fees and deliveries, and publish." },
  { name: "Venue plan", description: "The event map in the layovr-plan/1 standard: floors, areas, QR spots, entrances." },
  { name: "Venue library", description: "Starting plans for popular Lagos venues and generic layouts." },
  { name: "Vendors", description: "Stalls and menus, and self-service invite links for vendors." },
  { name: "Staff", description: "Runners, dispatchers, on-site admins and menu capture staff." },
  { name: "API keys", description: "Keys for the headless API and MCP." },
  { name: "Layovr operators", description: "Layovr's own team: runner requests." },
  { name: "Buyer app", description: "What the buyer web app uses: snapshot, live feed, checkout, tracking." },
  { name: "Event staff", description: "Staff sign-in (event code + PIN)." },
  { name: "Dispatch & runners", description: "Order handling during the event." },
  { name: "On-site admin", description: "Venue admin and menu capture at the event." },
  { name: "Vendor invites", description: "Pages opened from a vendor's invite link." },
  { name: "Places", description: "Address search fallback." },
  { name: "Payments", description: "Payment provider callbacks." },
  { name: "MCP", description: "Model Context Protocol server for AI assistants and event platforms." },
  { name: "System", description: "Health and documentation." },
];

const SECURITY: Record<Access, Record<string, string[]>[] | undefined> = {
  public: [],
  partner: [{ apiKey: [] }, { partnerSession: [] }],
  operator: [{ apiKey: [] }, { partnerSession: [] }],
  staff: [{ staffSession: [] }],
  invite: [],
  webhook: [{ flutterwaveHash: [] }],
};

function schema(s: z.ZodTypeAny) {
  const out = zodToJsonSchema(s, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
  delete out["$schema"];
  return out;
}

function queryParams(s: z.ZodTypeAny | undefined) {
  if (!s) return [];
  const json = schema(s) as { properties?: Record<string, { description?: string }>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, prop]) => ({
    name,
    in: "query",
    required: json.required?.includes(name) ?? false,
    schema: prop,
    ...(prop.description ? { description: prop.description } : {}),
  }));
}

export function buildOpenApi(docs: RouteDoc[], env: Env) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const d of docs) {
    const path = d.path.replace(/:([A-Za-z]+)/g, "{$1}");
    const pathParams = [...d.path.matchAll(/:([A-Za-z]+)/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    paths[path] ??= {};
    paths[path][d.method] = {
      tags: [d.tag],
      summary: d.summary,
      ...(d.description ? { description: d.description } : {}),
      operationId: `${d.method}${path.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+(.)?/g, (_, ch: string | undefined) => (ch ? ch.toUpperCase() : ""))}`,
      security: SECURITY[d.access],
      parameters: [...pathParams, ...queryParams(d.query)],
      ...(d.body
        ? { requestBody: { required: true, content: { "application/json": { schema: schema(d.body) } } } }
        : d.path.endsWith("/plan") && d.method !== "get"
          ? { requestBody: { required: true, content: { "application/json": { schema: { type: "object", description: "A layovr-plan/1 file" } } } } }
          : {}),
      responses: {
        "200": { description: d.returns ?? "OK" },
        "400": { description: "Invalid input: { error }" },
        ...(d.access === "public" ? {} : { "401": { description: "Not signed in / missing or revoked API key" } }),
        "404": { description: "Not found, or not yours" },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Layovr API",
      version: "1.0.0",
      description: [
        "Close-proximity delivery for events, venues and airports. Event planners and platforms create events, map venues, onboard vendors and staff, and follow orders.",
        "",
        "**Authentication.** Create an API key in the dashboard (`/dashboard/keys`) and send it as `Authorization: Bearer lvk_…`. The dashboard itself uses a session cookie.",
        "",
        "**MCP.** The same capabilities are available to AI assistants and event platforms over the Model Context Protocol at `/api/mcp` (Streamable HTTP, same API key). See `/developers` for set-up.",
        "",
        "**Plans.** Venue maps use the layovr-plan/1 format; start from `GET /venue-templates` or the template in docs/templates.",
        "",
        "Money is always integer kobo (₦1 = 100 kobo).",
      ].join("\n"),
    },
    servers: [{ url: `${env.publicAppUrl}/api`, description: "This server" }],
    tags: TAGS,
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", description: "Partner API key: lvk_…" },
        partnerSession: { type: "apiKey", in: "cookie", name: "lv_partner" },
        staffSession: { type: "apiKey", in: "cookie", name: "lv_staff" },
        flutterwaveHash: { type: "apiKey", in: "header", name: "verif-hash" },
      },
    },
    paths,
  };
}

/** API reference page (Scalar), loaded from jsDelivr at a pinned version. */
export const DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Layovr API reference</title>
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="app"></div>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.75.1"></script>
  <script>
    Scalar.createApiReference("#app", {
      url: "/api/openapi.json",
      metaData: { title: "Layovr API reference" },
      hideDownloadButton: false,
    });
  </script>
</body>
</html>`;
