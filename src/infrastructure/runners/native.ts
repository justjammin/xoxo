import type { CompiledInvocation, ProviderEvent, ProviderEventSink, ProviderRunResult } from "../providers/types";

const KILL_GRACE_MS = 5_000;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

async function readStream(stream: ReadableStream<Uint8Array> | null | undefined, onChunk: (chunk: string) => void): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) {
        const tail = decoder.decode();
        if (tail) { result += tail; onChunk(tail); }
        break;
      }
      const chunk = decoder.decode(part.value, { stream: true });
      if (result.length < MAX_OUTPUT_BYTES) {
        const allowed = chunk.slice(0, MAX_OUTPUT_BYTES - result.length);
        result += allowed;
        if (allowed) onChunk(allowed);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return result;
}

function terminate(proc: { kill(signal?: NodeJS.Signals | number): void }): ReturnType<typeof setTimeout> {
  try { proc.kill("SIGTERM"); } catch { /* already exited */ }
  const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* already exited */ } }, KILL_GRACE_MS);
  timer.unref?.();
  return timer;
}

export type NativeRunnerOptions = {
  maxOutputBytes?: number;
  killGraceMs?: number;
};

/** Runs a compiled provider invocation without a shell and cleans up on abort/timeout. */
export class NativeRunner {
  constructor(private readonly options: NativeRunnerOptions = {}) {}

  async run(invocation: CompiledInvocation, sink?: ProviderEventSink, signal?: AbortSignal): Promise<ProviderRunResult> {
    const started = Date.now();
    const events: ProviderEvent[] = [];
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let timedOut = false;
    let cancelled = false;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    const proc = Bun.spawn([invocation.command, ...invocation.args], {
      cwd: invocation.cwd,
      env: { ...process.env, ...invocation.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const emit = async (event: ProviderEvent) => {
      events.push(event);
      await sink?.(event);
    };
    const parseChunk = async (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) for (const event of invocation.parseLine(line)) await emit(event);
    };
    const outputLimit = this.options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
    let parseChain = Promise.resolve();
    const stdoutPromise = readStream(proc.stdout, (chunk) => {
      if (stdout.length < outputLimit) stdout += chunk.slice(0, outputLimit - stdout.length);
      parseChain = parseChain.then(() => parseChunk(chunk));
    });
    const stderrPromise = readStream(proc.stderr, (chunk) => {
      if (stderr.length < outputLimit) stderr += chunk.slice(0, outputLimit - stderr.length);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const kill = (kind: "timeout" | "cancel") => {
      if (kind === "timeout") timedOut = true;
      else cancelled = true;
      terminationTimer ??= terminate(proc);
    };
    if (signal) {
      abortListener = () => kill("cancel");
      if (signal.aborted) kill("cancel");
      else signal.addEventListener("abort", abortListener, { once: true });
    }
    timer = setTimeout(() => kill("timeout"), invocation.timeoutMs);
    const exitCode = await proc.exited;
    if (terminationTimer) clearTimeout(terminationTimer);
    if (timer) clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    await Promise.all([stdoutPromise, stderrPromise]);
    await parseChain;
    if (stdoutBuffer) for (const event of invocation.parseLine(stdoutBuffer)) await emit(event);
    if (timedOut) await emit({ type: "error", timestamp: new Date().toISOString(), error: `Timed out after ${invocation.timeoutMs}ms` });
    if (cancelled) await emit({ type: "error", timestamp: new Date().toISOString(), error: "Cancelled" });
    return { exitCode, timedOut, cancelled, stdout, stderr, events, durationMs: Date.now() - started };
  }
}

export const nativeRunner = new NativeRunner();
export const NativeProcessRunner = NativeRunner;
export async function runNative(invocation: CompiledInvocation, sink?: ProviderEventSink, signal?: AbortSignal) {
  return nativeRunner.run(invocation, sink, signal);
}
