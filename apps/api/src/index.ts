import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { openDb } from "./db/client";
import { migrate } from "./db/migrate";
import { isEmpty, seed } from "./db/seed";
import { loadEnv } from "./lib/env";
import { flutterwave } from "./lib/flutterwave";

const env = loadEnv();
const db = await openDb({ databaseUrl: env.databaseUrl, dataDir: env.dataDir });

const applied = await migrate(db);
if (applied.length) console.info(`[db] applied ${applied.join(", ")}`);
if (env.seedOnEmpty && (await isEmpty(db))) {
  await seed(db);
  console.info("[db] seeded demo data");
}

const app = createApp({
  db,
  env,
  gateway: env.flwSecretKey ? flutterwave(env.flwSecretKey) : null,
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.info(
    `[api] http://localhost:${info.port}/api  ·  db: ${
      db.driver === "pglite" ? `PGlite (${env.dataDir})` : "Postgres"
    }  ·  payments: ${env.flwSecretKey ? "Flutterwave" : "demo"}`,
  );
});

const shutdown = async () => {
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
