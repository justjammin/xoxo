CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  effective_config_hash TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS candidates (
  run_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('x', 'y')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  config_json TEXT NOT NULL,
  PRIMARY KEY (run_id, side),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS run_cases (
  run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  trial INTEGER NOT NULL,
  PRIMARY KEY (run_id, case_id, trial),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  trial INTEGER NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('x', 'y')),
  state TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  exit_code INTEGER,
  output_artifact TEXT,
  error TEXT,
  UNIQUE(run_id, case_id, trial, side),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS assertion_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL,
  assertion_id TEXT NOT NULL,
  passed INTEGER NOT NULL,
  message TEXT NOT NULL,
  expected_json TEXT,
  actual_json TEXT,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS pair_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  trial INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  reason TEXT NOT NULL,
  result_json TEXT NOT NULL,
  UNIQUE(run_id, case_id, trial),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS judgments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  trial INTEGER NOT NULL,
  retry INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL,
  UNIQUE(run_id, case_id, trial, retry),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS events (
  attempt_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(attempt_id, sequence),
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS events_attempt_sequence ON events(attempt_id, sequence);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  attempt_id TEXT,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);
