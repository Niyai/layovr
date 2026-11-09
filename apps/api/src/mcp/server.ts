import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Ctx, PartnerAuth } from "../context";
import * as events from "../services/events";
import * as partners from "../services/partners";
import * as plans from "../services/plans";
import * as team from "../services/team";
import { TOOLS } from "./tools";

export const MCP_NAME = "layovr";
export const MCP_VERSION = "1.0.0";

/** Result text for the client: compact JSON the model can read. */
const text = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

/** One MCP server per request (stateless), acting for the API key's partner. */
function buildServer(ctx: Ctx, auth: PartnerAuth): McpServer {
  const server = new McpServer(
    { name: MCP_NAME, version: MCP_VERSION },
    {
      instructions:
        "Layovr runs close-proximity delivery at events: buyers scan a QR (or tap the venue map) and runners bring orders to their spot. " +
        "Use these tools to set up and run events: create an event from a venue template, edit its plan (areas, QR spots, entrances), add vendors and menus, add staff, publish, and watch orders. " +
        "Write tools return a preview first; show it to the user and only call again with confirm: true when they agree. Money is in kobo (₦1 = 100).",
    },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: !tool.write, destructiveHint: false, idempotentHint: !tool.write },
      },
      async (args: Record<string, unknown>) => {
        const previewOnly = tool.write && args.confirm !== true;
        try {
          const result = await tool.run(ctx, auth, args);
          await partners.audit(ctx.db, auth, `mcp.${tool.name}`, (args.eventId as string | undefined) ?? null, true, previewOnly ? { preview: true } : undefined);
          return text(result);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await partners.audit(ctx.db, auth, `mcp.${tool.name}`, (args.eventId as string | undefined) ?? null, false, { error: message });
          return text({ error: message }, true);
        }
      },
    );
  }

  server.registerResource(
    "plan",
    new ResourceTemplate("plan://{eventId}", {
      list: async () => ({
        resources: (await events.listEvents(ctx, auth)).map((e) => ({ uri: `plan://${e.id}`, name: `${e.name} plan`, mimeType: "application/json" })),
      }),
    }),
    { title: "Event plan", description: "An event's venue plan (layovr-plan/1)", mimeType: "application/json" },
    async (uri, { eventId }) => {
      const v = await events.partnerEvent(ctx.db, auth, String(eventId));
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await plans.exportPlan(ctx, v.id), null, 2) }] };
    },
  );

  server.registerResource(
    "menu",
    new ResourceTemplate("menu://{eventId}/{vendorId}", { list: undefined }),
    { title: "Vendor menu", description: "One vendor's stall details and menu", mimeType: "application/json" },
    async (uri, { eventId, vendorId }) => {
      const v = await events.partnerEvent(ctx.db, auth, String(eventId));
      const vendor = (await team.listVendors(ctx, v.id)).find((x) => x.id === String(vendorId));
      if (!vendor) throw new Error("Vendor not found");
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(vendor, null, 2) }] };
    },
  );

  server.registerPrompt(
    "set_up_my_event",
    {
      title: "Set up my event",
      description: "A guided interview that drafts an event, its venue plan, vendors and staff for review.",
      argsSchema: {
        eventName: z.string().optional().describe("What the event is called"),
        venue: z.string().optional().describe("Where it is, e.g. 'Landmark Centre'"),
      },
    },
    ({ eventName, venue }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Help me set up ${eventName ? `"${eventName}"` : "my event"} on Layovr${venue ? ` at ${venue}` : ""}.`,
              "Ask me one question at a time, in plain words:",
              "1. Event name and dates.",
              "2. The venue: find it with venue_templates_list, or start blank. Get the address (and coordinates if you can).",
              "3. Whether we bring our own runners or want Layovr to handle deliveries (and how many runners).",
              "4. Vendors and their menus (names, prices in naira).",
              "5. Who is on dispatch, and the runners' names and phone numbers.",
              "Then preview everything with the write tools (no confirm), show me a summary, and only apply with confirm: true when I say so.",
              "Finish with events_get to show the publishing checklist.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}

/** Handles one MCP HTTP request (Streamable HTTP, stateless, JSON responses). */
export async function handleMcp(ctx: Ctx, auth: PartnerAuth, request: Request): Promise<Response> {
  const server = buildServer(ctx, auth);
  // No sessionIdGenerator = stateless mode.
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // Stateless: nothing to keep once the response is built.
    void server.close();
  }
}

/** Public description for the docs page. */
export function mcpInfo(ctx: Ctx) {
  return {
    name: MCP_NAME,
    version: MCP_VERSION,
    transport: "streamable-http",
    url: `${ctx.env.publicAppUrl}/api/mcp`,
    auth: "Authorization: Bearer <partner API key>",
    tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, write: t.write })),
    resources: ["plan://{eventId}", "menu://{eventId}/{vendorId}"],
    prompts: ["set_up_my_event"],
  };
}
