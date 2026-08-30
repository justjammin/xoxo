import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AttemptState, Candidate, DeterministicGrade, NormalizedEvent, RunConfig, RunState } from "../../domain/index.ts";
import type { ArtifactRecord } from "../artifacts/store.ts";

export type RunRecord = { id: string; suiteId: string; config: RunConfig; state: RunState; createdAt: string; updatedAt: string; effectiveConfigHash?: string; error?: string };
export type AttemptRecord = { id: string; runId: string; caseId: string; trial: number; side: "x" | "y"; state: AttemptState; startedAt?: string; finishedAt?: string; exitCode?: number; outputArtifact?: string; error?: string };
export type StoredEvent = NormalizedEvent & { attemptId: string };

function json(value: unknown): string { return JSON.stringify(value); }
function unjson<T>(value: string | null | undefined): T | undefined { return value == null ? undefined : JSON.parse(value) as T; }
function now(): string { return new Date().toISOString(); }

export class XoxoDatabase {
  readonly db: Database;
  constructor(path = ".xoxo/state.sqlite") {
    const filename = resolve(path);
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new Database(filename, { create: true, readwrite: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }
  migrate(): void {
    const migration = readFileSync(new URL("../../../migrations/001_initial.sql", import.meta.url), "utf8");
    const version = 1;
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);");
    const applied = this.db.query<{ version: number }, [number]>("SELECT version FROM schema_migrations WHERE version = ?").get(version);
    if (!applied) {
      this.db.exec(migration);
      this.db.query("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, now());
    }
  }
  close(): void { this.db.close(); }

  createRun(run: { id: string; suiteId: string; config: RunConfig; state?: RunState; effectiveConfigHash?: string }): RunRecord {
    const timestamp = now();
    const state = run.state ?? "queued";
    this.db.query("INSERT INTO runs (id, suite_id, config_json, state, created_at, updated_at, effective_config_hash) VALUES (?, ?, ?, ?, ?, ?, ?)").run(run.id, run.suiteId, json(run.config), state, timestamp, timestamp, run.effectiveConfigHash ?? null);
    return { id: run.id, suiteId: run.suiteId, config: run.config, state, createdAt: timestamp, updatedAt: timestamp, effectiveConfigHash: run.effectiveConfigHash };
  }
  getRun(id: string): RunRecord | undefined {
    const row = this.db.query<Record<string, unknown>, [string]>("SELECT * FROM runs WHERE id = ?").get(id);
    if (!row) return undefined;
    return { id: String(row.id), suiteId: String(row.suite_id), config: JSON.parse(String(row.config_json)) as RunConfig, state: String(row.state) as RunState, createdAt: String(row.created_at), updatedAt: String(row.updated_at), effectiveConfigHash: row.effective_config_hash ? String(row.effective_config_hash) : undefined, error: row.error ? String(row.error) : undefined };
  }
  listRuns(limit = 100): RunRecord[] {
    return this.db.query<Record<string, unknown>, [number]>("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?").all(limit).map((row) => ({
      id: String(row.id), suiteId: String(row.suite_id), config: JSON.parse(String(row.config_json)) as RunConfig,
      state: String(row.state) as RunState, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      effectiveConfigHash: row.effective_config_hash ? String(row.effective_config_hash) : undefined,
      error: row.error ? String(row.error) : undefined,
    }));
  }
  setRunState(id: string, state: RunState, error?: string): void { this.db.query("UPDATE runs SET state = ?, updated_at = ?, error = ? WHERE id = ?").run(state, now(), error ?? null, id); }
  addCandidate(runId: string, side: "x" | "y", candidate: Candidate): void { this.db.query("INSERT OR REPLACE INTO candidates (run_id, side, provider, model, config_json) VALUES (?, ?, ?, ?, ?)").run(runId, side, candidate.provider, candidate.model, json(candidate)); }
  addCase(runId: string, caseId: string, trial: number): void { this.db.query("INSERT OR IGNORE INTO run_cases (run_id, case_id, trial) VALUES (?, ?, ?)").run(runId, caseId, trial); }
  createAttempt(attempt: AttemptRecord): void { this.db.query("INSERT INTO attempts (id, run_id, case_id, trial, side, state, started_at, finished_at, exit_code, output_artifact, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(attempt.id, attempt.runId, attempt.caseId, attempt.trial, attempt.side, attempt.state, attempt.startedAt ?? null, attempt.finishedAt ?? null, attempt.exitCode ?? null, attempt.outputArtifact ?? null, attempt.error ?? null); }
  setAttemptState(id: string, state: AttemptState, details: Partial<Pick<AttemptRecord, "startedAt" | "finishedAt" | "exitCode" | "outputArtifact" | "error">> = {}): void { this.db.query("UPDATE attempts SET state = ?, started_at = COALESCE(?, started_at), finished_at = COALESCE(?, finished_at), exit_code = COALESCE(?, exit_code), output_artifact = COALESCE(?, output_artifact), error = COALESCE(?, error) WHERE id = ?").run(state, details.startedAt ?? null, details.finishedAt ?? null, details.exitCode ?? null, details.outputArtifact ?? null, details.error ?? null, id); }
  getAttempt(id: string): AttemptRecord | undefined {
    const row = this.db.query<Record<string, unknown>, [string]>("SELECT * FROM attempts WHERE id = ?").get(id);
    if (!row) return undefined;
    return { id: String(row.id), runId: String(row.run_id), caseId: String(row.case_id), trial: Number(row.trial), side: String(row.side) as "x" | "y", state: String(row.state) as AttemptState, startedAt: row.started_at ? String(row.started_at) : undefined, finishedAt: row.finished_at ? String(row.finished_at) : undefined, exitCode: row.exit_code == null ? undefined : Number(row.exit_code), outputArtifact: row.output_artifact ? String(row.output_artifact) : undefined, error: row.error ? String(row.error) : undefined };
  }
  listAttempts(runId: string): AttemptRecord[] {
    return this.db.query<Record<string, unknown>, [string]>("SELECT * FROM attempts WHERE run_id = ? ORDER BY case_id, trial, side").all(runId).map((row) => ({ id: String(row.id), runId: String(row.run_id), caseId: String(row.case_id), trial: Number(row.trial), side: String(row.side) as "x" | "y", state: String(row.state) as AttemptState, startedAt: row.started_at ? String(row.started_at) : undefined, finishedAt: row.finished_at ? String(row.finished_at) : undefined, exitCode: row.exit_code == null ? undefined : Number(row.exit_code), outputArtifact: row.output_artifact ? String(row.output_artifact) : undefined, error: row.error ? String(row.error) : undefined })) as AttemptRecord[];
  }

  /** Append with a monotonically increasing per-attempt sequence in one transaction. */
  appendEvent(attemptId: string, event: Omit<NormalizedEvent, "sequence"> & { sequence?: number }): StoredEvent {
    const timestamp = event.timestamp ?? now();
    const insert = this.db.transaction(() => {
      const current = this.db.query<{ sequence: number | null }, [string]>("SELECT MAX(sequence) AS sequence FROM events WHERE attempt_id = ?").get(attemptId);
      const sequence = event.sequence ?? ((current?.sequence ?? -1) + 1);
      this.db.query("INSERT INTO events (attempt_id, sequence, timestamp, type, payload_json) VALUES (?, ?, ?, ?, ?)").run(attemptId, sequence, timestamp, event.type, json({ ...event, sequence, timestamp }));
      return sequence;
    })();
    return { ...event, attemptId, sequence: insert, timestamp };
  }
  listEvents(attemptId: string, after = -1, limit = 1000): StoredEvent[] {
    return this.db.query<{ payload_json: string }, [string, number, number]>("SELECT payload_json FROM events WHERE attempt_id = ? AND sequence > ? ORDER BY sequence LIMIT ?").all(attemptId, after, limit).map((row) => ({ ...JSON.parse(row.payload_json) as NormalizedEvent, attemptId }));
  }
  saveAssertions(attemptId: string, grade: DeterministicGrade): void {
    const statement = this.db.query("INSERT INTO assertion_results (attempt_id, assertion_id, passed, message, expected_json, actual_json) VALUES (?, ?, ?, ?, ?, ?)");
    const insert = this.db.transaction(() => { for (const result of grade.assertions) statement.run(attemptId, result.id, result.passed ? 1 : 0, result.message, result.expected === undefined ? null : json(result.expected), result.actual === undefined ? null : json(result.actual)); });
    insert();
  }
  savePairResult(runId: string, caseId: string, trial: number, result: unknown & { verdict?: string; reason?: string }): void { this.db.query("INSERT OR REPLACE INTO pair_results (run_id, case_id, trial, verdict, reason, result_json) VALUES (?, ?, ?, ?, ?, ?)").run(runId, caseId, trial, result.verdict ?? "indeterminate", result.reason ?? "", json(result)); }
  saveJudgment(runId: string, caseId: string, trial: number, retry: number, result: unknown): void { this.db.query("INSERT OR REPLACE INTO judgments (run_id, case_id, trial, retry, result_json) VALUES (?, ?, ?, ?, ?)").run(runId, caseId, trial, retry, json(result)); }
  getPairResults(runId: string): unknown[] { return this.db.query<{ result_json: string }, [string]>("SELECT result_json FROM pair_results WHERE run_id = ? ORDER BY case_id, trial").all(runId).map((row) => JSON.parse(row.result_json)); }
  saveArtifact(record: ArtifactRecord): void {
    this.db.query("INSERT OR REPLACE INTO artifacts (id, run_id, attempt_id, kind, path, sha256, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(record.id, record.runId, record.attemptId ?? null, record.kind, record.path, record.sha256, record.bytes, record.createdAt);
  }
}

export function openDatabase(path?: string): XoxoDatabase { return new XoxoDatabase(path); }
