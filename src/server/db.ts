import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const dataDir = path.join(config.root, "data");
fs.mkdirSync(dataDir, { recursive: true });
export const db = new Database(path.join(dataDir, "arena.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS arenas (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  rules TEXT NOT NULL,
  rules_hash TEXT NOT NULL,
  vendors_json TEXT NOT NULL,
  ticket_price TEXT NOT NULL,
  min_pot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS versions (
  arena_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  policy TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  patch_json TEXT,
  evidence_hash TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (arena_id, version)
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY,
  arena_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  player TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  message_count INTEGER NOT NULL DEFAULT 0,
  purchase_tx TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tools_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attempts (
  ticket_id INTEGER PRIMARY KEY,
  transcript_hash TEXT NOT NULL,
  won INTEGER NOT NULL,
  reason TEXT NOT NULL,
  verdict_tx TEXT,
  patch_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arena_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chain_sync (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);
const messageColumns = new Set(
  (db.pragma("table_info(messages)") as { name: string }[]).map((c) => c.name),
);
if (!messageColumns.has("model"))
  db.exec("ALTER TABLE messages ADD COLUMN model TEXT");
if (!messageColumns.has("usage_json"))
  db.exec("ALTER TABLE messages ADD COLUMN usage_json TEXT");
const eventColumns = new Set(
  (db.pragma("table_info(events)") as { name: string }[]).map((c) => c.name),
);
if (!eventColumns.has("tx_hash"))
  db.exec("ALTER TABLE events ADD COLUMN tx_hash TEXT");
if (!eventColumns.has("log_index"))
  db.exec("ALTER TABLE events ADD COLUMN log_index INTEGER");
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS events_chain_unique ON events(tx_hash, log_index)",
);

export function event(arenaId: number, kind: string, payload: unknown) {
  const result = db
    .prepare(
      "INSERT INTO events (arena_id, kind, payload_json) VALUES (?, ?, ?)",
    )
    .run(arenaId, kind, JSON.stringify(payload));
  return Number(result.lastInsertRowid);
}
