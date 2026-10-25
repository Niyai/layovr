import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

/**
 * One small interface over two Postgres drivers:
 * - DATABASE_URL set   → node-postgres pool (Supabase, Neon, any hosted Postgres)
 * - DATABASE_URL unset → PGlite, real Postgres compiled to WASM, stored in a folder.
 *   Nothing to install for local hosting.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export type Queryable = {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
};

export type Db = Queryable & {
  /** Runs fn in one transaction; rolls back if it throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Runs a multi-statement script (migrations). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  driver: "pglite" | "postgres";
};

// Return int8 (count/sum) and numeric as JS numbers; our values stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export async function openDb(opts: {
  databaseUrl?: string | undefined;
  dataDir?: string | undefined;
}): Promise<Db> {
  if (opts.databaseUrl) return openPostgres(opts.databaseUrl);
  return openPglite(opts.dataDir);
}

async function openPglite(dataDir?: string): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
  const wrap = (q: Pick<PGlite, "query">): Queryable => ({
    async query<T extends Row>(sql: string, params: unknown[] = []) {
      const res = await q.query<T>(sql, params);
      return res.rows;
    },
  });
  const base = wrap(db);
  return {
    driver: "pglite",
    query: base.query,
    tx: (fn) => db.transaction((t) => fn(wrap(t))),
    exec: async (sql) => {
      await db.exec(sql);
    },
    close: () => db.close(),
  };
}

async function openPostgres(url: string): Promise<Db> {
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    max: 5,
    ...(local ? {} : { ssl: { rejectUnauthorized: false } }),
  });
  const wrap = (c: pg.Pool | pg.PoolClient): Queryable => ({
    async query<T extends Row>(sql: string, params: unknown[] = []) {
      const res = await c.query(sql, params);
      return res.rows as T[];
    },
  });
  return {
    driver: "postgres",
    query: wrap(pool).query,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const out = await fn(wrap(client));
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback");
        throw e;
      } finally {
        client.release();
      }
    },
    exec: async (sql) => {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}
