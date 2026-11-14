import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import type { Snapshot } from "../shared/types";
import type { ProviderKind } from "../main/providers/protocol";
const names: Record<ProviderKind, string> = {
  codex: "Codex",
  "openai-compatible": "OpenAI-compatible",
  ollama: "Ollama",
  anthropic: "Claude",
  gemini: "Gemini",
};
const endpoints: Record<ProviderKind, string> = {
  codex: "",
  "openai-compatible": "https://api.openai.com/v1",
  ollama: "http://127.0.0.1:11434",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};
export function ProviderSettings({ state }: { state: Snapshot }) {
  const [editing, setEditing] = useState<ProviderKind | null>(null),
    [endpoint, setEndpoint] = useState(""),
    [model, setModel] = useState(""),
    [key, setKey] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const editorHeading = useRef<HTMLHeadingElement>(null),
    listHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    (editing === null ? listHeading : editorHeading).current?.focus();
  }, [editing]);
  const current = state.providers?.selected || "codex",
    profile = state.providers?.profiles.find((p) => p.kind === editing);
  const waiting = !!state.activeTaskId || !!state.remote?.voiceActive,
    working = busy || !!state.providers?.testing;
  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fn();
      setMessage(
        r && typeof r === "object" && "cancelled" in r && r.cancelled
          ? "Change cancelled."
          : success,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The provider could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  };
  const edit = (kind: ProviderKind) => {
    const p = state.providers?.profiles.find((p) => p.kind === kind);
    setEditing(kind);
    setEndpoint(p?.endpoint || endpoints[kind]);
    setModel(p?.model || "");
    setKey("");
    setError("");
    setMessage("");
  };
  return (
    <div>
      <div className="settings-status-row">
        <span>Current task engine</span>
        <span>
          {names[current]} · {state.model || "Connecting"}
        </span>
      </div>
      <p>
        Choose who reasons through your tasks. Every provider uses JARVIS’s
        tools and approval rules. Voice is configured separately.
      </p>
      {editing === null && (
        <>
          <h3 ref={listHeading} tabIndex={-1}>
            Task providers
          </h3>
          <div className="provider-list" aria-label="Task providers">
            {(Object.keys(names) as ProviderKind[]).map((kind) => {
              const p = state.providers?.profiles.find((p) => p.kind === kind);
              return (
                <button key={kind} onClick={() => edit(kind)}>
                  <span>
                    {names[kind]}
                    <small>
                      {kind === "codex"
                        ? "Your existing Codex sign-in"
                        : p?.model
                          ? (p.toolsVerified
                              ? "Tools verified · "
                              : "Conversation only · ") + p.model
                          : kind === "ollama"
                            ? "Run a model on this Mac"
                            : "Your API account or compatible server"}
                    </small>
                  </span>
                  {current === kind ? (
                    <Check size={18} aria-label="Active provider" />
                  ) : (
                    <ChevronRight size={17} aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
      {editing !== null && (
        <button
          className="subtle"
          disabled={working}
          onClick={() => {
            setEditing(null);
            setKey("");
          }}
        >
          All task providers
        </button>
      )}
      {editing === "codex" ? (
        <section>
          <h3 ref={editorHeading} tabIndex={-1}>
            Codex
          </h3>
          <p>
            Keep your existing coding and task engine. JARVIS’s desktop tools,
            project sandbox and approvals remain in control.
          </p>
          <button
            disabled={working || waiting || current === "codex"}
            onClick={() =>
              void act(
                () => window.jarvis.providerSelect("codex"),
                "Codex selected. A new conversation is ready.",
              )
            }
          >
            Use Codex
          </button>
        </section>
      ) : (
        editing !== null && (
          <section
            className="provider-editor"
            aria-label={names[editing] + " configuration"}
          >
            <h3 ref={editorHeading} tabIndex={-1}>
              {names[editing]} connection
            </h3>
            <label>
              Server base URL
              <input
                type="url"
                value={endpoint}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setEndpoint(e.target.value)}
              />
            </label>
            <label>
              Model identifier
              <input
                value={model}
                autoComplete="off"
                spellCheck={false}
                placeholder="Enter the exact model installed or available to your account"
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
            <label>
              API key{" "}
              {editing === "ollama" ? "(optional for a local server)" : ""}
              <input
                type="password"
                value={key}
                autoComplete="new-password"
                placeholder={
                  profile?.hasKey
                    ? "Saved securely · leave blank to keep for the same server"
                    : "Enter this provider’s key if required"
                }
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <p className="muted small">
              Credentials are encrypted on this Mac. Changing the server clears
              its old key. Task instructions and requested content go to the
              selected server; HTTP is allowed only for local loopback. Local
              task models do not make OpenAI voice local.
            </p>
            <div className="settings-actions">
              <button
                disabled={
                  working || waiting || !endpoint.trim() || !model.trim()
                }
                onClick={() =>
                  void act(async () => {
                    const r = await window.jarvis.providerSave({
                      kind: editing,
                      endpoint: endpoint.trim(),
                      model: model.trim(),
                      key: key || undefined,
                    });
                    if (!r?.cancelled) setKey("");
                    return r;
                  }, "Connection saved. Test structured tools before using it for tasks.")
                }
              >
                Save connection
              </button>
              <button
                disabled={working || waiting || !profile?.model}
                onClick={() =>
                  void act(
                    () => window.jarvis.providerTest(editing),
                    "Structured tool calling and result continuation passed. Select Use provider to start fresh.",
                  )
                }
              >
                {busy ? (
                  <>
                    <Loader2 size={15} aria-hidden="true" /> Working…
                  </>
                ) : (
                  "Test model and tools"
                )}
              </button>
              <button
                disabled={working || waiting || !profile?.model}
                onClick={() =>
                  void act(
                    () => window.jarvis.providerTestVision(editing),
                    "Synthetic image reading passed. Real desktop acceptance is a separate check.",
                  )
                }
              >
                Test vision
              </button>
              <button
                disabled={working || waiting || !profile?.model}
                onClick={() =>
                  void act(
                    () => window.jarvis.providerSelect(editing),
                    "Provider selected. Prior conversations remain in history.",
                  )
                }
              >
                Use provider
              </button>
              {profile?.model && current !== editing && (
                <button
                  className="subtle"
                  disabled={working || waiting}
                  onClick={() =>
                    void act(
                      () => window.jarvis.providerRemove(editing),
                      "Connection and saved key removed from JARVIS.",
                    )
                  }
                >
                  Remove connection
                </button>
              )}
            </div>
            <p className="muted small">
              The test sends two small requests to this server and may incur
              provider charges. It invokes no desktop actions. Models that fail
              the tool probe remain conversation-only.
            </p>
            <p className="muted small">
              Vision is optional. Its test sends one generated number image; it
              never captures your desktop. Captured windows can be sent only
              after vision passes. Your provider may keep its own history.
            </p>
            <p role="status">
              Tools: {profile?.toolsVerified ? "verified" : "not verified"} ·
              Window images:{" "}
              {profile?.visionVerified ? "verified" : "not verified"}
            </p>
          </section>
        )
      )}
      {waiting && (
        <p role="status">
          Finish or pause current work and end voice before changing providers.
        </p>
      )}
      {state.providers?.testing && (
        <button
          className="subtle"
          onClick={() => void window.jarvis.providerCancelTest()}
        >
          Cancel provider test
        </button>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
