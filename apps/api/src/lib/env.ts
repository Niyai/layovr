import { fileURLToPath } from "node:url";

const get = (key: string): string | undefined => {
  const v = process.env[key];
  return v && v.trim().length > 0 ? v.trim() : undefined;
};
const flag = (key: string, fallback: boolean): boolean => {
  const v = get(key);
  return v === undefined ? fallback : ["1", "true", "yes"].includes(v.toLowerCase());
};

const production = process.env["NODE_ENV"] === "production";

export type Env = {
  production: boolean;
  port: number;
  databaseUrl: string | undefined;
  dataDir: string | undefined;
  sessionSecret: string;
  flwSecretKey: string | undefined;
  flwSecretHash: string | undefined;
  publicAppUrl: string;
  showDemoPins: boolean;
  allowReset: boolean;
  seedOnEmpty: boolean;
};

export function loadEnv(): Env {
  const sessionSecret = get("SESSION_SECRET") ?? "dev-only-secret-change-me";
  if (production && sessionSecret === "dev-only-secret-change-me") {
    throw new Error("Set SESSION_SECRET before running in production");
  }
  return {
    production,
    port: Number(get("PORT") ?? 8787),
    databaseUrl: get("DATABASE_URL"),
    dataDir:
      get("PGLITE_DIR") ??
      fileURLToPath(new URL("../../.data/pglite", import.meta.url)),
    sessionSecret,
    flwSecretKey: get("FLW_SECRET_KEY"),
    flwSecretHash: get("FLW_SECRET_HASH"),
    publicAppUrl: (get("PUBLIC_APP_URL") ?? "http://localhost:8080").replace(/\/$/, ""),
    showDemoPins: flag("SHOW_DEMO_PINS", !production),
    allowReset: flag("ALLOW_DEMO_RESET", !production),
    seedOnEmpty: flag("SEED_ON_EMPTY", true),
  };
}
