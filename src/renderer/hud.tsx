import React from "react";
import { Mic, Shield } from "lucide-react";
import type { Snapshot } from "../shared/types";
import type { VoiceState } from "./voice";
export function HudCore({
  state,
  voiceState,
  onVoice,
}: {
  state: Snapshot;
  voiceState: VoiceState;
  onVoice: () => void;
}) {
  const active = !!state.activeTaskId;
  const live = !["off", "error"].includes(voiceState);
  const approval = state.approvals.length > 0;
  const mode =
    state.status === "error" || voiceState === "error"
      ? "fault"
      : approval
        ? "approval"
        : voiceState === "speaking"
          ? "speaking"
          : voiceState === "listening"
            ? "listening"
            : active
              ? "working"
              : live || state.status === "connecting"
                ? "connecting"
                : "standby";
  const status = {
    fault: "ATTENTION REQUIRED",
    approval: "AWAITING AUTHORIZATION",
    speaking: "VOICE OUTPUT",
    listening: "LISTENING",
    working: "PROCESSING REQUEST",
    connecting: "ESTABLISHING LINK",
    standby: "LOCAL STANDBY",
  }[mode];
  const localWake = state.background?.wake.state === "listening";
  return (
    <section
      className={`hud-core mode-${mode}`}
      aria-label="JARVIS system status"
    >
      <div className="hud-readouts left">
        <div className="hud-readout">
          <span>EXECUTION LINK</span>
          <strong>
            {state.status === "connecting"
              ? "CONNECTING"
              : state.status === "error"
                ? "ATTENTION"
                : "CONNECTED"}
          </strong>
          <i />
        </div>
        <div className="hud-readout">
          <span>VOICE CHANNEL</span>
          <strong>
            {voiceState === "connecting"
              ? "CONNECTING"
              : live
                ? "ACTIVE"
                : localWake
                  ? "LOCAL WAKE"
                  : "OFFLINE"}
          </strong>
          <small>
            {live
              ? "AI-generated voice"
              : localWake
                ? "“Hey JARVIS” · on device"
                : "Use the microphone to connect"}
          </small>
        </div>
      </div>
      <button
        className="core-control"
        onClick={onVoice}
        aria-label="Toggle voice core"
        title={live ? "Close voice conversation" : "Start voice conversation"}
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
            {approval ? <Shield size={14} /> : <Mic size={14} />}{" "}
            {voiceState === "connecting"
              ? "CONNECTING VOICE"
              : live
                ? "VOICE CONNECTED"
                : "ACTIVATE VOICE"}
          </span>
        </span>
      </button>
      <div className="hud-readouts right">
        <div className="hud-readout">
          <span>DESKTOP ACCESS</span>
          <strong>
            {state.desktop?.accessibility ? "AUTHORIZED" : "LIMITED"}
          </strong>
          <small>
            {state.desktop?.roots.length || 0} granted folder
            {state.desktop?.roots.length === 1 ? "" : "s"}
          </small>
        </div>
        <div className="hud-readout">
          <span>ACTION PROTOCOL</span>
          <strong>
            {approval ? `${state.approvals.length} PENDING` : "APPROVAL GATED"}
          </strong>
          <small>
            {approval
              ? "Review the exact action in Activity"
              : "Consequential actions require you"}
          </small>
        </div>
      </div>
      <div className="core-status" role="status">
        <span className="pulse-dot" />
        {status}
        <span className="status-rule" />
      </div>
    </section>
  );
}
