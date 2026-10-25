import { openDb } from "./client";
import { dropAll, migrate } from "./migrate";
import { isEmpty, seed } from "./seed";
import { loadEnv } from "../lib/env";

/** npm run db:migrate | db:seed | db:reset (from apps/api or the repo root). */
const cmd = process.argv[2];
const env = loadEnv();
const db = await openDb({ databaseUrl: env.databaseUrl, dataDir: env.dataDir });

if (cmd === "reset") {
  await dropAll(db);
  console.info("[db] dropped all tables");
}
const applied = await migrate(db);
console.info(applied.length ? `[db] applied ${applied.join(", ")}` : "[db] schema up to date");
if (cmd === "seed" || cmd === "reset") {
  if (await isEmpty(db)) {
    await seed(db);
    console.info("[db] seeded demo data");
  } else {
    console.info("[db] already has data; use db:reset to start over");
  }
}
await db.close();
