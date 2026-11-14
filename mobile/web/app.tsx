import { JobsPanel, MonitorList } from "../../src/renderer/jobs";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AudioLines,
  MessageSquare,
  ShieldCheck,
  Settings,
  Square,
} from "lucide-react";
import { VoiceHome } from "./voice-home";
import {
  Voice,
  type VoiceState,
  type VoiceBridge,
} from "../../src/renderer/voice";
import type { Api, Snapshot } from "../../src/shared/types";
import { MobileLink, type Pairing } from "./link";
import { CallScreen } from "./call-screen";
import { MobileUpdates } from "./updates";
import { ActionPreview } from "../../src/renderer/action-preview";
declare global {
  interface Window {
    JarvisNative?: {
      readPairing(): string;
      savePairing(v: string): void;
      clearPairing(): void;
      scan(): void;
      requestMicrophone(): void;
      requestNotifications(): void;
      configurePush(v: string): void;
      getPushToken(): string;
      getIncoming(): string;
      setVoiceActive(active: boolean): void;
      ready?(): void;
      getAppVersion?(): string;
      installVerifiedUpdate?(request:string):void;
      setMainTab?(tab: string): void;
      hideKeyboard?(): void;
      prepareCall?(direction: "incoming" | "outgoing", id: string): void;
      updateCallState?(state: VoiceState): void;
      endCall?(): void;
      showIncoming?(id: string, expires: number): void;
      getCallState?(): string;
      setMuted?(muted: boolean): void;
      selectAudioRoute?(): void;
      callHeartbeat?(): void;
      canShowIncomingScreen?(): boolean;
      openIncomingScreenSettings?(): void;
    };
  }
}
const link = new MobileLink();
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [version, redraw] = useState(0),
    [error, setError] = useState(""),
    [input, setInput] = useState(""),
    [qr, setQR] = useState(""),
    [voiceState, setVoiceState] = useState<VoiceState>("off"),
    [caption, setCaption] = useState(""),
    [incoming, setIncoming] = useState<{ id: string; reason: string } | null>(
      null,
    ),
    [tab, setTab] = useState<"talk" | "chats" | "tasks" | "settings">("talk"),
    [pushStatus, setPushStatus] = useState("Background alerts not enabled"),
    [pushReady, setPushReady] = useState(false),
    [pushEnabled, setPushEnabled] = useState(false),
    [callExpanded, setCallExpanded] = useState(false),
    [incomingSession, setIncomingSession] = useState(false),
    [callStarting, setCallStarting] = useState(false),
    [callStartedAt, setCallStartedAt] = useState(0),
    [muted, setMuted] = useState(false),
    [route, setRoute] = useState("earpiece"),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    window.JarvisNative?.setMainTab?.(tab);
  }, [tab]);
  useEffect(() => {
    if (tab !== "chats" || callExpanded) window.JarvisNative?.hideKeyboard?.();
  }, [tab, callExpanded]);
  const lastVoiceState = useRef<VoiceState>("off");
  const callStarted = useRef(0);
  const preparingCall = useRef<{
    resolve: () => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const starting = useRef(false);
  const callAttempt = useRef(0);
  const consumedIncoming = useRef(new Set<string>());
  const pendingIncoming = useRef<{ id: string; answer: boolean } | null>(null);
  const voice = useRef<Voice | undefined>(undefined);
  const latest = useRef<Snapshot | null>(null);
  const pollBusy = useRef(false);
  const microphone = useRef<{ resolve: (v: boolean) => void } | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  const cancelAttempt = () => {
    ++callAttempt.current;
    starting.current = false;
    setCallStarting(false);
    microphone.current?.resolve(false);
    microphone.current = null;
    if (preparingCall.current) {
      clearTimeout(preparingCall.current.timer);
      preparingCall.current.reject(Error("Call cancelled"));
      preparingCall.current = null;
    }
    pendingIncoming.current = null;
  };
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError("");
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const snapshotRevision = useRef<string | undefined>(undefined);
  const refresh = async () => {
    if (!link.connected || pollBusy.current) return;
    pollBusy.current = true;
    try {
      const s = await link.rpc("snapshot", {
        revision: snapshotRevision.current,
        visualPreview: 1,
      });
      if (s.unchanged) return;
      snapshotRevision.current = s.revision;
      latest.current = s;
      setSnapshot(s);
      voice.current?.observe(s);
    } catch (e) {
      setError(String(e));
    } finally {
      pollBusy.current = false;
    }
  };
  const config = async () => {
    const c = await link.rpc("config");
    setPushReady(!!c.firebase);
    setPushEnabled(!!c.registered);
    if (c.firebase) {
      window.JarvisNative?.configurePush(JSON.stringify(c.firebase));
      setPushStatus(
        c.registered
          ? "Background alerts enabled"
          : "Firebase ready · enable alerts below",
      );
    } else setPushStatus("Configure Firebase in desktop Settings first");
  };
  useEffect(() => {
    const bridge: VoiceBridge = {
      send: async (text: string) => {
        await link.rpc("send", { text });
        await refresh();
      },
      stopCurrent: async () => {
        await link.rpc("stop.current");
        await refresh();
      },
      stop: async () => {
        await link.rpc("stop");
        await refresh();
      },
      answer: async (id, answers) => {
        await link.rpc("answer", { id, answers });
        await refresh();
      },
      approve: async (id, accept) => {
        await link.rpc("approve", { id, accept, visualPreview:1 });
        await refresh();
      },
      voiceConnect: async (sdp: string) => link.rpc("voice.connect", { sdp }),
      voiceActivity: async (active: boolean) => {
        if (heartbeat.current) clearInterval(heartbeat.current);
        window.JarvisNative?.setVoiceActive(active);
        if (active) {
          await link.rpc("voice.activity", { active: true });
          heartbeat.current = setInterval(() => {
            window.JarvisNative?.callHeartbeat?.();
            void link
              .rpc("voice.heartbeat")
              .catch(() => voice.current?.disconnect());
          }, 15000);
        } else if (link.connected)
          await link.rpc("voice.activity", { active: false });
      },
    };
    voice.current = new Voice(
      (s, c) => {
        const previous = lastVoiceState.current;
        if (s === "off" && previous === "off" && starting.current) return;
        lastVoiceState.current = s;
        setVoiceState(s);
        if (c) setCaption(c);
        if ((s === "listening" || s === "speaking") && !callStarted.current) {
          callStarted.current = Date.now();
          setCallStartedAt(callStarted.current);
        }
        if (s !== "off" || previous !== "off")
          window.JarvisNative?.updateCallState?.(s);
        if (s === "off" || s === "error") {
          callStarted.current = 0;
          setCallStartedAt(0);
          setCallExpanded(false);
          setCallStarting(false);
        }
      },
      setError,
      () => {},
      bridge,
    );
    voice.current.idleSecondsOverride = 120;
    link.onState = () => {
      redraw((v) => v + 1);
      if (link.connected) {
        void refresh().then(() => {
          if (pendingIncoming.current) {
            const p = pendingIncoming.current;
            pendingIncoming.current = null;
            void run(() => receiveIncoming(p));
          }
        });
        void config().catch((e) => setError(String(e)));
      }
    };
    link.onPaired = (p: Pairing) => {
      window.JarvisNative?.savePairing(JSON.stringify(p));
    };
    link.onError = setError;
    link.onEvent = (e) => {
      if (e.type === "state") void refresh();
      if (e.type === "configuration") void config();
      if (e.type === "endVoice" || e.type === "disconnected") {
        cancelAttempt();
        voice.current?.disconnect();
        window.JarvisNative?.endCall?.();
      }
      if (e.type === "incoming" && voice.current?.closed) {
        setIncomingSession(true);
        setIncoming(e.call);
        setCallExpanded(true);
        window.JarvisNative?.showIncoming?.(
          e.call.id,
          e.call.expires || Date.now() + 90000,
        );
      }
      if (e.type === "callDismissed" && e.exceptPhone !== link.pair?.id) {
        setIncoming((value) => (value?.id === e.id ? null : value));
        const nativeCall = window.JarvisNative?.getCallState?.();
        if (nativeCall && JSON.parse(nativeCall).id === e.id)
          window.JarvisNative?.endCall?.();
      }
    };
    const native = (event: Event) => {
      try {
        const d = JSON.parse((event as CustomEvent).detail);
        if (d.type === "callPrepared") {
          if (preparingCall.current) {
            clearTimeout(preparingCall.current.timer);
            preparingCall.current.resolve();
            preparingCall.current = null;
          }
        }
        if (d.type === "callError") {
          if (preparingCall.current) {
            clearTimeout(preparingCall.current.timer);
            preparingCall.current.reject(Error(d.value));
            preparingCall.current = null;
          }
          voice.current?.disconnect();
          setCallStarting(false);
          starting.current = false;
          setError(d.value);
        }
        if (d.type === "callEnded") {
          const ended = JSON.parse(d.value);
          const current = JSON.parse(
            window.JarvisNative?.getCallState?.() || "{}",
          );
          if (current.id && current.id !== ended.id) return;
          if (preparingCall.current) {
            clearTimeout(preparingCall.current.timer);
            preparingCall.current.reject(Error(ended.reason));
            preparingCall.current = null;
          }
          cancelAttempt();
          voice.current?.disconnect();
          setIncoming(null);
          setCallExpanded(false);
          setCallStarting(false);
          starting.current = false;
        }
        if (d.type === "callDeclined") {
          setIncoming(null);
          setCallExpanded(false);
          if (link.connected)
            void link.rpc("call.decline", { id: d.value }).catch(() => {});
        }
        if (d.type === "callState") {
          const state = JSON.parse(d.value);
          setMuted(!!state.muted);
          setRoute(state.route || "earpiece");
          voice.current?.setMuted(!!state.muted);
        }
        if (d.type === "back") {
          setTab("talk");
          setCallExpanded(false);
        }
        if (d.type === "qr") void run(() => link.scan(d.value));
        if (d.type === "microphone") {
          microphone.current?.resolve(d.value);
          microphone.current = null;
        }
        if (d.type === "notifications") {
          if (!d.value) {
            setPushStatus("Notifications denied by Android");
            return;
          }
          const token = window.JarvisNative?.getPushToken();
          if (token)
            void run(async () => {
              await link.rpc("push.register", { token });
              setPushStatus("Background alerts enabled");
              setPushEnabled(true);
            });
          else
            setPushStatus(
              "Waiting for Firebase registration; tap Enable alerts again shortly",
            );
        }
        if (d.type === "incoming") {
          window.JarvisNative?.getIncoming();
          void run(() => receiveIncoming(JSON.parse(d.value)));
        }
        if (d.type === "pushError" || d.type === "error") setError(d.value);
      } catch (e) {
        setError(String(e));
      }
    };
    const close = () => {
      voice.current?.disconnect();
      link.disconnect();
    };
    window.addEventListener("jarvis-native", native);
    window.addEventListener("jarvis-close", close);
    window.JarvisNative?.ready?.();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const nativeIncoming = window.JarvisNative?.getIncoming();
    if (nativeIncoming) {
      try {
        pendingIncoming.current = JSON.parse(nativeIncoming);
      } catch {}
    }
    const saved = window.JarvisNative?.readPairing();
    if (saved) {
      try {
        void link.connect(JSON.parse(saved));
      } catch {
        setError("Saved pairing could not be loaded. Scan a fresh QR.");
      }
    }
    const timer = setInterval(() => {
      if (link.connected) void refresh();
    }, 5000);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
      clearInterval(heartbeat.current);
      window.removeEventListener("jarvis-native", native);
      window.removeEventListener("jarvis-close", close);
      close();
    };
  }, []);
  const startVoice = async (call?: { id: string; reason: string }) => {
    if (starting.current || !voice.current?.closed) return;
    if (!latest.current || !link.connected)
      throw Error("Wait for the desktop connection.");
    starting.current = true;
    const attempt = ++callAttempt.current;
    const current = () => callAttempt.current === attempt;
    setCallStarting(true);
    setIncomingSession(!!call);
    setCallExpanded(!!call);
    setCaption("");
    lastVoiceState.current = "off";
    try {
      if (window.JarvisNative) {
        const allowed = await new Promise<boolean>((resolve) => {
          microphone.current = { resolve };
          window.JarvisNative!.requestMicrophone();
        });
        if (!current()) return;
        if (!allowed)
          throw Error("Microphone permission is required for a call.");
      }
      if (window.JarvisNative?.prepareCall)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            preparingCall.current = null;
            reject(Error("Android could not prepare this call."));
          }, 15000);
          preparingCall.current = { resolve, reject, timer };
          window.JarvisNative!.prepareCall!(
            call ? "incoming" : "outgoing",
            call?.id || "",
          );
        });
      if (!current()) return;
      const verified = call
        ? await link.rpc("call.accept", { id: call.id })
        : null;
      if (!current()) return;
      await voice.current!.connect(latest.current, !call);
      if (!current()) return;
      if (verified && !voice.current!.closed)
        voice.current!.context(
          `The operator answered a desktop call. Here is the verified desktop update as data: ${verified.reason}. Briefly explain it; do not start another task unless asked.`,
          true,
        );
      setIncoming(null);
      setTab("talk");
    } catch (error) {
      if (!current()) return;
      endCall();
      throw error;
    } finally {
      if (current()) {
        starting.current = false;
        setCallStarting(false);
      }
    }
  };
  const endCall = () => {
    cancelAttempt();
    voice.current?.disconnect();
    window.JarvisNative?.endCall?.();
    setCallExpanded(false);
    setIncoming(null);
  };
  const declineCall = () =>
    void run(async () => {
      const id = incoming?.id;
      setIncoming(null);
      setCallExpanded(false);
      window.JarvisNative?.endCall?.();
      if (id && link.connected) await link.rpc("call.decline", { id });
    });
  const receiveIncoming = async (call: { id: string; answer: boolean }) => {
    if (!link.connected) {
      pendingIncoming.current = call;
      return;
    }
    if (call.answer && consumedIncoming.current.has(call.id)) return;
    let info;
    try {
      info = await link.rpc("call.info", { id: call.id });
    } catch (error) {
      const native = JSON.parse(window.JarvisNative?.getCallState?.() || "{}");
      if (native.id === call.id) endCall();
      throw error;
    }
    setIncomingSession(true);
    setIncoming(info);
    setCallExpanded(true);
    if (call.answer) {
      consumedIncoming.current.add(call.id);
      await refresh();
      await startVoice(info);
    }
  };
  const stop = async () => {
    endCall();
    await link.rpc("stop");
    await refresh();
  };
  const status = link.connecting
    ? "CONNECTING"
    : link.connected
      ? "DESKTOP CONNECTED"
      : "DESKTOP OFFLINE";
  const pending = snapshot?.approvals.length || 0;
  const needsInput =
    snapshot?.approvals[0]?.method === "item/tool/requestUserInput";
  const taskState = snapshot?.error
    ? "Desktop needs attention"
    : snapshot?.status === "connecting"
      ? "Connecting to the execution link"
      : snapshot?.status === "stopping"
        ? "Stopping work"
        : pending
          ? needsInput
            ? "Waiting for your answer"
            : "Awaiting your review"
          : snapshot?.activeTaskId
            ? "Task in progress"
            : "Ready for your request";
  return (
    <div
      className={`app ${snapshot?.entries.length || pending ? "has-work" : ""}`}
    >
      <div id="voice-playback" />
      {incomingSession &&
        callExpanded &&
        (incoming ||
          callStarting ||
          !["off", "error"].includes(voiceState)) && (
          <CallScreen
            incoming={
              !!incoming &&
              !callStarting &&
              ["off", "error"].includes(voiceState)
            }
            connecting={callStarting || voiceState === "connecting"}
            startedAt={callStartedAt}
            now={now}
            muted={muted}
            route={route}
            caption={caption}
            pending={pending}
            needsInput={needsInput}
            onAnswer={() => void run(() => startVoice(incoming!))}
            onDecline={declineCall}
            onEnd={endCall}
            onMute={() => {
              const next = !muted;
              setMuted(next);
              voice.current?.setMuted(next);
              window.JarvisNative?.setMuted?.(next);
            }}
            onRoute={
              window.JarvisNative?.selectAudioRoute
                ? () => window.JarvisNative?.selectAudioRoute?.()
                : undefined
            }
            onMinimize={() => setCallExpanded(false)}
            onReview={() => {
              setCallExpanded(false);
              setTab("tasks");
            }}
          />
        )}
      {!callExpanded &&
        (incomingSession || tab !== "talk") &&
        !["off", "error"].includes(voiceState) && (
          <button
            className="ongoing-call"
            onClick={() =>
              incomingSession ? setCallExpanded(true) : setTab("talk")
            }
          >
            {incomingSession ? "JARVIS call" : "JARVIS voice"} ·{" "}
            {voiceState === "connecting"
              ? "Connecting…"
              : incomingSession
                ? "Return to call"
                : "Return to Voice"}
            <span>{muted ? "Muted" : "Voice active"}</span>
          </button>
        )}
      <header className="app-header">
        <div className="app-brand">
          <img src="logo.png" alt="JARVIS emblem" />
          <b>JARVIS</b>
        </div>
        <button
          className="stop"
          aria-label="Stop all work"
          disabled={!link.connected}
          onClick={() => void run(stop)}
        >
          <Square size={16} fill="currentColor" /> Stop
        </button>
      </header>
      <div
        className={`link-state ${link.connected ? "connected" : ""}`}
        role="status"
      >
        <i aria-hidden="true" />
        {status}
      </div>
      {!link.connected ? (
        <main className="pair">
          {!link.pair && <img className="pair-emblem" src="logo.png" alt="" />}
          <h1>
            {link.connecting
              ? "Connecting to your Mac…"
              : link.pair
                ? "Your Mac is offline."
                : "Connect your desktop."}
          </h1>
          <p>
            {link.pair
              ? "Your pairing is saved. JARVIS reconnects when your Mac is online."
              : "On your Mac, open JARVIS Settings → Phone connection and alerts. Scan its QR, then compare all six digits on both devices."}
          </p>
          {link.pair && (
            <button
              className="primary"
              disabled={link.connecting}
              onClick={() => void run(() => link.connect(link.pair!))}
            >
              Reconnect paired desktop
            </button>
          )}
          <button
            className={link.pair ? "secondary" : "primary"}
            onClick={() => window.JarvisNative?.scan()}
          >
            {link.pair ? "Pair another desktop" : "Scan desktop QR"}
          </button>
          {link.code && (
            <div className="pair-code">
              <small>COMPARE ON YOUR MAC</small>
              <b>{link.code}</b>
              <p>
                Only approve if both codes match. This grants this phone task
                and approval access.
              </p>
            </div>
          )}
          <details>
            <summary>Paste a pairing QR instead</summary>
            <textarea
              aria-label="Pairing QR data"
              value={qr}
              onChange={(e) => setQR(e.target.value)}
            />
            <button onClick={() => void run(() => link.scan(qr))}>
              Pair with this code
            </button>
          </details>
        </main>
      ) : (
        <>
          <nav className="main-nav" role="tablist" aria-label="Main view">
            {(
              [
                ["talk", "Voice", AudioLines],
                ["chats", "Chats", MessageSquare],
                ["tasks", "Tasks", ShieldCheck],
                ["settings", "Settings", Settings],
              ] as const
            ).map(([key, label, Icon], index) => (
              <button
                key={key}
                id={`tab-${key}`}
                role="tab"
                aria-label={label}
                aria-description={
                  key === "tasks" && pending > 0
                    ? `${pending} requests awaiting your response`
                    : undefined
                }
                aria-selected={tab === key}
                aria-controls={`panel-${key}`}
                tabIndex={tab === key ? 0 : -1}
                className={tab === key ? "selected" : ""}
                onClick={() => setTab(key)}
                onKeyDown={(event) => {
                  const keys = ["talk", "chats", "tasks", "settings"] as const;
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % 4
                      : event.key === "ArrowLeft"
                        ? (index + 3) % 4
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? 3
                            : -1;
                  if (next >= 0) {
                    event.preventDefault();
                    setTab(keys[next]);
                    document.getElementById(`tab-${keys[next]}`)?.focus();
                  }
                }}
              >
                <span className="nav-icon">
                  <Icon size={23} />
                  {key === "tasks" && pending > 0 && (
                    <span className="nav-badge" aria-hidden="true">
                      {pending}
                    </span>
                  )}
                </span>
                <span>{label}</span>
              </button>
            ))}
          </nav>
          {(pending > 0 || snapshot?.error || snapshot?.activeTaskId) && (
            <div
              className={`task-notice ${pending ? "needs-review" : ""}`}
              role="status"
            >
              <div>
                <strong>{taskState}</strong>
                {pending > 0 && (
                  <p>
                    {needsInput
                      ? snapshot?.approvals[0].params.questions?.[0]?.question
                      : snapshot?.approvals[0].params.title ||
                        "An action needs your approval."}
                  </p>
                )}
                {snapshot?.error && <p>{snapshot.error}</p>}
              </div>
              {pending > 0 && tab !== "tasks" && (
                <button
                  className="primary amber"
                  onClick={() => setTab("tasks")}
                >
                  {needsInput
                    ? "Answer question"
                    : `Review ${pending === 1 ? "action" : `${pending} actions`}`}
                </button>
              )}
            </div>
          )}
          {incoming && !callExpanded && (
            <button
              className="incoming-banner"
              onClick={() => setCallExpanded(true)}
            >
              Incoming JARVIS call · Answer or decline
            </button>
          )}
          {tab === "talk" && (
            <VoiceHome
              state={
                callStarting && voiceState === "off" ? "connecting" : voiceState
              }
              working={!!snapshot?.activeTaskId}
              pending={pending}
              needsInput={needsInput}
              error={snapshot?.error}
              caption={caption}
              muted={muted}
              route={route}
              onMute={() => {
                const next = !muted;
                setMuted(next);
                voice.current?.setMuted(next);
                window.JarvisNative?.setMuted?.(next);
              }}
              onRoute={
                window.JarvisNative?.selectAudioRoute
                  ? () => window.JarvisNative?.selectAudioRoute?.()
                  : undefined
              }
              onEnd={endCall}
              onCall={() =>
                void run(async () => {
                  if (starting.current || !voice.current?.closed) endCall();
                  else await startVoice();
                })
              }
            />
          )}
          {tab === "chats" && (
            <main
              className="chat-view"
              id="panel-chats"
              role="tabpanel"
              aria-labelledby="tab-chats"
            >
              <div className="view-heading">
                <h1>Chats</h1>
                <p>Your conversation with JARVIS.</p>
              </div>
              <div
                className="messages"
                role="log"
                aria-label="Conversation history"
              >
                {!snapshot?.entries.some((e) => e.role !== "activity") && (
                  <div className="empty-state">
                    <MessageSquare size={32} />
                    <h2>Start a conversation.</h2>
                    <p>
                      Speak with JARVIS from Voice, or write a message below.
                    </p>
                  </div>
                )}
                {snapshot?.entries
                  .filter((e) => e.role !== "activity")
                  .slice(-100)
                  .map((e) => (
                    <article key={e.id} className={e.role}>
                      <small>
                        {e.role === "assistant"
                          ? "JARVIS"
                          : e.role === "user"
                            ? "YOU"
                            : "SYSTEM"}
                      </small>
                      <p>{e.text}</p>
                    </article>
                  ))}
              </div>
              <div className="composer">
                <textarea
                  aria-label="Message JARVIS"
                  placeholder="Your instruction, sir…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                />
                <button
                  className="primary"
                  disabled={!input.trim()}
                  onClick={() =>
                    void run(async () => {
                      const t = input;
                      setInput("");
                      await link.rpc("send", { text: t });
                      await refresh();
                    })
                  }
                >
                  Send
                </button>
              </div>
            </main>
          )}
          {tab === "tasks" && (
            <main
              className="tasks-view"
              id="panel-tasks"
              role="tabpanel"
              aria-labelledby="tab-tasks"
            >
              <div className="view-heading">
                <h1>Tasks</h1>
                <p>Review exact actions and follow their results.</p>
              </div>
              {snapshot?.approvals.map((a) => (
                <div className="approval" key={a.id}>
                  <h2>{a.params.title || "Review action"}</h2>
                  {a.method !== "item/tool/requestUserInput" && (
                    <>
                      <ActionPreview params={a.params} />
                      <small className="approval-phrase">
                        Voice: “approve action {a.params.voiceId || a.id}{" "}
                        confirm”
                      </small>
                    </>
                  )}
                  {a.method === "item/tool/requestUserInput" ? (
                    <QuestionForm
                      questions={a.params.questions || []}
                      submit={async (answers) => {
                        await link.rpc("answer", { id: a.id, answers });
                        await refresh();
                      }}
                      run={run}
                    />
                  ) : (
                    <div className="approval-buttons">
                      <button
                        className="primary amber"
                        onClick={() =>
                          void run(async () => {
                            await link.rpc("approve", {
                              id: a.id,
                              accept: true,
                              visualPreview: 1,
                            });
                            await refresh();
                          })
                        }
                      >
                        Approve once
                      </button>
                      <button
                        onClick={() =>
                          void run(async () => {
                            await link.rpc("approve", {
                              id: a.id,
                              accept: false,
                            });
                            await refresh();
                          })
                        }
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!snapshot?.approvals.length && (
                <p className="muted">No pending approvals.</p>
              )}
              <JobsPanel
                jobs={snapshot?.jobs}
                enqueue={(input) =>
                  link.rpc("job.enqueue", input).then(refresh)
                }
                control={(id, action) =>
                  link.rpc("job.control", { id, action }).then(refresh)
                }
                run={run}
              />
              <details>
                <summary>Earlier task history</summary>
                {snapshot?.tasks.map((t) => (
                  <article key={t.id}>
                    <small>{t.status.toUpperCase()}</small>
                    <p>{t.title}</p>
                  </article>
                ))}
              </details>
            </main>
          )}
          {tab === "settings" && (
            <main
              className="settings-view"
              id="panel-settings"
              role="tabpanel"
              aria-labelledby="tab-settings"
            >
              <div className="view-heading">
                <h1>Settings</h1>
                <p>Connection, incoming calls and access.</p>
              </div>
              <p>
                Paired to {link.pair?.name}. The Mac must remain awake and
                online. A permanent desktop address reconnects automatically
                using this saved pairing. Scan the desktop’s new QR once when
                moving from a temporary address.
              </p>
              <MobileUpdates link={link} connected={link.connected} />
              <MonitorList
                items={snapshot?.monitors}
                control={(id, action) =>
                  link.rpc("monitor.control", { id, action }).then(refresh)
                }
                run={run}
              />
              <article>
                <h2>Background alerts</h2>
                <p>{pushStatus}</p>
                <button
                  disabled={!pushReady || pushEnabled}
                  onClick={() => window.JarvisNative?.requestNotifications()}
                >
                  Enable alerts on this phone
                </button>
                <button
                  disabled={!pushEnabled}
                  onClick={() =>
                    void run(async () => {
                      await link.rpc("push.disable");
                      setPushEnabled(false);
                      setPushStatus("Background alerts disabled");
                    })
                  }
                >
                  Disable alerts
                </button>
              </article>
              {window.JarvisNative?.canShowIncomingScreen && (
                <article>
                  <h2>Incoming call screen</h2>
                  <p>
                    {window.JarvisNative.canShowIncomingScreen()
                      ? "Android allows the incoming call screen while locked."
                      : "Allow full-screen call notifications in Android to see the ringing screen while locked."}
                  </p>
                  <button
                    onClick={() =>
                      window.JarvisNative?.openIncomingScreenSettings?.()
                    }
                  >
                    Open Android call settings
                  </button>
                </article>
              )}
              <article>
                <h2>Action approvals</h2>
                <p>
                  This phone can review and approve the same exact action cards
                  as the desktop. Never approve an unexpected action.
                </p>
              </article>
              <button
                onClick={() =>
                  void run(async () => {
                    voice.current?.disconnect();
                    window.JarvisNative?.clearPairing();
                    link.disconnect();
                    link.pair = undefined;
                    setSnapshot(null);
                    redraw((v) => v + 1);
                  })
                }
              >
                Disconnect and forget this Mac
              </button>
              <p className="build-info">
                Android{" "}
                {window.JarvisNative?.getAppVersion?.() || "development build"}
              </p>
            </main>
          )}
        </>
      )}
      {error && (
        <div role="alert" className="error">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
function QuestionForm({
  questions,
  submit,
  run,
}: {
  questions: any[];
  submit: (answers: Record<string, string>) => Promise<void>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <div>
      {questions.map((q) => (
        <label key={q.id}>
          {q.question}
          <textarea
            aria-label={q.question}
            value={answers[q.id] || ""}
            onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
          />
          {q.options?.map((o: any) => (
            <button
              key={o.label}
              onClick={() => setAnswers({ ...answers, [q.id]: o.label })}
            >
              {o.label}
            </button>
          ))}
        </label>
      ))}
      <button
        className="primary"
        disabled={questions.some((q) => !answers[q.id]?.trim())}
        onClick={() => void run(() => submit(answers))}
      >
        Send answer
      </button>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
