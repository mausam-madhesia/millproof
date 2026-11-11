// Tiny database adapter: Postgres when DATABASE_URL is set (Render), SQLite file otherwise (laptop).
// All SQL in the app uses "?" placeholders and portable types; the adapter converts for Postgres.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import pg from "pg";
import { config } from "./config.js";

export interface Db {
  dialect: "sqlite" | "pg";
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

const SCHEMA_COMMON = `
CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  share_token TEXT NOT NULL UNIQUE,
  supplier TEXT NOT NULL,
  supplier_key TEXT NOT NULL,
  heat_number TEXT NOT NULL,
  heat_key TEXT NOT NULL,
  spec_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  data TEXT NOT NULL,
  check_json TEXT NOT NULL,
  decision_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cert_supplier ON certificates(supplier_key);
CREATE INDEX IF NOT EXISTS idx_cert_heat ON certificates(heat_key);
`;
const EVENTS_SQLITE = `CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cert_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, field TEXT, old_value TEXT, new_value TEXT, note TEXT);
CREATE INDEX IF NOT EXISTS idx_events_cert ON events(cert_id);`;
const EVENTS_PG = `CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY, cert_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, field TEXT, old_value TEXT, new_value TEXT, note TEXT);
CREATE INDEX IF NOT EXISTS idx_events_cert ON events(cert_id);`;

function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function openPg(url: string): Promise<Db> {
  // Render's Internal Database URL uses a dot-less host (e.g. dpg-abc123-a) and needs no TLS;
  // the External URL (…render.com) does. PGSSL=true|false overrides.
  let host = "";
  try { host = new URL(url).hostname; } catch { /* keyword-style connection string */ }
  const wantSsl = process.env.PGSSL ? process.env.PGSSL === "true" : host.includes(".") && !/^(localhost|127\.0\.0\.1)$/.test(host);
  const pool = new pg.Pool({ connectionString: url, ssl: wantSsl ? { rejectUnauthorized: false } : false, max: 5 });
  await pool.query(SCHEMA_COMMON + EVENTS_PG);
  const make = (runner: pg.Pool | pg.PoolClient): Db => {
    const q = (sql: string, params: unknown[] = []) => runner.query(toPg(sql), params as unknown[]);
    return {
      dialect: "pg",
      async all(sql, params) { return (await q(sql, params)).rows; },
      async get(sql, params) { return (await q(sql, params)).rows[0]; },
      async run(sql, params) { await q(sql, params); },
      async tx(fn) { return fn(this); },
    };
  };
  const db = make(pool);
  db.tx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(make(client));
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  };
  return db;
}

function openSqlite(file: string): Db {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_COMMON + EVENTS_SQLITE);
  const self: Db = {
    dialect: "sqlite",
    async all(sql, params = []) { return db.prepare(sql).all(...params) as never[]; },
    async get(sql, params = []) { return db.prepare(sql).get(...params) as never; },
    async run(sql, params = []) { db.prepare(sql).run(...params); },
    async tx(fn) {
      db.exec("BEGIN");
      try {
        const out = await fn(self);
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return self;
}

let instance: Db | null = null;
export async function getDb(): Promise<Db> {
  if (instance) return instance;
  instance = config.databaseUrl ? await openPg(config.databaseUrl) : openSqlite(config.sqlitePath);
  console.log(`[db] using ${instance.dialect === "pg" ? "Postgres (DATABASE_URL)" : `SQLite at ${config.sqlitePath}`}`);
  return instance;
}
