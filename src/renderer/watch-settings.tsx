import { MonitorList } from "./jobs";
import React, { useState } from "react";
import type { Snapshot } from "../shared/types";
export function WatchSettings({
  state,
  run,
}: {
  state: Snapshot;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void run(fn).finally(() => setBusy(false));
  };
  const data = state.watches;
  const phones = state.remote?.phones.filter((p) => p.alertsEnabled) || [];
  return (
    <details className="settings-section" open>
      <summary>Watches and updates</summary>
      <p>
        Watches run while this Mac is awake, online and JARVIS is open,
        including in the menu bar. Polling uses no AI credits. Answered voice
        uses API credits.
      </p>
      <h3>Task updates</h3>
      {data?.taskPhone ? (
        <>
          <p>
            Mac first. If you do not acknowledge within 60 minutes, JARVIS
            requests one call to {data.taskPhone.name}.
          </p>
          <button
            disabled={busy}
            onClick={() => act(() => window.jarvis.watchRemove("tasks"))}
          >
            Disable task phone escalation
          </button>
        </>
      ) : (
        <>
          <p>
            Task completion, information requests and approval requests notify
            this Mac. To escalate unacknowledged updates, choose a phone.
            Clicking a notification opens JARVIS; use Acknowledge to stop
            escalation.
          </p>
          <label>
            Phone for task updates
            <select value={phone} onChange={(e) => setPhone(e.target.value)}>
              <option value="">Choose a phone</option>
              {phones.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Enable authorizes future task, information and approval updates to
            this phone: Mac notification first, one call after 60 minutes
            without acknowledgment. The call may include the task result. No
            automatic task execution.
          </p>
          <button
            disabled={busy || !phone}
            onClick={() => act(() => window.jarvis.watchEnableTasks(phone))}
          >
            Enable task alerts and phone escalation
          </button>
        </>
      )}
      <MonitorList
        items={state.monitors}
        control={(id, a) => window.jarvis.monitorControl(id, a)}
        run={run}
      />
      <h3>Price watches</h3>
      <p>
        Ask JARVIS to watch a symbol, with an exact percentage drop and time
        window. Review the rule and phone before approval. Coinbase USD quotes
        are checked once per minute. Each watch pauses after one alert; there is
        no trading.
      </p>
      {!data?.watches.length && (
        <p className="muted">No price watches configured.</p>
      )}
      {data?.watches.map((w) => (
        <article key={w.id} className="watch-row">
          <strong>
            {w.symbol} · {w.enabled ? "Watching" : "Paused"}
          </strong>
          <p>
            {w.dropPercent}% below the observed high within {w.windowMinutes}{" "}
            minutes. Escalation: {w.phoneName} after 60 minutes.
          </p>
          {w.lastCheck && (
            <p className="muted">
              Last check: {new Date(w.lastCheck).toLocaleString()}
            </p>
          )}
          {w.error && <p role="status">{w.error}</p>}
          <button
            disabled={busy}
            onClick={() => act(() => window.jarvis.watchRemove(w.id))}
          >
            Remove {w.symbol} watch
          </button>
        </article>
      ))}
      <h3>Recent updates</h3>
      {!data?.updates.length && <p className="muted">No updates yet.</p>}
      {data?.updates
        .filter((u, i) => !u.acknowledgedAt || i < 10)
        .map((u) => (
          <article className="watch-row" key={u.id}>
            <p>{u.text}</p>
            <p className="muted">
              {u.resolvedAt
                ? "Request resolved · no further escalation"
                : u.acknowledgedAt
                  ? "Acknowledged"
                  : u.state === "waiting"
                    ? `Call ${u.phoneName} if unacknowledged by ${new Date(u.dueAt).toLocaleString()}`
                    : u.state === "requested"
                      ? "Call requested · delivery not confirmed"
                      : u.state === "local"
                        ? "Mac notification only"
                        : u.state === "cancelled"
                          ? "Phone escalation cancelled"
                          : u.state === "calling"
                            ? "Requesting phone call"
                            : "Call request failed"}
            </p>
            {u.error && <p role="status">{u.error}</p>}
            {!u.acknowledgedAt && !u.resolvedAt && (
              <button
                disabled={busy}
                onClick={() => act(() => window.jarvis.watchAcknowledge(u.id))}
              >
                Acknowledge update
              </button>
            )}
          </article>
        ))}
      <button
        disabled={busy}
        onClick={() => act(() => window.jarvis.watchPauseAll())}
      >
        Pause all watches and cancel pending calls
      </button>
    </details>
  );
}
