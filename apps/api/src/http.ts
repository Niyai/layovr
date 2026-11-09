import type { Context, Handler, Hono } from "hono";
import type { z } from "zod";
import type { PartnerAuth, StaffRow } from "./context";
import { HttpError, bad, forbidden } from "./lib/errors";

export type AppEnv = {
  Variables: {
    staff: StaffRow | null;
    partner: PartnerAuth | null;
  };
};
export type C = Context<AppEnv>;

/** Who may call a route, as shown in the API docs. */
export type Access = "public" | "staff" | "partner" | "operator" | "invite" | "webhook";

export type RouteDoc = {
  method: "get" | "post" | "put" | "patch" | "delete";
  /** Hono path relative to /api, e.g. /partner/events/:id */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  access: Access;
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  /** Short description of the success response. */
  returns?: string;
};

/**
 * Registers a route on Hono and records its documentation in the same call,
 * so /api/openapi.json can't drift from what the server actually serves.
 */
export function router(app: Hono<AppEnv>) {
  const docs: RouteDoc[] = [];
  const add = (doc: RouteDoc, handler: Handler<AppEnv>) => {
    docs.push(doc);
    app.on(doc.method.toUpperCase(), doc.path, handler);
  };
  type Meta = Omit<RouteDoc, "method" | "path">;
  return {
    docs,
    get: (path: string, meta: Meta, h: Handler<AppEnv>) => add({ ...meta, method: "get", path }, h),
    post: (path: string, meta: Meta, h: Handler<AppEnv>) => add({ ...meta, method: "post", path }, h),
    put: (path: string, meta: Meta, h: Handler<AppEnv>) => add({ ...meta, method: "put", path }, h),
    patch: (path: string, meta: Meta, h: Handler<AppEnv>) => add({ ...meta, method: "patch", path }, h),
    delete: (path: string, meta: Meta, h: Handler<AppEnv>) => add({ ...meta, method: "delete", path }, h),
  };
}
export type Router = ReturnType<typeof router>;

export function requireStaff(c: C, ...roles: StaffRow["role"][]): StaffRow {
  const s = c.get("staff");
  if (!s) throw new HttpError(401, "Please sign in again");
  if (roles.length && !roles.includes(s.role)) throw forbidden();
  return s;
}

export function requirePartner(c: C): PartnerAuth {
  const p = c.get("partner");
  if (!p) {
    throw new HttpError(
      401,
      "Sign in to the dashboard, or send an API key as 'Authorization: Bearer lvk_…' (create one at /dashboard/keys).",
    );
  }
  return p;
}

export async function query<S extends z.ZodTypeAny>(c: C, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? "Invalid query");
  return parsed.data;
}

/** A path parameter (always present for the route it was declared on). */
export const param = (c: C, name: string): string => c.req.param(name) ?? "";
