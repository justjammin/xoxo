import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gsap } from "gsap";
import { Activity, Box, CircleStop, GitCompareArrows, Moon, Play, Sun, X } from "lucide-react";
import { api, type CandidateInput, type JudgeInput, type RunEvent, type RunSummary, unwrapList } from "./lib/api";

const ExecutionMap = lazy(() => import("./components/ExecutionMap").then((module) => ({ default: module.ExecutionMap })));

const defaultX: CandidateInput = {
  provider: "claude",
  model: "claude-sonnet-4-6",
  effort: "high",
  subagents: { enabled: false, maxConcurrent: 2, maxSpawnDepth: 1, definitions: [{ name: "researcher", description: "Collect repository evidence", prompt: "Inspect the task and report evidence before implementation.", model: "claude-sonnet-4-6", effort: "high", maxTurns: 8 }] },
};

const defaultY: CandidateInput = {
  provider: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
  subagents: { enabled: false, maxConcurrent: 2, definitions: [{ name: "researcher", description: "Collect repository evidence", prompt: "Inspect the task and report evidence before implementation.", model: "gpt-5.6-luna", effort: "high" }] },
};

const demoEvents: RunEvent[] = [
  { seq: 1, kind: "run.queued", payload: { phase: "Queued" } },
  { seq: 2, kind: "attempt.started", payload: { slot: "x", caseId: "reads-before-editing" } },
  { seq: 3, kind: "attempt.started", payload: { slot: "y", caseId: "reads-before-editing" } },
  { seq: 4, kind: "attempt.tool_started", payload: { slot: "x", tool: "Read" } },
  { seq: 5, kind: "assertion.finished", payload: { slot: "x", passed: true } },
];

function CandidateLane({ label, value, onChange }: { label: "X" | "Y"; value: CandidateInput; onChange: (next: CandidateInput) => void }) {
  const definition = value.subagents.definitions[0]!;
  const updateDefinition = (patch: Partial<typeof definition>) => onChange({ ...value, subagents: { ...value.subagents, definitions: [{ ...definition, ...patch }] } });
  const updateProvider = (provider: CandidateInput["provider"]) => {
    const { maxTurns: _maxTurns, ...portableDefinition } = definition;
    onChange({ ...value, provider, subagents: { ...value.subagents, maxSpawnDepth: provider === "claude" ? value.subagents.maxSpawnDepth ?? 1 : undefined, definitions: [provider === "claude" ? { ...portableDefinition, maxTurns: definition.maxTurns ?? 8 } : portableDefinition] } });
  };
  return (
    <fieldset className={`candidate-lane lane-${label.toLowerCase()}`}>
      <legend><span>{label}</span> candidate</legend>
      <label>
        Provider
        <select value={value.provider} onChange={(event) => updateProvider(event.target.value as CandidateInput["provider"])}>
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
        </select>
      </label>
      <label>
        Model
        <input value={value.model} onChange={(event) => onChange({ ...value, model: event.target.value })} spellCheck={false} />
      </label>
      <label>
        Effort
        <select value={value.effort} onChange={(event) => onChange({ ...value, effort: event.target.value })}>
          {['low', 'medium', 'high', 'xhigh', 'max'].map((effort) => <option key={effort}>{effort}</option>)}
        </select>
      </label>
      <div className="agent-controls">
        <label className="check-label">
          <input type="checkbox" checked={value.subagents.enabled} onChange={(event) => onChange({ ...value, subagents: { ...value.subagents, enabled: event.target.checked } })} />
          Allow subagents
        </label>
        <label>
          Concurrent
          <input type="number" min={1} max={8} disabled={!value.subagents.enabled} value={value.subagents.maxConcurrent} onChange={(event) => onChange({ ...value, subagents: { ...value.subagents, maxConcurrent: Number(event.target.value) } })} />
        </label>
      </div>
      {value.subagents.enabled && <div className="agent-definition" aria-label={`${label} subagent definition`}>
        <label>Name<input value={definition.name} onChange={(event) => updateDefinition({ name: event.target.value })} /></label>
        <label>Model<input value={definition.model ?? ""} onChange={(event) => updateDefinition({ model: event.target.value })} spellCheck={false} /></label>
        <label>Effort<select value={definition.effort ?? "high"} onChange={(event) => updateDefinition({ effort: event.target.value })}>{['low', 'medium', 'high', 'xhigh', 'max'].map((effort) => <option key={effort}>{effort}</option>)}</select></label>
        {value.provider === "claude" && <label>Max turns<input type="number" min={1} max={100} value={definition.maxTurns ?? 8} onChange={(event) => updateDefinition({ maxTurns: Number(event.target.value) })} /></label>}
        {value.provider === "claude" && <label>Spawn depth<input type="number" min={1} max={8} value={value.subagents.maxSpawnDepth ?? 1} onChange={(event) => onChange({ ...value, subagents: { ...value.subagents, maxSpawnDepth: Number(event.target.value) } })} /></label>}
      </div>}
    </fieldset>
  );
}

export function App() {
  const shellRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<"light" | "dark">(() => localStorage.getItem("xoxo-theme") === "dark" ? "dark" : "light");
  const [suiteId, setSuiteId] = useState("smoke");
  const [x, setX] = useState(defaultX);
  const [y, setY] = useState(defaultY);
  const [trials, setTrials] = useState(1);
  const [judgeEnabled, setJudgeEnabled] = useState(false);
  const [judge, setJudge] = useState<JudgeInput>({ provider: "codex", model: "gpt-5.6-sol", effort: "high", maxRetries: 1 });
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>(demoEvents);
  const [showMap, setShowMap] = useState(false);

  const suitesQuery = useQuery({ queryKey: ["suites"], queryFn: api.listSuites });
  const runsQuery = useQuery({ queryKey: ["runs"], queryFn: api.listRuns });
  const runQuery = useQuery({ queryKey: ["run", activeRunId], queryFn: () => api.getRun(activeRunId!), enabled: Boolean(activeRunId), refetchInterval: 2_000 });

  const suites = unwrapList(suitesQuery.data, "suites").map((suite) => typeof suite === "string" ? { id: suite } : suite);
  const runs = unwrapList<RunSummary>(runsQuery.data, "runs");
  const activeRun = runQuery.data ?? runs.find((run) => run.id === activeRunId);

  const startMutation = useMutation({
    mutationFn: () => api.startRun({ suiteId, x, y, trials, ...(judgeEnabled ? { judge } : {}) }),
    onSuccess: (result) => {
      const id = result.runId ?? result.id;
      if (!id) throw new Error("Server did not return a run ID");
      setActiveRunId(id);
      setEvents([]);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
  });

  const cancelMutation = useMutation({ mutationFn: () => api.cancelRun(activeRunId!) });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("xoxo-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!activeRunId) return;
    const source = new EventSource(`/v1/runs/${activeRunId}/events`);
    const receive = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as RunEvent;
      setEvents((current) => current.some((item) => item.seq === event.seq) ? current : [...current, event]);
    };
    const eventTypes = ["status", "text", "tool_call", "tool_result", "subagent_start", "subagent_end", "result", "error", "completed", "cancelled"];
    source.onmessage = receive;
    for (const type of eventTypes) source.addEventListener(type, receive as EventListener);
    source.addEventListener("completed", () => source.close());
    source.addEventListener("cancelled", () => source.close());
    source.onerror = () => source.close();
    return () => {
      for (const type of eventTypes) source.removeEventListener(type, receive as EventListener);
      source.close();
    };
  }, [activeRunId]);

  useLayoutEffect(() => {
    if (!shellRef.current) return;
    const media = gsap.matchMedia();
    media.add({ reduce: "(prefers-reduced-motion: reduce)" }, (context) => {
      const reduce = Boolean(context.conditions?.reduce);
      const timeline = gsap.timeline({ defaults: { ease: "power4.out", duration: reduce ? 0 : 0.48 } });
      timeline.from(".masthead > *", { y: reduce ? 0 : 14, autoAlpha: 0, stagger: reduce ? 0 : 0.055 });
      timeline.from(".workspace > *", { y: reduce ? 0 : 18, autoAlpha: 0, stagger: reduce ? 0 : 0.07 }, "-=0.2");
      return () => timeline.kill();
    }, shellRef);
    return () => media.revert();
  }, []);

  useLayoutEffect(() => {
    const target = ".evidence-row:last-child";
    if (!events.length || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(target, { x: 8, autoAlpha: 0.3 }, { x: 0, autoAlpha: 1, duration: 0.24, ease: "power3.out", overwrite: "auto" });
  }, [events.length]);

  const status = activeRun?.status ?? (activeRunId ? "loading" : "ready");
  const isRunning = ["queued", "preparing", "executing", "grading", "judging", "running", "loading"].includes(status);
  const shownEvents = events.length ? events : activeRun?.events ?? demoEvents;
  const summary = useMemo(() => ({
    xAssertions: shownEvents.filter((event) => event.kind.includes("assertion") && event.payload?.slot === "x").length,
    yAssertions: shownEvents.filter((event) => event.kind.includes("assertion") && event.payload?.slot === "y").length,
  }), [shownEvents]);

  return (
    <div className="app-shell" ref={shellRef}>
      <header className="masthead">
        <div className="wordmark" aria-label="XOXO agent evaluation desk"><span>X</span>O<span>X</span>O</div>
        <div className="masthead-copy"><p>Evidence desk / local issue</p><h1>Set the record straight.</h1></div>
        <div className="status-stamp"><span className={`status-dot status-${status}`} />{status}</div>
        <button className="icon-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}>
          {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </header>

      <main id="main" className="workspace">
        <aside className="docket" aria-label="Evaluation docket">
          <p className="eyebrow">The docket</p>
          <label>Suite
            <select value={suiteId} onChange={(event) => setSuiteId(event.target.value)}>
              {(suites.length ? suites : [{ id: "smoke" }]).map((suite) => <option key={suite.id}>{suite.id}</option>)}
            </select>
          </label>
          <label>Trials
            <input type="number" min={1} max={9} value={trials} onChange={(event) => setTrials(Number(event.target.value))} />
          </label>
          <label className="check-label judge-toggle"><input type="checkbox" checked={judgeEnabled} onChange={(event) => setJudgeEnabled(event.target.checked)} /> Blind judge</label>
          {judgeEnabled && <div className="judge-fields" aria-label="Blind judge configuration">
            <label>Provider<select value={judge.provider} onChange={(event) => setJudge({ ...judge, provider: event.target.value as JudgeInput["provider"] })}><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
            <label>Model<input value={judge.model} onChange={(event) => setJudge({ ...judge, model: event.target.value })} spellCheck={false} /></label>
            <label>Effort<select value={judge.effort} onChange={(event) => setJudge({ ...judge, effort: event.target.value })}>{['low', 'medium', 'high', 'xhigh', 'max'].map((effort) => <option key={effort}>{effort}</option>)}</select></label>
            <label>Retries<input type="number" min={0} max={3} value={judge.maxRetries} onChange={(event) => setJudge({ ...judge, maxRetries: Number(event.target.value) })} /></label>
          </div>}
          <div className="docket-rule" />
          <p className="folio">Blind judging activates only after both candidates clear deterministic gates.</p>
          <button className="map-toggle" onClick={() => setShowMap((current) => !current)} aria-expanded={showMap}>
            <Box size={17} /> {showMap ? "Close execution map" : "Open execution map"}
          </button>
        </aside>

        <section className="comparison" aria-labelledby="comparison-title">
          <div className="section-heading"><div><p className="eyebrow">Head to head</p><h2 id="comparison-title">Candidate configuration</h2></div><GitCompareArrows aria-hidden="true" /></div>
          <form onSubmit={(event) => { event.preventDefault(); startMutation.mutate(); }}>
            <div className="candidate-grid"><CandidateLane label="X" value={x} onChange={setX} /><CandidateLane label="Y" value={y} onChange={setY} /></div>
            {startMutation.error && <p className="error-note" role="alert">{startMutation.error.message}</p>}
            <div className="run-actions">
              <button className="run-button" type="submit" disabled={isRunning || startMutation.isPending}><Play size={17} fill="currentColor" /> Run comparison</button>
              {isRunning && <button type="button" className="secondary-button" onClick={() => cancelMutation.mutate()}><CircleStop size={17} /> Stop</button>}
              <span>Fresh sandboxes · fixture parity · redacted evidence</span>
            </div>
          </form>
        </section>

        <section className="decision-strip" aria-label="Current decision">
          <div><p className="eyebrow">Current finding</p><strong>{activeRun?.verdict ?? "Awaiting evidence"}</strong></div>
          <dl><div><dt>X checks</dt><dd>{summary.xAssertions}</dd></div><div><dt>Y checks</dt><dd>{summary.yAssertions}</dd></div><div><dt>Events</dt><dd>{shownEvents.length}</dd></div></dl>
        </section>

        {showMap && <section className="map-panel" aria-labelledby="map-title"><div className="section-heading"><div><p className="eyebrow">Relationship plate</p><h2 id="map-title">Execution map</h2></div><button className="icon-button" onClick={() => setShowMap(false)} aria-label="Close execution map"><X size={18} /></button></div><Suspense fallback={<div className="map-loading">Preparing evidence map…</div>}><ExecutionMap runId={activeRunId ?? "preview"} events={shownEvents} /></Suspense></section>}

        <section className="evidence" aria-labelledby="evidence-title">
          <div className="section-heading"><div><p className="eyebrow">Live ledger</p><h2 id="evidence-title">Evidence, in sequence</h2></div><Activity aria-hidden="true" /></div>
          <div className="evidence-table" role="table" aria-label="Run events">
            <div className="evidence-header" role="row"><span role="columnheader">No.</span><span role="columnheader">Event</span><span role="columnheader">Evidence</span></div>
            {shownEvents.map((event) => <div className="evidence-row" role="row" key={`${event.seq}-${event.kind}`}><span role="cell">{String(event.seq).padStart(3, "0")}</span><strong role="cell">{event.kind.replaceAll("_", " ")}</strong><span role="cell">{String(event.payload?.tool ?? event.payload?.caseId ?? event.payload?.phase ?? event.payload?.message ?? "Recorded")}</span></div>)}
          </div>
        </section>
      </main>
      <footer><span>XOXO</span><p>Every verdict leaves a paper trail.</p></footer>
    </div>
  );
}
