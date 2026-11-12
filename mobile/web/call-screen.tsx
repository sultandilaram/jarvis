import React, { useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Volume2,
  Phone,
  PhoneOff,
  ChevronDown,
  Shield,
} from "lucide-react";
export function CallScreen({
  incoming,
  connecting,
  startedAt,
  now,
  muted,
  route,
  caption,
  pending,
  needsInput,
  onAnswer,
  onDecline,
  onEnd,
  onMute,
  onRoute,
  onMinimize,
  onReview,
}: {
  incoming: boolean;
  connecting: boolean;
  startedAt: number;
  now: number;
  muted: boolean;
  route: string;
  caption: string;
  pending: number;
  needsInput?: boolean;
  onAnswer: () => void;
  onDecline: () => void;
  onEnd: () => void;
  onMute: () => void;
  onRoute?: () => void;
  onMinimize: () => void;
  onReview: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = root.current!;
    const previous = document.activeElement as HTMLElement | null;
    const siblings = Array.from(element.parentElement?.children || []).filter(
      (child) => child !== element && child.id !== "voice-playback",
    ) as HTMLElement[];
    const inert = siblings.map((child) => child.inert);
    siblings.forEach((child) => {
      child.inert = true;
    });
    element.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      siblings.forEach((child, index) => {
        child.inert = inert[index];
      });
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const seconds = startedAt
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : 0;
  const duration = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  return (
    <section
      ref={root}
      className="call-screen"
      role="dialog"
      aria-modal="true"
      aria-label={incoming ? "Incoming JARVIS call" : "JARVIS voice call"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onMinimize();
        }
        if (event.key !== "Tab") return;
        const buttons = Array.from(
          root.current!.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        );
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="call-top">
        <button aria-label="Minimize call" onClick={onMinimize}>
          <ChevronDown size={24} />
        </button>
        <span>AI voice call</span>
        <span className="call-security">Encrypted link</span>
      </header>
      <div className="call-identity">
        <img src="logo.png" alt="JARVIS emblem" />
        <h1>JARVIS</h1>
        <p role="status">
          {incoming
            ? "Incoming call"
            : connecting
              ? "Calling your desktop…"
              : duration}
        </p>
        <span>
          {incoming
            ? "Your desktop is calling"
            : connecting
              ? "Waiting for the voice connection"
              : muted
                ? "Microphone muted"
                : "Connected to your desktop"}
        </span>
      </div>
      <div className="call-caption" aria-label="Live call caption">
        {!incoming && caption}
      </div>
      <div className="call-bottom">
        {incoming ? (
          <div className="incoming-actions">
            <button className="call-round decline" onClick={onDecline}>
              <PhoneOff size={26} />
              <span>Decline</span>
            </button>
            <button className="call-round answer" onClick={onAnswer}>
              <Phone size={26} />
              <span>Answer</span>
            </button>
          </div>
        ) : (
          <>
            {pending > 0 && (
              <button className="call-review" onClick={onReview}>
                <Shield size={18} />
                {needsInput
                  ? "Answer question"
                  : `Review ${pending === 1 ? "action" : `${pending} actions`}`}
              </button>
            )}
            <div className="call-controls">
              <button
                className={`call-round ${muted ? "selected" : ""}`}
                aria-pressed={muted}
                onClick={onMute}
              >
                {muted ? <MicOff size={24} /> : <Mic size={24} />}
                <span>{muted ? "Unmute" : "Mute"}</span>
              </button>
              <button
                className="call-round"
                disabled={!onRoute}
                onClick={onRoute}
              >
                <Volume2 size={24} />
                <span>
                  {route === "speaker"
                    ? "Speaker"
                    : route === "bluetooth"
                      ? "Bluetooth"
                      : route === "headset"
                        ? "Headset"
                        : "Audio"}
                </span>
              </button>
              <button className="call-round decline" onClick={onEnd}>
                <PhoneOff size={26} />
                <span>End call</span>
              </button>
            </div>
          </>
        )}
        <p className="call-cost">
          {incoming
            ? "Voice starts only when you answer."
            : "Active calls use API credits · Ends after 2 minutes of silence"}
        </p>
      </div>
    </section>
  );
}
