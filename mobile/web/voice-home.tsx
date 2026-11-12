import React from "react";
import { Mic, MicOff, Volume2, X, ShieldCheck } from "lucide-react";
import type { VoiceState } from "../../src/renderer/voice";
export function VoiceHome({
  state,
  working,
  pending,
  needsInput,
  error,
  onCall,
  caption,
  muted,
  route,
  onMute,
  onRoute,
  onEnd,
}: {
  state: VoiceState;
  working: boolean;
  pending: number;
  needsInput?: boolean;
  error?: string | null;
  onCall: () => void;
  caption: string;
  muted: boolean;
  route: string;
  onMute: () => void;
  onRoute?: () => void;
  onEnd: () => void;
}) {
  const live = !["off", "error"].includes(state);
  const label =
    state === "connecting"
      ? "Connecting voice"
      : state === "speaking"
        ? "Speaking"
        : state === "listening"
          ? "Listening"
          : "Tap to speak";
  return (
    <main
      className={`voice-home ${live ? "is-live" : ""} ${pending || error ? "has-notice" : ""}`}
      id="panel-talk"
      role="tabpanel"
      aria-labelledby="tab-talk"
    >
      <div className="voice-stage">
        <button
          className={`voice-core ${state} ${working ? "working" : ""}`}
          aria-label={live ? "End voice interaction" : "Talk to JARVIS"}
          onClick={onCall}
        >
          <svg className="core-rings" viewBox="0 0 240 240" aria-hidden="true">
            <circle className="ring-guide" cx="120" cy="120" r="114" />
            <g className="ring-outer">
              <circle cx="120" cy="120" r="107" />
              <circle className="ring-highlight" cx="120" cy="120" r="107" />
            </g>
            <g className="ring-ticks">
              {Array.from({ length: 60 }, (_, i) => (
                <line
                  key={i}
                  x1="120"
                  y1={i % 5 === 0 ? "19" : "22"}
                  x2="120"
                  y2="26"
                  transform={`rotate(${i * 6} 120 120)`}
                />
              ))}
            </g>
            <g className="ring-inner">
              <circle cx="120" cy="120" r="86" />
              <circle className="ring-highlight" cx="120" cy="120" r="78" />
            </g>
            <circle className="ring-guide" cx="120" cy="120" r="67" />
            <path
              className="core-bracket"
              d="M110 62h20M178 110v20M130 178h-20M62 130v-20"
            />
          </svg>
          <span className="core-label">
            <b>JARVIS</b>
            <span>
              <Mic size={18} /> {label}
            </span>
          </span>
        </button>
        {!live && (
          <div className="voice-greeting">
            <h1>
              {error
                ? "Desktop needs attention."
                : pending
                  ? needsInput
                    ? "Your answer is needed."
                    : "Your approval is needed."
                  : working
                    ? "Working on your request."
                    : state === "connecting"
                      ? "Connecting voice…"
                      : state === "speaking"
                        ? "Speaking."
                        : state === "listening"
                          ? "Listening."
                          : "Ready when you are."}
            </h1>
            <p>
              {error
                ? "Review the connection message above."
                : state === "connecting"
                  ? "Waiting for the voice connection."
                  : live
                    ? muted
                      ? "Your microphone is muted."
                      : "Speak naturally. I’m listening."
                    : "Speak with your desktop, wherever you are."}
            </p>
          </div>
        )}
      </div>
      {live && (
        <div className="hud-voice-dock">
          <p className="hud-caption" aria-label="Live voice caption">
            {caption ||
              (state === "connecting"
                ? "Opening the voice connection…"
                : "Ready for your request.")}
          </p>
          <div className="hud-voice-controls">
            <button aria-pressed={muted} onClick={onMute}>
              {muted ? <MicOff size={19} /> : <Mic size={19} />}{" "}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button disabled={!onRoute} onClick={onRoute}>
              <Volume2 size={19} />
              {route === "speaker"
                ? "Speaker"
                : route === "bluetooth"
                  ? "Bluetooth"
                  : "Audio"}
            </button>
            <button className="end-voice" onClick={onEnd}>
              <X size={19} />
              End voice
            </button>
          </div>
        </div>
      )}
      {!live && (
        <div className="voice-assurance">
          <ShieldCheck size={18} />
          <span>Actions stay under your control.</span>
        </div>
      )}
      <p className="voice-note">
        {live
          ? "Voice active · API credits in use."
          : "Microphone off until you speak with JARVIS. Active voice uses API credits."}
      </p>
    </main>
  );
}
