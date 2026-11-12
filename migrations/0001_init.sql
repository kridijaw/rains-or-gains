CREATE TABLE samples (
  branch_id INTEGER NOT NULL,
  ts INTEGER NOT NULL, -- unix seconds UTC, the cron's scheduled minute
  percentage INTEGER, -- can exceed 100
  term TEXT,
  source TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  status INTEGER,
  error TEXT, -- set when the fetch failed; the other columns are then NULL
  PRIMARY KEY (branch_id, ts)
) WITHOUT ROWID;

CREATE TABLE studios (
  branch_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  alias TEXT NOT NULL,
  lat REAL,
  lon REAL,
  updated_at INTEGER NOT NULL
);

-- The studio page's 7x24 historical averages, stored only when they change.
CREATE TABLE profiles (
  branch_id INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  data TEXT NOT NULL, -- JSON [weekday 0=Mon..6=Sun][hour 0..23]
  PRIMARY KEY (branch_id, fetched_at)
);
