/** Remove credentials and common authorization material before persistence/export. */
const secretPatterns: readonly RegExp[] = [
  /\b(?:sk|sess|key|token|secret|password|api[_-]?key)_[A-Za-z0-9_-]{12,}\b/gi,
  /\b(?:sk-ant|sk-proj)-[A-Za-z0-9_-]{12,}\b/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /("?(?:authorization|x-api-key|api-key|access_token|refresh_token|client_secret)"?\s*[:=]\s*")([^"\r\n]+)/gi,
  /\b(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|CODEX_API_KEY|XOXO_[A-Z0-9_]*TOKEN)\s*=\s*[^\s\r\n]+/gi,
];

export function redactText(value: string): string {
  let redacted = value;
  redacted = redacted.replace(secretPatterns[0]!, "[REDACTED]");
  redacted = redacted.replace(secretPatterns[1]!, "[REDACTED]");
  redacted = redacted.replace(secretPatterns[2]!, "Bearer [REDACTED]");
  redacted = redacted.replace(secretPatterns[3]!, "$1[REDACTED]");
  redacted = redacted.replace(secretPatterns[4]!, (match) => `${match.slice(0, match.indexOf("=") + 1)} [REDACTED]`);
  return redacted;
}

export function redact<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((entry) => redact(entry)) as T;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/authorization|api[-_]?key|(?:access|refresh)[_-]?token|client[_-]?secret|password|^secret$|^token$/i.test(key)) output[key] = "[REDACTED]";
      else output[key] = redact(entry);
    }
    return output as T;
  }
  return value;
}

export function redactJsonLine(value: string): string {
  try { return JSON.stringify(redact(JSON.parse(value))); } catch { return redactText(value); }
}
