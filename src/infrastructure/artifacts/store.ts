import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { redactText } from "./redaction.ts";

export type ArtifactKind = "provider-stream" | "stderr" | "output" | "snapshot" | "diff" | "judge" | "report" | "manifest" | "other";
export type ArtifactRecord = { id: string; runId: string; attemptId?: string; kind: ArtifactKind; path: string; sha256: string; bytes: number; createdAt: string };

function safePart(value: string): string { if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) throw new Error(`Unsafe artifact path component: ${value}`); return value; }
function hash(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function bytesOf(value: string | Uint8Array): Uint8Array { return typeof value === "string" ? new TextEncoder().encode(value) : value; }

export class ArtifactStore {
  readonly root: string;
  constructor(root = ".xoxo") { this.root = resolve(root); mkdirSync(this.root, { recursive: true }); }
  runRoot(runId: string): string { return join(this.root, "runs", safePart(runId)); }
  attemptRoot(runId: string, caseId: string, trial: number, side: "x" | "y"): string {
    if (!Number.isInteger(trial) || trial < 0) throw new Error("Trial must be a non-negative integer");
    return join(this.runRoot(runId), "attempts", safePart(caseId), String(trial), side);
  }
  write(runId: string, kind: ArtifactKind, relativePath: string, content: string | Uint8Array, attemptId?: string): ArtifactRecord {
    safePart(runId);
    if (isAbsolute(relativePath)) throw new Error("Artifact path must be relative");
    const destination = resolve(this.runRoot(runId), relativePath);
    const rel = relative(this.runRoot(runId), destination);
    if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("Artifact path escapes run root");
    const data = typeof content === "string" ? redactText(content) : content;
    const bytes = bytesOf(data);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
    return { id: `${runId}:${rel}`, runId, attemptId, kind, path: join("runs", safePart(runId), rel), sha256: hash(bytes), bytes: bytes.byteLength, createdAt: new Date().toISOString() };
  }
  read(record: ArtifactRecord): Uint8Array {
    const destination = resolve(this.root, record.path);
    const rel = relative(this.root, destination);
    if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("Artifact path escapes store root");
    return readFileSync(destination);
  }
  manifest(runId: string, records: readonly ArtifactRecord[]): ArtifactRecord { return this.write(runId, "manifest", "manifest.json", JSON.stringify({ version: "xoxo/v1", runId, createdAt: new Date().toISOString(), artifacts: records }, null, 2)); }
}
