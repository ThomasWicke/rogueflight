-- D1 schema for run telemetry. Apply once: in the Cloudflare dashboard (D1 -> rogueflight -> Console), or
--   npx wrangler d1 execute rogueflight --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  client TEXT,              -- random id per browser, no personal data
  version TEXT,             -- game build that played the run
  level INTEGER,            -- ceiling
  cleared INTEGER,          -- contracts cleared
  endless INTEGER,
  won INTEGER,
  data TEXT NOT NULL        -- the run code as JSON: mods with levels, tunings, inventory, craft, weather, flight log
);
CREATE INDEX IF NOT EXISTS runs_created ON runs (created_at);
