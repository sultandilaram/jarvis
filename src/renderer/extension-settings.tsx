import React, { useEffect, useRef, useState } from "react";
import {
  Plus,
  Upload,
  ChevronRight,
  ChevronLeft,
  Globe,
  Mail,
  CalendarDays,
  LockKeyhole,
} from "lucide-react";
import { GoogleSettings } from "./google-settings";
import type { Snapshot } from "../shared/types";
import type { Skill } from "../main/extensions/manager";
export function SkillSettings({ state }: { state: Snapshot }) {
  const [draft, setDraft] = useState<Partial<Skill> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [remove, setRemove] = useState("");
  const skills = state.extensions?.skills || [],
    waiting = !!state.activeTaskId;
  const act = async (fn: () => Promise<unknown>, success = "") => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The skill could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <p>
        Teach JARVIS your procedures, writing preferences and ways of working.
        Skills add instructions; they do not retrain a model or grant access.
      </p>
      <div className="settings-actions">
        <button
          disabled={busy || waiting}
          onClick={() =>
            setDraft({ name: "", text: "", scope: "all", enabled: false })
          }
        >
          <Plus size={16} />
          Create skill
        </button>
        <button
          disabled={busy || waiting}
          onClick={() =>
            void act(async () => {
              const s = await window.jarvis.skillImport();
              if (s) setDraft(s as Partial<Skill>);
            })
          }
        >
          <Upload size={16} />
          Import text or SKILL.md
        </button>
      </div>
      {!skills.length && !draft && (
        <section className="settings-no-results">
          <h3>Your procedures belong here</h3>
          <p>
            Start with one repeatable task, such as “Prepare my morning
            briefing”. Describe the steps and what a useful result looks like.
          </p>
        </section>
      )}
      <div className="extension-list">
        {skills.map((s) => (
          <section key={s.id} className="extension-row">
            <div className="extension-row-heading">
              <button
                className="extension-name"
                onClick={() => {
                  setDraft({ ...s });
                  setError("");
                }}
              >
                <span>
                  {s.name}
                  <small>
                    {s.scope === "all"
                      ? "All tasks"
                      : s.scope === "desktop"
                        ? "Desktop tasks"
                        : "Isolated project tasks"}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
              <label className="extension-enable">
                <input
                  type="checkbox"
                  aria-label={"Enable " + s.name}
                  checked={s.enabled}
                  disabled={busy || waiting}
                  onChange={(e) =>
                    void act(
                      () =>
                        window.jarvis.skillSave({
                          ...s,
                          enabled: e.target.checked,
                        }),
                      e.target.checked
                        ? "Skill enabled for new task context."
                        : "Skill disabled.",
                    )
                  }
                />
                <span>{s.enabled ? "On" : "Off"}</span>
              </label>
            </div>
            {remove === s.id ? (
              <p>
                Remove this saved skill?{" "}
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await window.jarvis.skillRemove(s.id);
                      setRemove("");
                      if (draft?.id === s.id) setDraft(null);
                    }, "Skill removed.")
                  }
                >
                  Remove skill
                </button>{" "}
                <button onClick={() => setRemove("")}>Keep skill</button>
              </p>
            ) : (
              <button
                className="subtle"
                disabled={busy || waiting}
                onClick={() => setRemove(s.id)}
              >
                Remove
              </button>
            )}
          </section>
        ))}
      </div>
      {draft && (
        <form
          className="provider-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await window.jarvis.skillSave(draft);
              setDraft(null);
            }, "Skill saved. Enabled instructions apply when a task context is created or resumed.");
          }}
        >
          <h3>{draft.id ? "Edit skill" : "New skill"}</h3>
          <label>
            Name
            <input
              required
              maxLength={80}
              value={draft.name || ""}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Instructions
            <textarea
              required
              value={draft.text || ""}
              maxLength={20000}
              placeholder="Describe the procedure, expected result and when to ask you for missing information."
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
          </label>
          <label>
            Use for
            <select
              value={draft.scope || "all"}
              onChange={(e) =>
                setDraft({ ...draft, scope: e.target.value as Skill["scope"] })
              }
            >
              <option value="all">All tasks</option>
              <option value="desktop">Desktop tasks</option>
              <option value="project">Isolated project tasks</option>
            </select>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={!!draft.enabled}
              onChange={(e) =>
                setDraft({ ...draft, enabled: e.target.checked })
              }
            />
            <span>Enable after saving</span>
          </label>
          <p className="muted small">
            Review imported text before enabling it. Scripts and bundled assets
            are not executed. Skills cannot override approvals. Keep passwords
            and API keys out of instructions; skill text is stored locally in
            the task database and may go to your task provider.
          </p>
          <div className="settings-actions">
            <button
              disabled={
                busy || waiting || !draft.name?.trim() || !draft.text?.trim()
              }
              type="submit"
            >
              Save skill
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel edit
            </button>
          </div>
        </form>
      )}
      {waiting && (
        <p role="status">
          Finish or pause the active task before changing skills.
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
export function PluginSettings({
  state,
  onOpenBrowser,
}: {
  state: Snapshot;
  onOpenBrowser: () => void;
}) {
  const [page, setPage] = useState<
      "catalog" | "gmail" | "calendar" | "external"
    >("catalog"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const detailHeading = useRef<HTMLHeadingElement>(null),
    lastAction = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (page === "catalog") lastAction.current?.focus();
    else detailHeading.current?.focus();
  }, [page]);
  const waiting = !!state.activeTaskId;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The plugin action did not complete.",
      );
    } finally {
      setBusy(false);
    }
  };
  const builtins =
    state.pluginCatalog?.filter((p) => p.kind === "built-in") ||
    (["gmail", "calendar"] as const).map((id) => ({
      id,
      name: id === "gmail" ? "Gmail" : "Google Calendar",
      connected: !!state.google?.[id],
      enabled: state.google?.plugins?.[id] ?? !!state.google?.[id],
      account: state.google?.[id]?.email,
      description:
        id === "gmail"
          ? "Find messages and read email summaries."
          : "Read upcoming events on your primary calendar.",
    }));
  const external = state.extensions?.plugins || [];
  return (
    <div className="plugin-manager">
      {page !== "catalog" && (
        <button
          className="subtle provider-back"
          onClick={() => setPage("catalog")}
        >
          <ChevronLeft size={16} />
          All plugins
        </button>
      )}
      {page !== "catalog" && (
        <h3 ref={detailHeading} tabIndex={-1}>
          {page === "external"
            ? "External plugins"
            : page === "gmail"
              ? "Gmail plugin"
              : "Google Calendar plugin"}
        </h3>
      )}
      <div
        hidden={page !== "catalog"}
        onClickCapture={(e) => {
          lastAction.current = (e.target as Element).closest("button");
        }}
      >
        <p>
          Embedded plugins are part of JARVIS. Built-in plugins connect your
          accounts. External plugins add tools from servers you choose.
        </p>
        <section className="plugin-category">
          <h3>Embedded</h3>
          <div className="plugin-catalog-row">
            <Globe size={23} />
            <div>
              <h4>
                JARVIS Browser{" "}
                <span className="plugin-kind">
                  <LockKeyhole size={12} />
                  Always on
                </span>
              </h4>
              <p>
                Multi-tab browsing in a separate JARVIS session. Sign in
                yourself, then hand a tab to your assistant.
              </p>
            </div>
            <button onClick={onOpenBrowser}>Open browser</button>
          </div>
          <p className="muted small">
            Required component · cannot be disabled. Manual takeover pauses
            automation without closing the browser.
          </p>
        </section>
        <section className="plugin-category">
          <h3>Built-in</h3>
          {builtins.map((p) => {
            const id = p.id as "gmail" | "calendar",
              Icon = id === "gmail" ? Mail : CalendarDays,
              connecting = state.google?.connecting === id;
            return (
              <div className="plugin-catalog-row" key={id}>
                <Icon size={23} />
                <div>
                  <h4>
                    {p.name}
                    <span className="plugin-kind">
                      {connecting
                        ? "Connecting…"
                        : p.enabled
                          ? "Enabled"
                          : p.connected
                            ? "Disabled"
                            : "Not connected"}
                    </span>
                  </h4>
                  <p>{p.account || p.description}</p>
                  {p.connected && (
                    <p className="muted small">
                      {state.google?.[id]?.write
                        ? "Read access and individually approved changes"
                        : "Read-only access"}
                    </p>
                  )}
                  <button
                    className="subtle plugin-manage"
                    onClick={() => setPage(id)}
                  >
                    Manage {p.name}
                  </button>
                </div>
                <div className="plugin-row-actions">
                  {connecting ? (
                    <button
                      onClick={() =>
                        void act(() => window.jarvis.googleCancel())
                      }
                    >
                      Cancel sign-in
                    </button>
                  ) : p.connected ? (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          window.jarvis.pluginEnable(id, !p.enabled),
                        )
                      }
                    >
                      {p.enabled ? "Disable" : "Enable"}
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() =>
                        state.google?.configured
                          ? void act(() =>
                              window.jarvis.googleConnect(id, false),
                            )
                          : setPage(id)
                      }
                    >
                      {state.google?.configured ? "Connect" : "Set up"} {p.name}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <p className="muted small">
            Connect starts Google’s consent in your system browser. Sending and
            event creation stay behind exact approval. Disabling keeps the saved
            account but blocks new plugin requests.
          </p>
        </section>
        <section className="plugin-category">
          <h3>External</h3>
          <p>
            Connect an MCP server using its URL and, if required, a token. No
            downloaded plugin programs run on this Mac.
          </p>
          <div className="plugin-external-summary">
            <span>
              {external.length
                ? `${external.filter((p) => p.enabled).length} enabled · ${external.length} configured`
                : "No external plugins configured"}
            </span>
            <button onClick={() => setPage("external")}>
              {external.length
                ? "Manage external plugins"
                : "Add external plugin"}
              <ChevronRight size={15} />
            </button>
          </div>
          <p className="muted small">
            Each external tool call shows its server, tool and exact arguments
            for approval.
          </p>
        </section>
      </div>
      <div hidden={page !== "gmail"}>
        <GoogleSettings state={state.google} serviceFilter="gmail" />
      </div>
      <div hidden={page !== "calendar"}>
        <GoogleSettings state={state.google} serviceFilter="calendar" />
      </div>
      <div hidden={page !== "external"}>
        <ExternalPluginSettings state={state} />
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
function ExternalPluginSettings({ state }: { state: Snapshot }) {
  const [draft, setDraft] = useState<{
      id?: string;
      name: string;
      endpoint: string;
      token: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [remove, setRemove] = useState("");
  const plugins = state.extensions?.plugins || [],
    waiting = !!state.activeTaskId;
  const act = async (fn: () => Promise<unknown>, success = "") => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fn();
      setMessage(
        r && typeof r === "object" && "cancelled" in r && r.cancelled
          ? "Connection cancelled."
          : success,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The plugin could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <p>
        Connect tools from a server you choose. Custom plugins use MCP over
        HTTP; JARVIS does not download or launch plugin programs.
      </p>
      <p className="muted small">
        Gmail and Calendar are built-in plugins. Phone access is under Devices.
        Custom plugin calls always show their server, tool and exact arguments
        for approval, including in Autopilot.
      </p>
      <button
        disabled={busy || waiting}
        onClick={() => setDraft({ name: "", endpoint: "", token: "" })}
      >
        <Plus size={16} />
        Add MCP server
      </button>
      {!plugins.length && !draft && (
        <section className="settings-no-results">
          <h3>No external plugins connected</h3>
          <p>
            Add a Streamable HTTP MCP endpoint from a server you trust. Local
            servers can use loopback HTTP; remote servers require HTTPS.
          </p>
        </section>
      )}
      <div className="extension-list">
        {plugins.map((p) => (
          <section key={p.id} className="extension-row">
            <div className="extension-row-heading">
              <button
                className="extension-name"
                onClick={() =>
                  setDraft({
                    id: p.id,
                    name: p.name,
                    endpoint: p.endpoint,
                    token: "",
                  })
                }
              >
                <span>
                  {p.name}
                  <small>
                    {p.enabled
                      ? p.connected
                        ? `${p.tools.length} tools loaded`
                        : "Enabled · reconnects when requested"
                      : "Disabled"}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
              <button
                disabled={busy || (waiting && !p.enabled)}
                onClick={() =>
                  void act(
                    () => window.jarvis.pluginEnable(p.id, !p.enabled),
                    p.enabled
                      ? "Plugin disabled. Pending calls cannot start."
                      : "Plugin connected. Review its tools below.",
                  )
                }
              >
                {p.enabled ? "Disable" : "Enable and load tools"}
              </button>
            </div>
            <p className="muted small">{p.endpoint}</p>
            {!!p.tools.length && (
              <details>
                <summary>Inspect {p.tools.length} tools</summary>
                {p.tools.map((t) => (
                  <details key={t.name}>
                    <summary>{t.name}</summary>
                    <p>
                      {t.description ||
                        "No description supplied by the server."}
                    </p>
                    <pre>{JSON.stringify(t.inputSchema, null, 2)}</pre>
                  </details>
                ))}
              </details>
            )}
            {remove === p.id ? (
              <p>
                Remove this connection and saved token?{" "}
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await window.jarvis.pluginRemove(p.id);
                      setRemove("");
                      if (draft?.id === p.id) setDraft(null);
                    }, "Plugin connection removed. Revoke its token at the provider separately if needed.")
                  }
                >
                  Remove connection
                </button>{" "}
                <button onClick={() => setRemove("")}>Keep connection</button>
              </p>
            ) : (
              <button
                className="subtle"
                disabled={busy}
                onClick={() => setRemove(p.id)}
              >
                Remove
              </button>
            )}
          </section>
        ))}
      </div>
      {draft && (
        <form
          className="provider-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await window.jarvis.pluginSave(draft);
              setDraft(null);
            }, "Connection saved and disabled. Enable it to review access and load its tools.");
          }}
        >
          <h3>{draft.id ? "Edit MCP server" : "New MCP server"}</h3>
          <label>
            Name
            <input
              required
              maxLength={80}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            MCP endpoint
            <input
              required
              type="url"
              placeholder="https://your-server.example/mcp"
              value={draft.endpoint}
              onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })}
            />
          </label>
          <label>
            Bearer token (if required)
            <input
              type="password"
              autoComplete="new-password"
              value={draft.token}
              placeholder={
                plugins.find((p) => p.id === draft.id)?.hasToken
                  ? "Saved securely · leave blank to keep for the same server"
                  : "Optional server token"
              }
              onChange={(e) => setDraft({ ...draft, token: e.target.value })}
            />
          </label>
          <p className="muted small">
            Tokens are encrypted on this Mac. A server change clears the
            previous token. Saving does not connect; enabling requires a
            separate access review. OAuth sign-in and stdio plugins are not
            supported in this version.
          </p>
          <div className="settings-actions">
            <button
              type="submit"
              disabled={
                busy || waiting || !draft.name.trim() || !draft.endpoint.trim()
              }
            >
              Save connection
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel edit
            </button>
          </div>
        </form>
      )}
      <p className="muted small">
        Disabling stops JARVIS from starting new calls and cancels local waits.
        A remote action already received by a server may still finish; inspect
        its outcome before retrying.
      </p>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
