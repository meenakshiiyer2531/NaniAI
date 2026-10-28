// One-off migration runner. Reads POSTGRES_URL_NON_POOLING from the environment
// and executes a .sql file. Usage:
//   node --env-file=.env.local scripts/run-migration.mjs supabase/migrations/0001_init.sql
import { readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("usage: run-migration.mjs <path-to.sql>");
  process.exit(1);
}
const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL_NON_POOLING not set");
  process.exit(1);
}
const sql = readFileSync(file, "utf8");
// Strip query params (sslmode etc.) and force permissive TLS for the pooler's cert chain.
const base = url.split("?")[0];
const client = new pg.Client({ connectionString: base, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(sql);
  const r = await client.query(
    "select table_name from information_schema.tables where table_schema='public' and table_name='profiles'",
  );
  console.log("migration ok; profiles table present:", r.rowCount === 1);
} catch (e) {
  console.error("migration failed:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
