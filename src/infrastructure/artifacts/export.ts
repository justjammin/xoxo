import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ArtifactRecord } from "./store.ts";
import { redactText } from "./redaction.ts";

export type PortableReport = { runId: string; suiteId?: string; state?: string; candidates?: unknown; results: unknown[]; artifacts?: ArtifactRecord[]; generatedAt?: string };
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }

export function renderReportHtml(report: PortableReport): string {
  const safe = redactText(JSON.stringify(report, null, 2));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>XOXO ${escapeHtml(report.runId)}</title><style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;background:#f7f5ef;color:#242321}pre{white-space:pre-wrap;background:#fff;padding:1rem;border:1px solid #dedbd1;border-radius:8px;overflow:auto}h1{font-size:2rem}</style></head><body><h1>XOXO run ${escapeHtml(report.runId)}</h1><pre>${escapeHtml(safe)}</pre></body></html>`;
}

export function exportReport(report: PortableReport, destination = ".xoxo/exports"): { jsonPath: string; htmlPath: string } {
  const output = resolve(destination); mkdirSync(output, { recursive: true });
  const jsonPath = join(output, `${report.runId}.json`); const htmlPath = join(output, `${report.runId}.html`);
  const payload = { ...report, generatedAt: report.generatedAt ?? new Date().toISOString() };
  writeFileSync(jsonPath, redactText(JSON.stringify(payload, null, 2)));
  writeFileSync(htmlPath, renderReportHtml(payload));
  return { jsonPath, htmlPath };
}
