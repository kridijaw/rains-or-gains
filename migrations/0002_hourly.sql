-- Hourly rollup of samples, so the dashboard never scans raw history. Kept current by every sample run.
CREATE TABLE hourly (
  branch_id INTEGER NOT NULL,
  hour_ts INTEGER NOT NULL, -- unix seconds UTC, start of the hour
  avg_pct REAL,
  max_pct INTEGER,
  n INTEGER NOT NULL, -- samples with a percentage; error rows and hidden gauges are not counted
  PRIMARY KEY (branch_id, hour_ts)
) WITHOUT ROWID;

INSERT INTO hourly (branch_id, hour_ts, avg_pct, max_pct, n)
SELECT branch_id, ts - ts % 3600, avg(percentage), max(percentage), count(percentage)
FROM samples
WHERE percentage IS NOT NULL AND hidden = 0
GROUP BY 1, 2;
