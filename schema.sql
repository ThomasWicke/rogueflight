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
  data TEXT NOT NULL,       -- the run code as JSON: mods with levels, tunings, inventory, craft, weather, seed, flight log
                            --   (each flight: [contract, flight, score, distance, mult, snapshot]) and ev (buys, sells, rerolls, packs, storm rewards)
  run_id TEXT,              -- client:mode:seed; the client re-sends the run after every flight and the row is updated in place
  mode TEXT,                -- run, daily, team, elim
  flights INTEGER,          -- flights flown so far
  finished INTEGER,         -- 1 once the run ended (won, lost, abandoned, puzzle done, room left)
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS runs_created ON runs (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS runs_run_id ON runs (run_id);
-- added 2026-10-11 to an existing table with:
--   ALTER TABLE runs ADD COLUMN run_id TEXT; ... mode TEXT; ... flights INTEGER; ... finished INTEGER; ... updated_at TEXT;

-- daily puzzle leaderboard (server/worker.js): one row per browser and day; only the first submission counts
CREATE TABLE IF NOT EXISTS daily_scores (
  day INTEGER NOT NULL,     -- puzzle number (dailyNumber in sim.js)
  client TEXT NOT NULL,     -- random id per browser
  name TEXT,                -- nickname the player typed
  score INTEGER NOT NULL,
  data TEXT,                -- the run code as JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (day, client)
);
CREATE INDEX IF NOT EXISTS daily_rank ON daily_scores (day, score DESC);
