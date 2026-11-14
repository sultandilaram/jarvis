import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  AudioLines,
  Check,
  ChevronRight,
  Command,
  FileText,
  History,
  Maximize2,
  Mic,
  Plus,
  Settings as SettingsIcon,
  Shield,
  Square,
  Trash2,
  X,
  Brain,
  Activity,
  Bell,
  MessageSquare,
  Loader2,
  Globe,
} from "lucide-react";
import type { Approval, Snapshot, Settings, VoiceEvent } from "../shared/types";
import { Voice, type VoiceState } from "./voice";
import { BrowserPane } from "./browser-pane";
import { MaintenanceSettings } from "./maintenance-settings";
import { UpdateSettings } from "./update-settings";
import { JobsPanel } from "./jobs";
import { WatchSettings } from "./watch-settings";
import { RemoteSettings } from "./remote-settings";
import { HudCore } from "./hud";
import "./style.css";
import "./voice-layout.css";
import { SettingsMenu, SettingsPage } from "./settings-menu";
import { ProviderSettings } from "./provider-settings";
import { SkillSettings, PluginSettings } from "./extension-settings";
import { ActionPreview } from "./action-preview";
function App() {
  const [state, setState] = useState<Snapshot>();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<"voice" | "chats" | "browser">("voice");
  const [panelOpen, setPanelOpen] = useState(false);
  async function goView(next:"voice"|"chats"|"browser"){await window.jarvis.browserSurface?.(false);setView(next);}
  async function openSettings(){await window.jarvis.browserSurface?.(false);setSettingsOpen(true);}
  async function openPluginBrowser(){await window.jarvis.browserSurface?.(false);setSettingsOpen(false);setView("browser");}
  useEffect(()=>window.jarvis.onBrowserReveal?.(()=>void goView("browser")),[]);

  const [tab, setTab] = useState<"activity" | "history" | "memory">("activity");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("off");
  const [caption, setCaption] = useState("");
  const [voiceLog, setVoiceLog] = useState<VoiceEvent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [access, setAccess] = useState("");
  const [memory, setMemory] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const voice = useRef<Voice | null>(null);
  useEffect(() => {if(state)void window.jarvis.rendererReady?.();}, [!!state]);
  const stateRef = useRef<Snapshot | undefined>(undefined);
  const speaking = useRef("");
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError("");
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    voice.current = new Voice(
      (s, c) => {
        setVoiceState(s);
        if (c) setCaption(c);
      },
      setError,
      (event) => {
        setVoiceLog((log) => [...log.slice(-29), event]);
        void window.jarvis.voiceEvent(event).catch(() => {});
      },
    );
    const apply = (s: Snapshot) => {
      stateRef.current = s;
      setState(s);
      voice.current?.observe(s);
    };
    const offWake = window.jarvis.onWake(() => {
      const current = stateRef.current;
      if (!current?.hasApiKey) {
        setError(
          "Wake detected, but an API key is required for the conversation.",
        );
        void openSettings();
        void window.jarvis.voiceActivity(false);
        return;
      }
      void voice.current?.connect(current, true);
    });
    const off = window.jarvis.onState(apply);
    void window.jarvis
      .snapshot()
      .then(apply)
      .catch((e) => setError(String(e)));
    const offStop = window.jarvis.onStop(() => {
      voice.current?.disconnect();
      speechSynthesis.cancel();
    });
    const shortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "Period") {
        e.preventDefault();
        void run(() => window.jarvis.stop());
      }
      if (e.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", shortcut);
    return () => {
      off();
      offWake();
      offStop();
      voice.current?.disconnect();
      window.removeEventListener("keydown", shortcut);
    };
  }, []);
  useEffect(() => {
    if (state?.approvals.length) {
      setTab("activity");
      setPanelOpen(true);
    }
  }, [state?.approvals[0]?.id, state?.activeTaskId]);
  useEffect(() => {
    if (view === "chats") bottom.current?.scrollIntoView({ block: "end" });
  }, [state?.entries.length, state?.entries.at(-1)?.text, selected, view]);
  useEffect(() => {
    if (
      !state ||
      !state.settings.speakReplies ||
      !["off", "error"].includes(voiceState) ||
      state.activeTaskId
    )
      return;
    const last = state.entries.filter((e) => e.role === "assistant").at(-1);
    // Only speak new completions in this run, never replay history at startup.
    if (!speaking.current) {
      speaking.current = last?.id || "initialized";
      return;
    }
    if (last && last.id !== speaking.current) {
      speaking.current = last.id;
      const utterance = new SpeechSynthesisUtterance(
        last.text
          .replace(/\[(Certain|Likely|Guessing)\]\s*/g, "")
          .slice(0, 1600),
      );
      utterance.lang = "en-GB";
      const british =
        speechSynthesis
          .getVoices()
          .find(
            (v) => v.lang === "en-GB" && /Daniel|Oliver|Arthur/i.test(v.name),
          ) || speechSynthesis.getVoices().find((v) => v.lang === "en-GB");
      if (british) utterance.voice = british;
      utterance.rate = 0.94;
      utterance.onstart = () => setVoiceState("speaking");
      utterance.onend = () => setVoiceState("off");
      speechSynthesis.speak(utterance);
    }
  }, [
    state?.activeTaskId,
    state?.entries.length,
    state?.settings.speakReplies,
  ]);
  if (!state)
    return (
      <div className="loading">
        <Loader2 className="spin" /> Starting your workspace…
        {error && <p>{error}</p>}
      </div>
    );
  const active = !!state.activeTaskId;
  const currentId =
    state.activeTaskId ||
    selected ||
    state.tasks.find((t) => t.threadId)?.id ||
    state.tasks[0]?.id;
  const currentTask = state.tasks.find((t) => t.id === currentId);
  const entries = selected
    ? state.entries.filter((e) => e.taskId === selected)
    : state.entries.filter((e) => e.role !== "activity");
  const activity = state.entries.filter(
    (e) => e.role === "activity" && (!currentId || e.taskId === currentId),
  );
  const needsInput =
    state.approvals[0]?.method === "item/tool/requestUserInput";
  const displayState =
    state.status === "error"
      ? "Needs attention"
      : state.status === "approval"
        ? needsInput
          ? "Needs your input"
          : "Awaiting approval"
        : state.status === "stopping"
          ? "Stopping"
          : voiceState === "speaking"
            ? "Speaking"
            : voiceState === "listening"
              ? "Listening"
              : voiceState === "connecting"
                ? "Connecting voice"
                : active
                  ? "Processing request"
                  : state.status === "connecting"
                    ? "Establishing execution link"
                    : state.background?.wake.state === "listening"
                      ? "Local standby · Hey JARVIS"
                      : "Ready when you are";
  const send = () => {
    const value = text;
    if (!value.trim()) return;
    setText("");
    setSelected(null);
    void run(() => window.jarvis.send(value));
  };
  const patch = (p: Partial<Settings>) =>
    void run(() => window.jarvis.settings(p));
  const toggleVoice = () => {
    if (!["off", "error"].includes(voiceState)) {
      voice.current?.disconnect();
      return;
    }
    if (!state.hasApiKey) {
      void openSettings();
      setAccess(
        "Voice needs a project API key. Text and Codex remain available.",
      );
      return;
    }
    void voice.current?.connect(state);
  };
  const needsReview = state.approvals.length > 0;
  const panelVisible = panelOpen || needsReview;
  const panelTab = tab;
  const liveVoice = !["off", "error"].includes(voiceState);
  const openPanel = async (next: typeof tab) => {
    await window.jarvis.browserSurface?.(false);
    setTab(next);
    setPanelOpen(!panelOpen || tab !== next);
  };
  const stopAll = () => {
    voice.current?.disconnect();
    speechSynthesis.cancel();
    void run(() => window.jarvis.stop());
  };
  const voicePrompt = needsReview
    ? "Your authorization is required."
    : state.status === "error"
      ? "The execution link needs attention."
      : voiceState === "error"
        ? "Let’s restore the voice connection."
        : voiceState === "speaking"
          ? "At your service, sir."
          : voiceState === "listening"
            ? "Go ahead. I’m listening."
            : voiceState === "connecting"
              ? "Connecting your conversation…"
              : active
                ? "Attending to your request."
                : state.background?.wake.state === "listening"
                  ? "Say “Hey JARVIS”."
                  : "Ready when you are.";
  return (
    <div
      className={`shell voice-first view-${view} ${panelVisible ? "panel-visible" : ""} ${view === "chats" && (active || entries.length || state.status === "error") ? "has-work" : ""}`}
    >
      <aside className="rail">
        <div className="mark">
          <img src="brand/jarvis-64.png" alt="JARVIS emblem" />
        </div>
        <button
          className={view === "voice" ? "rail-button selected" : "rail-button"}
          title="Voice"
          aria-label="Voice"
          aria-pressed={view === "voice"}
          onClick={() => void goView("voice")}
        >
          <AudioLines size={20} />
        </button>
        <button
          className={view === "chats" ? "rail-button selected" : "rail-button"}
          title="Chats"
          aria-label="Chats"
          aria-pressed={view === "chats"}
          onClick={() => void goView("chats")}
        >
          <MessageSquare size={20} />
        </button>
        <button className={view==="browser"?"rail-button selected":"rail-button"} title="Browser" aria-label="Browser" aria-pressed={view==="browser"} onClick={()=>void goView("browser")}><Globe size={20}/></button>
        <span className="rail-separator" />
        <button
          className={
            panelVisible && panelTab === "activity"
              ? "rail-button selected"
              : "rail-button"
          }
          title="Activity"
          aria-label="Activity"
          aria-expanded={panelVisible && panelTab === "activity"}
          onClick={() => openPanel("activity")}
        >
          <Activity size={20} />
          {needsReview && <span className="rail-notification" />}
        </button>
        <button
          className={
            panelVisible && panelTab === "history"
              ? "rail-button selected"
              : "rail-button"
          }
          title="Jobs"
          aria-label="Jobs"
          onClick={() => openPanel("history")}
        >
          <History size={20} />
        </button>
        <button
          className={
            panelVisible && panelTab === "memory"
              ? "rail-button selected"
              : "rail-button"
          }
          title={needsReview ? "Review the pending action first" : "Memory"}
          aria-label="Memory"
          disabled={needsReview}
          onClick={() => openPanel("memory")}
        >
          <Brain size={20} />
        </button>
        <div className="rail-bottom">
          <button
            className="rail-button"
            title="Settings"
            aria-label="Settings"
            onClick={() => void openSettings()}
          >
            <SettingsIcon size={20} />
          </button>
          {!!state.watches?.updates.some(
            (u) => !u.acknowledgedAt && u.state !== "cancelled",
          ) && (
            <button
              className="rail-button"
              title="Unacknowledged updates"
              aria-label="Updates"
              onClick={() => void openSettings()}
            >
              <Bell size={20} />
            </button>
          )}
          <div className="avatar">JV</div>
        </div>
      </aside>
      <main className="workspace">
        <header>
          <div className="brand">
            J.A.R.V.I.S. <span>PERSONAL OPERATING INTERFACE</span>
          </div>
          <div
            className="view-switch"
            role="tablist"
            aria-label="Main view"
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const views=["voice","chats","browser"] as const;
              const index=views.indexOf(view);
              const next=views[event.key==="Home"?0:event.key==="End"?2:(index+(event.key==="ArrowRight"?1:2))%3];
              void goView(next);
              event.currentTarget
                .querySelector<HTMLButtonElement>(`#tab-${next}`)
                ?.focus();
            }}
          >
            <button
              id="tab-voice"
              role="tab"
              aria-selected={view === "voice"}
              aria-controls="voice-view"
              tabIndex={view === "voice" ? 0 : -1}
              onClick={() => void goView("voice")}
            >
              <AudioLines size={16} /> Voice
            </button>
            <button
              id="tab-chats"
              role="tab"
              aria-selected={view === "chats"}
              aria-controls="chats-view"
              tabIndex={view === "chats" ? 0 : -1}
              onClick={() => void goView("chats")}
            >
              <MessageSquare size={16} /> Chats
            </button>
            <button id="tab-browser" role="tab" aria-selected={view==="browser"} aria-controls="browser-view" tabIndex={view==="browser"?0:-1} onClick={()=>void goView("browser")}><Globe size={16}/>Browser</button>
          </div>
          <div className="header-actions">
            <span className="local" role="status">
              <i />{" "}
              {state.status === "error"
                ? "ATTENTION REQUIRED"
                : state.status === "connecting"
                  ? "CONNECTING"
                  : voiceState === "connecting"
                    ? "VOICE / CONNECTING"
                    : !["off", "error"].includes(voiceState)
                      ? "VOICE / CONNECTED"
                      : "LOCAL / STANDBY"}
            </span>
            <button
              className={`global-stop ${active || liveVoice || needsReview ? "available" : ""}`}
              aria-label="Stop all work"
              title="Stop voice and all work · ⌘ ⇧ ."
              onClick={stopAll}
            >
              <Square size={12} fill="currentColor" /> Stop
            </button>
            <button
              className="icon-button"
              title="Toggle fullscreen"
              aria-label="Toggle fullscreen"
              onClick={() => void run(() => window.jarvis.fullscreen())}
            >
              <Maximize2 size={16} />
            </button>
          </div>
        </header>
        <div id="voice-playback" />
        {(error || state.error) && (
          <div className="workspace-error error" role="alert">
            <div>
              {error || state.error}
              {state.error && (
                <details className="error-recovery">
                  <summary>Recovery steps</summary>
                  <p>
                    If this persists, quit and reopen JARVIS. Completed actions
                    are not undone. Check your connection and sign-in if the
                    link cannot reconnect.
                  </p>
                </details>
              )}
            </div>
            {!state.error && (
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            )}
          </div>
        )}
        {view === "browser" ? <BrowserPane state={state.browser} visible={!settingsOpen&&!needsReview} layoutKey={panelVisible}/> : view === "voice" ? (
          <section
            id="voice-view"
            className={`voice-view ${state.status === "error" || voiceState === "error" ? "is-fault" : ""}`}
            role="tabpanel"
            aria-labelledby="tab-voice"
          >
            <h1 className="sr-only">JARVIS voice interface</h1>
            <div className="voice-stage">
              <HudCore
                state={state}
                voiceState={voiceState}
                onVoice={toggleVoice}
              />
              <div className="voice-prompt">
                <p>{voicePrompt}</p>
                <span>
                  {needsReview
                    ? "Review the exact action before approving it."
                    : liveVoice
                      ? "You can correct me, or say “Stop” at any time."
                      : state.background?.wake.state === "listening"
                        ? "Wait for “I’m listening,” then speak your request."
                        : "Start a conversation with the core or the button below."}
                </span>
              </div>
            </div>
            <div className="voice-caption-slot">
              {caption && liveVoice && (
                <div
                  className="voice-caption"
                  aria-label="Live caption"
                  tabIndex={0}
                >
                  {caption}
                </div>
              )}
              {active && !needsReview && (
                <button
                  className="voice-task"
                  onClick={() => {
                    setTab("activity");
                    setPanelOpen(true);
                  }}
                >
                  <Loader2 size={15} className="spin" />
                  <span>{currentTask?.title || "Work is in progress"}</span>
                  <ChevronRight size={15} />
                </button>
              )}
            </div>
            <div className="voice-controls">
              <button
                className={`voice-call ${liveVoice ? "connected" : ""}`}
                onClick={toggleVoice}
              >
                <AudioLines size={18} />
                {liveVoice ? "End conversation" : "Talk to JARVIS"}
              </button>
              <p>
                {voiceState === "connecting"
                  ? "Connecting voice conversation…"
                  : liveVoice
                    ? "Voice conversation connected"
                    : state.background?.wake.state === "listening"
                      ? "Local wake is on · No API voice session open"
                      : "Voice is off"}
              </p>
            </div>
          </section>
        ) : (
          <section
            id="chats-view"
            className="chats-view"
            role="tabpanel"
            aria-labelledby="tab-chats"
          >
            <div className="conversation-heading">
              <h1>{selected ? "Task conversation" : "Conversation"}</h1>
              <button
                className="subtle"
                onClick={() => void run(() => window.jarvis.newConversation())}
                disabled={active}
              >
                <Plus size={15} /> New conversation
              </button>
            </div>
            {state.approvals.length > 0 && (
              <div className="review-notice" role="status">
                <span>
                  {state.approvals.length}{" "}
                  {state.approvals.length === 1
                    ? "action needs"
                    : "actions need"}{" "}
                  your review
                </span>
                <button
                  className="subtle"
                  onClick={() => {
                    setTab("activity");
                    setPanelOpen(true);
                    requestAnimationFrame(() =>
                      document
                        .querySelector<HTMLElement>(".approval-card")
                        ?.scrollIntoView({ block: "nearest" }),
                    );
                  }}
                >
                  {needsInput ? "Answer question" : "Review action"}
                </button>
              </div>
            )}
            <div className="transcript-heading">
              <span>COMMUNICATIONS LOG</span>
              <span>
                {state.status === "error"
                  ? "NEEDS ATTENTION"
                  : state.status === "connecting"
                    ? "CONNECTING"
                    : state.approvals.length
                      ? "REVIEW REQUIRED"
                      : active
                        ? "TASK IN PROGRESS"
                        : "STANDING BY"}
              </span>
            </div>
            <section className="conversation" aria-label="Conversation">
              {entries.length === 0 ? (
                <div className="welcome">
                  <h2>What shall we attend to?</h2>
                  <p>
                    Speak your request, sir. I’ll keep the details in order.
                  </p>
                  <div className="suggestions">
                    <button
                      onClick={() =>
                        setText(
                          "Open TextEdit. Wait for my approval before launching it.",
                        )
                      }
                    >
                      <Command size={18} />
                      <span>
                        Launch an application
                        <small>An approved action on your Mac</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                    <button
                      onClick={() => void run(() => window.jarvis.readFile())}
                    >
                      <FileText size={18} />
                      <span>
                        Read a local file
                        <small>You choose what I can see</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                entries.map((e) => (
                  <article key={e.id} className={`message ${e.role}`}>
                    <div className="message-label">
                      {e.role === "user"
                        ? "YOU"
                        : e.role === "assistant"
                          ? "JARVIS"
                          : "SESSION"}
                      <span>
                        {new Date(e.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="message-text">{e.text}</div>
                  </article>
                ))
              )}
              {active && (
                <div className="thinking">
                  <span className="pulse-dot" />{" "}
                  {state.status === "approval"
                    ? needsInput
                      ? "Your answer is needed in the activity panel."
                      : "Your approval is needed in the activity panel."
                    : "Work is in progress. You may give a correction at any time."}
                </div>
              )}
              <div ref={bottom} />
            </section>
            <div className="composer-area">
              {caption && voiceState !== "off" && (
                <div className="caption">{caption}</div>
              )}
              <div className="composer">
                <textarea
                  aria-label="Message JARVIS"
                  placeholder={
                    active
                      ? "Add a detail, or change direction…"
                      : "Your instruction, sir…"
                  }
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <div className="composer-tools">
                  <div>
                    <button
                      className="icon-button"
                      title="Read a selected file"
                      aria-label="Read a selected file"
                      disabled={active}
                      onClick={() => void run(() => window.jarvis.readFile())}
                    >
                      <Plus size={19} />
                    </button>
                    <span className="model-label">
                      {state.model || "Connecting to Codex"}
                    </span>
                  </div>
                  <div>
                    <button
                      className={`icon-button mic ${!["off", "error"].includes(voiceState) ? "enabled" : ""}`}
                      title="Toggle voice"
                      aria-label="Toggle voice"
                      onClick={toggleVoice}
                    >
                      <Mic size={18} />
                    </button>
                    <button
                      className="send"
                      aria-label={active ? "Send correction" : "Send message"}
                      onClick={send}
                      disabled={
                        !text.trim() ||
                        state.status === "connecting" ||
                        state.status === "stopping"
                      }
                    >
                      <ArrowUp size={19} />
                    </button>
                  </div>
                </div>
              </div>
              <footer>
                <span>
                  <i className={`state-dot ${active ? "active" : ""}`} />
                  {displayState}
                </span>
                <span>
                  Enter to send <kbd>↵</kbd>
                  <span className="divider">·</span> Shift + Enter for a new
                  line
                </span>
              </footer>
            </div>
          </section>
        )}
      </main>
      {panelVisible && (
        <aside
          className="panel"
          aria-label={needsReview ? "Action review" : "Activity and details"}
        >
          <div className="panel-title">
            <span>
              {panelTab === "activity"
                ? "ACTIVITY"
                : panelTab === "history"
                  ? "JOBS"
                  : "MEMORY"}
            </span>
            <span className="badge">
              {panelTab === "history"
                ? state.jobs?.length || 0
                : panelTab === "memory"
                  ? state.memories.length
                  : "LIVE"}
            </span>
            {!needsReview && (
              <button
                className="icon-button"
                aria-label="Close details"
                onClick={() => setPanelOpen(false)}
              >
                <X size={17} />
              </button>
            )}
          </div>
          {panelTab === "activity" ? (
            <>
              <div className="task-status">
                <div className="task-icon">
                  {state.status === "error" ? (
                    <X size={19} />
                  ) : needsReview ? (
                    <Shield size={19} />
                  ) : active ? (
                    <Loader2 size={19} className="spin" />
                  ) : (
                    <Check size={19} />
                  )}
                </div>
                <div>
                  <h3>
                    {state.status === "error"
                      ? "Needs attention"
                      : state.status === "connecting"
                        ? "Connecting"
                        : state.approvals.length
                          ? "Review required"
                          : active
                            ? "Work in progress"
                            : currentTask
                              ? "Last task"
                              : "All clear"}
                  </h3>
                  <p>
                    {state.status === "error"
                      ? "The execution link needs attention."
                      : state.status === "connecting"
                        ? "Establishing the execution link."
                        : currentTask?.title || "The next move is yours."}
                  </p>
                </div>
              </div>
              <div className="status-card">
                <span className="eyebrow">EXECUTION</span>
                <p>
                  <i className="state-dot" />
                  {state.status === "error"
                    ? "Unavailable"
                    : state.status === "connecting"
                      ? "Connecting"
                      : state.approvals.length
                        ? "Awaiting your review"
                        : active
                          ? state.status
                          : currentTask?.status || "Idle"}
                </p>
                <small>One task at a time · Actions require approval</small>
              </div>
              {state.approvals.map((a) => (
                <ApprovalCard key={a.id} approval={a} run={run} />
              ))}
              <div className="timeline">
                {activity.length ? (
                  activity.map((e) => (
                    <details key={e.id}>
                      <summary>
                        <span className="timeline-dot" />
                        {e.text.split("\n")[0].slice(0, 100)}
                      </summary>
                      <pre>{e.text}</pre>
                    </details>
                  ))
                ) : (
                  <div className="empty-activity">
                    <Activity size={26} />
                    <p>Space for the work.</p>
                    <span>
                      Commands, progress, and results
                      <br />
                      will appear here as they happen.
                    </span>
                  </div>
                )}
              </div>
              <div className="panel-bottom">
                <Shield size={16} />
                <div>
                  Permission stays with you.
                  <small>Review requests here before approval.</small>
                </div>
              </div>
            </>
          ) : panelTab === "history" ? (
            <div className="history-list">
              <JobsPanel
                jobs={state.jobs}
                subagents={state.subagents}
                enqueue={(input) =>
                  window.jarvis.jobEnqueue(
                    input.goal,
                    input.profile,
                    input.runAt,
                  )
                }
                control={(id, a) => window.jarvis.jobControl(id, a)}
                open={(id) => window.jarvis.jobOpen(id)}
                run={run}
              />
              <details>
                <summary>Conversation history</summary>
                {state.tasks.length ? (
                  state.tasks.map((t) => (
                    <button
                      key={t.id}
                      className={
                        selected === t.id ? "task selected-task" : "task"
                      }
                      onClick={() => {
                        setSelected(t.id);
                        void goView("chats");
                      }}
                    >
                      <span className={`task-dot ${t.status}`} />
                      <div>
                        {t.title}
                        <small>
                          {t.status} ·{" "}
                          {new Date(t.createdAt).toLocaleDateString()}
                        </small>
                      </div>
                      <ChevronRight size={14} />
                    </button>
                  ))
                ) : (
                  <p className="muted">Your tasks will be saved here.</p>
                )}
              </details>
              <button
                className="subtle"
                onClick={() => {
                  setSelected(null);
                  void goView("chats");
                }}
              >
                Back to conversation
              </button>
            </div>
          ) : (
            <div className="memories">
              <p className="muted">
                Confirmed facts stay separate from inferences. Nothing is
                automatically promoted.
              </p>
              {state.memories.map((m) => (
                <div className="memory" key={m.id}>
                  <span>{m.kind}</span>
                  <p>{m.text}</p>
                  <button
                    className="icon-button"
                    aria-label="Forget memory"
                    onClick={() => void run(() => window.jarvis.forget(m.id))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <textarea
                aria-label="New confirmed memory"
                placeholder="A fact you want JARVIS to remember…"
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
              />
              <button
                className="subtle"
                disabled={!memory.trim()}
                onClick={() =>
                  void run(async () => {
                    await window.jarvis.remember(memory, "confirmed");
                    setMemory("");
                  })
                }
              >
                Save confirmed fact
              </button>
            </div>
          )}
        </aside>
      )}
      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)}>
<SettingsMenu onClose={() => setSettingsOpen(false)} error={error}><SettingsPage id="general" title="General" description="Startup, availability and your working environment." keywords="login startup background awake battery workspace" icon={SettingsIcon}><div className="settings-status-row"><span>Assistant</span><span>JARVIS · this Mac</span></div><h3>Startup and availability</h3><label className="toggle">
              <input
                type="checkbox"
                checked={state.settings.startAtLogin}
                onChange={(e) => patch({ startAtLogin: e.target.checked })}
              />
              <span>
                Start JARVIS at login
                <small>
                  Opens in the background. macOS registration:{" "}
                  {state.background?.login.status || "unknown"}.
                </small>
              </span>
            </label><label className="toggle">
              <input
                type="checkbox"
                checked={!!state.settings.keepAvailable}
                onChange={(e) => patch({ keepAvailable: e.target.checked })}
              />
              <span>
                Keep JARVIS available while plugged in
                <small>
                  Prevents idle system sleep while the app runs; the display may
                  turn off. Releases on battery. Lid closure, manual sleep and
                  shutdown can still interrupt JARVIS.
                </small>
              </span>
            </label><p className="muted small">Closing the window keeps JARVIS available from the menu bar. Your Mac must remain awake, signed in and online for remote tasks.</p><div className="workspace-path">Workspace<code>{state.workspace}</code></div></SettingsPage><SettingsPage id="intelligence" title="Intelligence" description="Choose the model that reasons through your tasks." keywords="brain model provider codex openai compatible custom server ollama local claude anthropic gemini api key" icon={Brain}><ProviderSettings state={state} /></SettingsPage><SettingsPage id="voice" title="Voice" description="Speaking, listening and local standby." keywords="microphone speaker earphone audio wake hey jarvis british realtime gpt api key diagnostics" icon={AudioLines}><details className="settings-section" open>
            <summary>Voice and standby</summary>
            <div className="persona-card">
              <h3>Composed. Precise. Occasionally dry.</h3>
              <p>
                Courteous British delivery, concise briefings and a little
                understated wit. An original AI voice; consequential actions still need
                your approval.
              </p>
            </div>
            <label>
              Voice character
              <select
                value={state.settings.voiceName}
                onChange={(e) => {
                  voice.current?.disconnect();
                  patch({ voiceName: e.target.value as "vesper" | "marin" });
                }}
              >
                <option value="vesper">
                  Vesper · British masculine / cinematic
                </option>
                <option value="marin">Marin · neutral / conversational</option>
              </select>
              <small className="muted">
                Changes take effect on the next voice connection. Realtime uses
                Cedar for the cinematic profile.
              </small>
            </label>
            
            <label className="toggle">
              <input
                type="checkbox"
                checked={state.settings.wakeWordEnabled}
                onChange={(e) => patch({ wakeWordEnabled: e.target.checked })}
              />
              <span>
                Listen locally for “Hey JARVIS”
                <small>
                  {state.background?.wake.detail ||
                    "Local wake listening is off."}{" "}
                  Wake audio is processed on this Mac and is not saved.
                </small>
              </span>
            </label>
            
            <label>
              Close voice after silence
              <select
                value={state.settings.voiceIdleSeconds}
                onChange={(e) =>
                  patch({ voiceIdleSeconds: Number(e.target.value) })
                }
              >
                {[15, 20, 30, 60].map((n) => (
                  <option key={n} value={n}>
                    {n} seconds
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">
              Closing the window keeps JARVIS in the menu bar. Say “Hey JARVIS”,
              wait for “I'm listening”, then speak your request. Idle timeout
              closes the API session, even if a backend task is still running.
              The menu-bar Quit command stops local listening too.
            </p>
          </details><details className="settings-section" open>
            <summary>Voice API access</summary>
            <label>
              OpenAI project API key
              <input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={
                  state.hasApiKey ? "Key configured — enter to replace" : "sk-…"
                }
              />
            </label>
            <div className="settings-buttons">
              <button
                className="subtle"
                disabled={!key.trim()}
                onClick={() =>
                  void run(async () => {
                    await window.jarvis.saveKey(key);
                    setKey("");
                    setAccess("Key saved with macOS-backed encryption.");
                  })
                }
              >
                Save key securely
              </button>
              <button
                className="subtle"
                onClick={() =>
                  void run(async () => {
                    const models = await window.jarvis.checkVoice();
                    setAccess(
                      models.length
                        ? `Models listed: ${models.join(", ")}. A successful voice connection is still required to verify access and billing.`
                        : "No voice models listed for this project.",
                    );
                  })
                }
              >
                Check API access
              </button>
              <button
                className="subtle"
                onClick={() =>
                  void run(async () => {
                    const context = new AudioContext();
                    await context.resume();
                    const tone = context.createOscillator();
                    const gain = context.createGain();
                    gain.gain.value = 0.025;
                    tone.frequency.value = 440;
                    tone.connect(gain).connect(context.destination);
                    tone.start();
                    tone.stop(context.currentTime + 0.4);
                    tone.onended = () => {
                      void context.close();
                    };
                  })
                }
              >
                Test speakers
              </button>
              <button
                className="subtle"
                disabled={!state.hasApiKey}
                onClick={() => void run(() => window.jarvis.saveKey(""))}
              >
                Remove saved key
              </button>
            </div>
            <small className="muted">
              Encrypted locally, with its wrapping key protected by macOS
              Keychain. Never sent to Codex or stored in history.
            </small>
            {access && <p className="access-result">{access}</p>}
          </details><details className="settings-section" open>
            <summary>Advanced voice and task settings</summary>
            <div className="settings-grid">
              <label>
                Voice provider
                <select
                  value={state.settings.voiceProvider}
                  onChange={(e) => {
                    voice.current?.disconnect();
                    const live = e.target.value === "live";
                    patch({
                      voiceProvider: live ? "live" : "realtime",
                      voiceModel: live ? "gpt-live-1" : "gpt-realtime-2.1",
                    });
                  }}
                >
                  <option value="live">GPT-Live (default)</option>
                  <option value="realtime">Realtime (alternative)</option>
                </select>
              </label>
              <label>
                Voice model
                <input
                  value={state.settings.voiceModel}
                  onChange={(e) => patch({ voiceModel: e.target.value })}
                />
              </label>
            </div>
            <p className="muted small">
              Starting voice sends microphone audio to OpenAI and consumes API
              credits. “Stop” ends the call and interrupts the task engine. To approve a
              pending action, say the exact phrase on its card, ending with
              “confirm”. Voice sessions close after ten minutes; reconnect to
              continue. Transcripts and diagnostics are saved locally; raw
              microphone audio is not saved by JARVIS.
            </p>
            <details className="voice-diagnostics">
              <summary>Voice diagnostics · {voiceState}</summary>
              {voiceLog.length ? (
                voiceLog.map((event, i) => (
                  <div key={i}>
                    <b>{event.kind}</b> {event.detail}
                  </div>
                ))
              ) : (
                <p>No voice session in this run.</p>
              )}
            </details>
            
            <label className="toggle">
              <input
                type="checkbox"
                checked={state.settings.speakReplies}
                onChange={(e) => patch({ speakReplies: e.target.checked })}
              />
              <span>
                Speak text results with the system voice
                <small>
                  Optional local playback when an API voice call is off.
                </small>
              </span>
            </label>
            <div className="workspace-path">
              Workspace<code>{state.workspace}</code>
              <small>
                File and project boundaries still apply. Startup settings are
                under General; wake listening is under Voice.
              </small>
            </div>
          </details></SettingsPage><SettingsPage id="autonomy" title="Autonomy" description="Set when JARVIS works independently and when it asks." keywords="approval critical autopilot routine watch monitor notification escalation subagents delegate parallel specialist" icon={Shield}><section><h3>Approval policy</h3><p>Autopilot handles trusted routine work. Critical and unclassified actions still stop for exact review.</p><label>Approval mode<select value={state.settings.approvalMode || "always"} onChange={e => patch({approvalMode:e.target.value as "always" | "critical"})}><option value="always">Ask every time</option><option value="critical">Autopilot · review critical actions</option></select></label><p className="muted small">Automatic: known ordinary apps, exact public HTTPS addresses in explicit opening requests, new text drafts in JARVIS’s Workspace, bounded project imports and offline commands in isolated project jobs.</p><p className="muted small">Always reviewed: sending, opening documents in external apps, form interactions, file replacement or deletion, network commands, account changes, unknown plugin tools, persistent watchers, phone calls and release publication/builds. Generic clicks and typing remain reviewed because their effects may be consequential.</p><p className="muted small">Changing modes cancels pending actions. Stop still cancels future work; it does not undo completed effects.</p></section><label className="toggle">
              <input
                type="checkbox"
                checked={state.settings.routineChecks}
                onChange={(e) => patch({ routineChecks: e.target.checked })}
              />
              <span>
                Allow routine read-only checks
                <small>
                  Use Codex on-request approvals within the read-only sandbox.
                  Applies on the next task.
                </small>
              </span>
            </label><section><h3>Specialist subagents</h3><label className="toggle"><input type="checkbox" checked={Boolean(state.settings.subagentsEnabled)} onChange={e=>patch({subagentsEnabled:e.target.checked})}/><span>Allow parallel specialist workers<small>Use the selected task provider and model for analysis, planning and review. Additional inference usage applies.</small></span></label><p className="muted small">Up to 2 workers at once and 6 per job. Each worker gets 5 minutes, 20 tool calls and a 40,000 reported-token limit. An in-flight response can exceed the token limit.</p><p className="muted small">Workers receive only selected context and project-file snapshots. They cannot change files, use apps or accounts, create more workers, or approve actions. See their progress and findings in Jobs. Stop, corrections and disabling this setting cancel active workers.</p></section><WatchSettings state={state} run={run} /></SettingsPage><SettingsPage id="skills" title="Skills" description="Teach your assistant how you like work done." keywords="instructions procedures training preference import skill markdown" icon={FileText}><SkillSettings state={state} /></SettingsPage><SettingsPage id="plugins" title="Plugins" description="Connect tools with explicit access and inspectable actions." keywords="mcp server extension tools token endpoint plugin browser embedded built-in google gmail calendar email oauth account connection sign in" icon={Command}><PluginSettings state={state} onOpenBrowser={()=>void openPluginBrowser()} /></SettingsPage><SettingsPage id="devices" title="Devices" description="Pair your phone and manage remote conversations." keywords="android phone qr pair mobile remote cloudflare tunnel firebase push incoming call alerts" icon={Mic}><details className="settings-section" open>
            <summary>Phone connection and alerts</summary>
            <RemoteSettings state={state.remote} run={run} />
          </details></SettingsPage><SettingsPage id="privacy" title="Privacy & access" description="Control what JARVIS can read and operate." keywords="permissions accessibility desktop folders roots files revoke macos" icon={Shield}><details className="settings-section" open>
            <summary>Desktop permissions and folders</summary>{" "}
            <h3>Desktop control</h3>
            <p>
              Accessibility:{" "}
              {state?.desktop?.accessibility
                ? "Enabled"
                : "Requires macOS permission"}
            </p>
            <p>Pointer event access: {state.desktop?.eventPosting === undefined ? "Not checked" : state.desktop.eventPosting ? "Available" : "Unavailable — clicks will be refused"}.</p>
            <p>Screen capture: {state.desktop?.screenCapture === undefined ? "Not checked" : state.desktop.screenCapture ? "Available" : "Requires macOS permission"}. Visual fallback uses only the requested app window and refuses recognized sensitive input windows.</p>
            <button className="subtle" onClick={()=>void run(()=>window.jarvis.desktopCheckAccess())}>Check desktop access</button>
            <button className="subtle" onClick={()=>void run(()=>window.jarvis.desktopScreenPermissions())}>Open Screen Recording settings</button>
            <p className="muted small">Window images go to your selected task provider when visual tools are used. JARVIS omits inline images from its tool-history records; providers, including Codex, may keep their own task history. Visual clicks always need a marked-image review.</p>
            <p>
              Approval rules depend on your Autonomy setting. Unclassified and
              consequential actions still require review. Other apps need Accessibility. Passwords
              and payment fields stay manual.
            </p>
            <button
              className="subtle"
              onClick={() =>
                void run(async () => {
                  await window.jarvis.desktopPermissions();
                })
              }
            >
              Open Accessibility settings
            </button>
            <p>Granted folders (ask JARVIS to grant another folder):</p>
            {state?.desktop?.roots.map((root) => (
              <div key={root}>
                <code>{root}</code>{" "}
                <button
                  className="subtle"
                  onClick={() =>
                    void run(() => window.jarvis.revokeFolder(root))
                  }
                >
                  Revoke
                </button>
              </div>
            ))}
          </details></SettingsPage><SettingsPage id="updates" title="Updates" description="Verified app releases and installation status." keywords="version release github download dmg apk update" icon={History}><UpdateSettings state={state} voiceBusy={voiceState !== "off"} run={run} /></SettingsPage><SettingsPage id="developer" title="Developer" description="Source maintenance, review and local release builds." keywords="repo source self improvement github signing private cache build developer pr merge" icon={Command}><MaintenanceSettings state={state} run={run} /></SettingsPage></SettingsMenu>
        </SettingsDialog>
      )}
    </div>
  );
}
function SettingsDialog({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="settings-modal"
      aria-label="Workspace settings"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          onClose();
      }}
    >
      {children}
    </dialog>
  );
}
function ApprovalCard({
  approval: a,
  run,
}: {
  approval: Approval;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = a.method === "item/tool/requestUserInput";
  return (
    <div className="approval-card">
      <Shield size={18} />
      <h3>
        {questions
          ? "A detail is needed"
          : a.params.title || "Your approval is needed"}
      </h3>
      <div className="approval-body">
        {questions ? (
          (a.params.questions || []).map((q: any) => (
            <label key={q.id}>
              {q.question}
              <input
                value={answers[q.id] || ""}
                onChange={(e) =>
                  setAnswers({ ...answers, [q.id]: e.target.value })
                }
              />
              {q.options?.map((o: any) => (
                <button
                  className="subtle"
                  key={o.label}
                  onClick={() => setAnswers({ ...answers, [q.id]: o.label })}
                >
                  {o.label}
                </button>
              ))}
            </label>
          ))
        ) : (
          <>
            <ActionPreview params={a.params} />
            <small className="approval-phrase">
              Voice: “approve action {a.params.voiceId || a.id} confirm”
            </small>
          </>
        )}
      </div>
      <div className="approval-buttons">
        {questions ? (
          <button
            className="subtle"
            disabled={(a.params.questions || []).some(
              (q: any) => !answers[q.id]?.trim(),
            )}
            onClick={() => void run(() => window.jarvis.answer(a.id, answers))}
          >
            Send answer
          </button>
        ) : (
          <>
            <button
              className="subtle"
              onClick={() => void run(() => window.jarvis.approve(a.id, false))}
            >
              Decline
            </button>
            <button
              className="approve"
              onClick={() => void run(() => window.jarvis.approve(a.id, true))}
            >
              Approve once
            </button>
          </>
        )}
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
