import React, { useRef, useState } from "react";
import type { SubagentRun } from "../main/delegation";
import type { Job } from "../main/jobs";
import type { Monitor } from "../main/monitors";
import "./jobs.css";
type JobInput = {
  goal: string;
  profile: "desktop" | "project";
  runAt?: string;
};
export function JobsPanel({
  jobs = [],
  subagents = [],
  enqueue,
  control,
  open,
  run,
}: {
  jobs?: Job[];
  subagents?: SubagentRun[];
  enqueue: (input: JobInput) => Promise<unknown>;
  control: (
    id: string,
    action: "resume" | "pause" | "cancel",
  ) => Promise<unknown>;
  open?: (id: string) => Promise<unknown>;
  run: (fn: () => Promise<unknown>) => Promise<unknown>;
}) {
  const createSummary = useRef<HTMLElement>(null);
  const [creating, setCreating] = useState(false),
    [goal, setGoal] = useState(""),
    [profile, setProfile] = useState<"desktop" | "project">("desktop"),
    [when, setWhen] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<string | null>(null);
  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void run(fn).finally(() => setBusy(false));
  };
  const submit = () =>
    act(async () => {
      const runAt = when ? new Date(when).toISOString() : undefined;
      await enqueue({ goal, profile, runAt });
      setGoal("");
      setWhen("");
      setCreating(false);
      createSummary.current?.focus();
    });
  return (
    <section className="jobs-panel" aria-label="Durable jobs">
      <SubagentList items={subagents} run={run} />
      <details
        className="job-create"
        open={creating}
        onToggle={(e) => setCreating(e.currentTarget.open)}
      >
        <summary ref={createSummary}>New job</summary>
        <label>
          Goal
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Describe the outcome you want."
            maxLength={100000}
          />
        </label>
        <label>
          Execution profile
          <select
            value={profile}
            onChange={(e) =>
              setProfile(e.target.value as "desktop" | "project")
            }
          >
            <option value="desktop">Desktop assistance</option>
            <option value="project">Project coding and builds</option>
          </select>
        </label>
        <p className="job-help">
          {profile === "project"
            ? "Creates a fresh project folder. JARVIS can edit files there; each command requires approval. Personal folders stay inaccessible. Network is off unless you approve public HTTPS for a specific command."
            : "Uses the existing desktop, browser and granted-file tools. Consequential actions wait for approval."}
        </p>
        <label>
          Run at (optional)
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </label>
        <p className="job-help">
          Runs when JARVIS is awake and ready. Default budget: 30 active
          minutes, 150 tool calls. Waiting for you does not consume the
          active-time budget.
        </p>
        <button
          className="primary"
          disabled={busy || !goal.trim()}
          onClick={submit}
        >
          Queue job
        </button>
      </details>
      {!jobs.length && (
        <p className="job-help">
          No jobs yet. Speak a goal to JARVIS, or queue one here.
        </p>
      )}
      <div className="job-list">
        {jobs.map((j) => {
          const labels: Partial<Record<Job["state"], string>> = {
            waiting_input: "Needs your input",
            waiting_approval: "Needs approval",
            running: "Working",
            queued:
              j.notBefore && j.notBefore > Date.now() ? "Scheduled" : "Queued",
          };
          return (
            <article className="job-entry" key={j.id}>
              <div className="job-state">
                <strong>
                  {labels[j.state] || j.state.replaceAll("_", " ")}
                </strong>
                <span>{j.profile === "project" ? "Project" : "Desktop"}</span>
              </div>
              <h3>{j.goal.split("\n")[0].slice(0, 120)}</h3>
              {j.notBefore && (
                <p className="job-help">
                  Scheduled: {new Date(j.notBefore).toLocaleString()}
                </p>
              )}
              {j.error && (
                <p role="status" className="job-error">
                  {j.error}
                </p>
              )}
              <details>
                <summary>Goal and progress</summary>
                <p className="job-full-goal">{j.goal}</p>
                {j.checkpoint && <p>{j.checkpoint}</p>}
                {j.result && <p className="job-full-goal">{j.result}</p>}
                <p className="job-help">
                  {j.toolCalls}/{j.maxToolCalls} tool calls ·{" "}
                  {Math.ceil(j.activeMs / 60000)}/{j.maxActiveMinutes} active
                  minutes
                </p>
                {j.threadTokenTotal !== undefined && (
                  <p className="job-help">
                    Thread tokens: {j.threadTokenTotal.toLocaleString()}{" "}
                    reported by Codex. This is not a billing estimate.
                  </p>
                )}
              </details>
              <div className="job-actions">
                {["paused", "interrupted", "failed"].includes(j.state) && (
                  <button
                    disabled={busy}
                    onClick={() => setReview(review === j.id ? null : j.id)}
                  >
                    Resume safely
                  </button>
                )}
                {[
                  "queued",
                  "running",
                  "waiting_input",
                  "waiting_approval",
                ].includes(j.state) && (
                  <button
                    disabled={busy}
                    onClick={() => act(() => control(j.id, "pause"))}
                  >
                    Pause job
                  </button>
                )}
                {!["completed", "cancelled"].includes(j.state) && (
                  <button
                    disabled={busy}
                    onClick={() => act(() => control(j.id, "cancel"))}
                  >
                    Cancel job
                  </button>
                )}
                {open && j.profile === "project" && (
                  <button disabled={busy} onClick={() => act(() => open(j.id))}>
                    Open project folder
                  </button>
                )}
              </div>
              {review === j.id && (
                <div className="job-resume">
                  <p>
                    Review the goal and recorded progress above. Earlier effects
                    may already exist. JARVIS will inspect them and request
                    fresh approvals before continuing.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await control(j.id, "resume");
                        setReview(null);
                      })
                    }
                  >
                    Resume this job
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
export function MonitorList({
  items = [],
  control,
  run,
}: {
  items?: Monitor[];
  control: (id: string, action: "pause" | "remove") => Promise<unknown>;
  run: (fn: () => Promise<unknown>) => Promise<unknown>;
}) {
  return (
    <section className="source-monitors" aria-label="Source monitors">
      <h3>File and page monitors</h3>
      <p className="job-help">
        Ask JARVIS to watch a granted file or a public HTTPS page. Review the
        condition, interval and follow-up goal before enabling. Matching checks
        queue a Codex job; unchanged checks use no AI.
      </p>
      {!items.length && (
        <p className="job-help">No source monitors configured.</p>
      )}
      {items.map((m) => (
        <article className="job-entry" key={m.id}>
          <strong>
            {m.enabled ? "Watching" : "Paused"} · {m.kind}
          </strong>
          <p className="job-full-goal">{m.target}</p>
          <p>
            {m.condition}
            {m.match ? ": " + m.match : ""} · every {m.intervalSeconds} seconds
            · {m.runs}/{m.maxRuns} jobs triggered
          </p>
          <details>
            <summary>Follow-up goal</summary>
            <p className="job-full-goal">{m.goal}</p>
          </details>
          {m.error && <p role="status">{m.error}</p>}
          <div className="job-actions">
            {m.enabled && (
              <button onClick={() => void run(() => control(m.id, "pause"))}>
                Pause monitor
              </button>
            )}
            <button onClick={() => void run(() => control(m.id, "remove"))}>
              Remove monitor
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function SubagentList({
  items,
  run,
}: {
  items: SubagentRun[];
  run: (fn: () => Promise<unknown>) => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState<Record<string, SubagentRun>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const act = (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    void run(fn).finally(() => setBusy(null));
  };
  return (
    <section className="subagent-list" aria-label="Specialist subagents">
      <h3>Specialist subagents</h3>
      <p className="job-help">
        Parallel analysis, planning and review. Workers use selected context and
        file snapshots; JARVIS handles actions and approvals.
      </p>
      {!items.length && (
        <p className="job-help">
          No workers yet. Enable subagents in Settings → Autonomy, then ask
          JARVIS to delegate a task.
        </p>
      )}
      {items.map((a) => {
        const live = ["queued", "starting", "running"].includes(a.state);
        const detail = expanded[a.id] || a;
        return (
          <article className="job-entry" key={a.id}>
            <div className="job-state">
              <strong>{a.state}</strong>
              <span>{a.role}</span>
            </div>
            <h4>{a.label}</h4>
            {a.progress && <p className="job-full-goal">{a.progress}</p>}
            <p className="job-help">
              {a.toolCalls}/20 tool calls · {a.reportedTokens.toLocaleString()}
              /40,000 reported tokens · 5 minute limit
            </p>
            {a.error && (
              <p className="job-error" role="status">
                {a.error}
              </p>
            )}
            <details>
              <summary>Goal, shared files and findings</summary>
              <p className="job-full-goal">{detail.goal}</p>
              <p className="job-help">
                {a.files.length
                  ? `${a.files.length} immutable file snapshots shared`
                  : "Context text only; no files shared"}
              </p>
              {a.files.map((f) => (
                <p className="subagent-file" key={f.path}>
                  <code>{f.path}</code>
                  <small>SHA-256 {f.sha256}</small>
                </p>
              ))}
              <p className="job-full-goal">
                {detail.result || "No findings recorded yet."}
              </p>
              {a.assessment && (
                <p className="job-help">
                  JARVIS assessment: {a.assessment.decision} ·{" "}
                  {a.assessment.notes}
                </p>
              )}
              <p className="job-help">
                Worker findings are untrusted input, never action approval or an
                independent repository review.
              </p>
              <div className="job-actions">
                <button
                  disabled={busy === a.id}
                  onClick={() =>
                    act(a.id, async () => {
                      const full = await window.jarvis.subagentRead(a.id);
                      setExpanded((v) => ({ ...v, [a.id]: full }));
                    })
                  }
                >
                  Load full record
                </button>
              </div>
            </details>
            {live && (
              <div className="job-actions">
                <button
                  disabled={busy === a.id}
                  onClick={() =>
                    act(a.id, () => window.jarvis.subagentCancel(a.id))
                  }
                >
                  Cancel {a.label}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
