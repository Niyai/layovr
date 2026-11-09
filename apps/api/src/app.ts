import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import type { Ctx, StaffRow } from "./context";
import { router, type AppEnv, type RouteDoc } from "./http";
import { SESSION_COOKIE, readSession } from "./lib/auth";
import { HttpError } from "./lib/errors";
import { handleMcp, mcpInfo } from "./mcp/server";
import { DOCS_HTML, buildOpenApi } from "./openapi";
import { PARTNER_COOKIE, partnerRoutes } from "./routes/partner";
import { publicRoutes } from "./routes/public";
import { staffRoutes } from "./routes/staff";
import * as partners from "./services/partners";

export type App = Hono<AppEnv> & { docs: RouteDoc[] };

export function createApp(ctx: Ctx): App {
  const app = new Hono<AppEnv>().basePath("/api");

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error("[api]", err);
    return c.json({ error: "Something went wrong. Please try again." }, 500);
  });

  // Photos arrive as compressed data URLs; nothing legitimate is bigger than this.
  app.use(bodyLimit({ maxSize: 4 * 1024 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) }));

  // Who is calling: event staff (cookie), a partner user (cookie) or a partner API key (Bearer).
  app.use(async (c, next) => {
    const staffId = readSession(getCookie(c, SESSION_COOKIE), ctx.env.sessionSecret);
    let staff: StaffRow | null = null;
    if (staffId && !staffId.startsWith("p:")) {
      const [row] = await ctx.db.query<StaffRow>("select * from staff where id = $1", [staffId]);
      staff = row ?? null;
    }
    c.set("staff", staff);

    const bearer = c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (bearer) {
      const channel = c.req.path.startsWith("/api/mcp") ? "mcp" : "api";
      c.set("partner", await partners.authForKey(ctx.db, bearer, channel));
    } else {
      const token = readSession(getCookie(c, PARTNER_COOKIE), ctx.env.sessionSecret);
      c.set("partner", token?.startsWith("p:") ? await partners.authForUser(ctx.db, token.slice(2)) : null);
    }
    await next();
  });

  const r = router(app);
  publicRoutes(r, ctx);
  staffRoutes(r, ctx);
  partnerRoutes(r, ctx);

  /* ---------------------------------------------------------- MCP */

  r.get("/mcp/info", { tag: "MCP", summary: "MCP server details and tool list (for set-up pages)", access: "public" }, (c) =>
    c.json(mcpInfo(ctx)),
  );

  const mcpDoc = {
    tag: "MCP",
    summary: "Model Context Protocol endpoint (Streamable HTTP)",
    description:
      "Connect Claude, Cursor, VS Code or your own platform. Send `Authorization: Bearer <API key>`. Tools mirror this API; write tools preview unless called with confirm: true.",
    access: "partner" as const,
  };
  const mcp = async (c: Parameters<Parameters<typeof r.post>[2]>[0]) => {
    const auth = c.get("partner");
    if (!auth || auth.channel !== "mcp") {
      return c.json(
        { error: "Send a partner API key as 'Authorization: Bearer lvk_…'. Create one at /dashboard/keys; set-up guide at /developers." },
        401,
        { "WWW-Authenticate": 'Bearer realm="Layovr"' },
      );
    }
    return handleMcp(ctx, auth, c.req.raw);
  };
  r.post("/mcp", mcpDoc, mcp);
  r.get("/mcp", { ...mcpDoc, summary: "MCP endpoint (GET: server-sent events; not used in stateless mode)" }, mcp);
  r.delete("/mcp", { ...mcpDoc, summary: "MCP endpoint (DELETE: end session; not used in stateless mode)" }, mcp);

  /* ---------------------------------------------------------- docs */

  r.get("/openapi.json", { tag: "System", summary: "This API as an OpenAPI 3.1 document", access: "public" }, (c) =>
    c.json(buildOpenApi(r.docs, ctx.env)),
  );
  r.get("/docs", { tag: "System", summary: "Interactive API reference", access: "public" }, (c) => c.html(DOCS_HTML));

  return Object.assign(app, { docs: r.docs });
}
