import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Db } from "./client";

const DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

/** Applies migrations/NNN_name.sql in order, once each. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec(
    `create table if not exists schema_migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`,
  );
  const done = new Set(
    (await db.query<{ name: string }>("select name from schema_migrations")).map(
      (r) => r.name,
    ),
  );
  const applied: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(DIR + file, "utf8");
    await db.tx(async (q) => {
      // Statements one by one so this works inside a transaction on both drivers.
      for (const stmt of splitSql(sql)) await q.query(stmt);
      await q.query("insert into schema_migrations (name) values ($1)", [file]);
    });
    applied.push(file);
  }
  return applied;
}

/** Drops everything. Used by `npm run db:reset` and tests. */
export async function dropAll(db: Db): Promise<void> {
  await db.exec("drop schema public cascade; create schema public;");
}

function splitSql(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}
