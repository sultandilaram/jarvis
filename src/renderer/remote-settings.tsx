import React, { useState } from "react";
import type { RemoteState } from "../shared/types";
export function RemoteSettings({
  state,
  run,
}: {
  state?: RemoteState;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [url, setURL] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [callStatus, setCallStatus] = useState("");
  return (
    <section className="remote-settings">
      <h3>Connect your phone</h3>
      <details className="permanent-connection" open={!state?.permanent}>
        <summary>
          {state?.permanent
            ? "Permanent connection · " + state.permanent.url
            : "Set up a permanent connection"}
        </summary>
        <p>
          Use a Cloudflare tunnel dedicated to this Mac. In its published route,
          point your hostname to <code>http://127.0.0.1:47832</code>. The
          connector token stays encrypted on this Mac.
        </p>
        <label>
          Permanent HTTPS address
          <input
            type="url"
            autoComplete="off"
            placeholder="https://jarvis.yourdomain.com"
            value={url}
            onChange={(e) => setURL(e.target.value)}
          />
        </label>
        <label>
          Tunnel connector token
          <input
            type="password"
            autoComplete="new-password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste the token or copied connector command"
          />
        </label>
        <button
          className="subtle"
          disabled={
            saving || !url.trim() || !token.trim() || state?.voiceActive
          }
          onClick={() =>
            void run(async () => {
              setSaving(true);
              try {
                await window.jarvis.remoteConfigurePermanent({
                  url: url.trim(),
                  token: token.trim(),
                  autoStart: true,
                });
                setToken("");
                setURL("");
              } finally {
                setToken("");
                setSaving(false);
              }
            })
          }
        >
          {saving
            ? "Connecting…"
            : state?.permanent
              ? "Replace permanent connector"
              : "Save and connect automatically"}
        </button>
      </details>
      <p>
        Scan the QR in the Android app. Compare the six-digit code on both
        devices, then approve pairing here. A paired phone can see the
        conversation, give tasks, stop work and approve consequential actions.
      </p>
      {!state?.running || state.starting ? (
        <button
          className="subtle"
          disabled={state?.starting}
          onClick={() => void run(() => window.jarvis.remoteStart())}
        >
          {state?.starting
            ? "Starting secure mobile link…"
            : "Enable mobile link & show QR"}
        </button>
      ) : (
        <>
          <p className="muted small">
            {state.permanent
              ? "This permanent address reconnects after app and network restarts. Pair each phone once; the Mac must stay awake and online."
              : "This test address is temporary. Set up a permanent connection above to keep your phone paired across restarts."}
          </p>
          {state.qrDataURL && (
            <div className="pairing-qr">
              <img
                src={state.qrDataURL}
                width="240"
                height="240"
                alt="Private phone pairing QR"
              />
              <small>
                Expires two minutes after generation. Keep this QR private.
              </small>
            </div>
          )}
          <div className="settings-buttons">
            <button
              className="subtle"
              onClick={() => void run(() => window.jarvis.remoteQR())}
            >
              Fresh pairing QR
            </button>
            <button
              className="subtle"
              onClick={() => void run(() => window.jarvis.remoteDisable())}
            >
              Disable mobile link
            </button>
          </div>
        </>
      )}
      {state?.pending && (
        <div className="phone-confirm">
          <span className="eyebrow">
            PAIRING REQUEST / {state.pending.name}
          </span>
          <h2>{state.pending.code}</h2>
          <p>
            Only pair if this exact code appears on your phone. Pairing grants
            task and approval access to this Mac.
          </p>
          <button
            className="subtle"
            onClick={() =>
              void run(() => window.jarvis.remotePair(state.pending!.id, true))
            }
          >
            Codes match — pair phone
          </button>
          <button
            className="subtle"
            onClick={() =>
              void run(() => window.jarvis.remotePair(state.pending!.id, false))
            }
          >
            Reject
          </button>
        </div>
      )}
      {state?.running && state.url && (
        <p className="muted small">
          Install Android app:{" "}
          <code style={{ overflowWrap: "anywhere" }}>
            {state.url}/android.apk
          </code>
        </p>
      )}
      {state?.phones.map((p) => (
        <div className="paired-phone" key={p.id}>
          <span>
            {p.name}
            <small>{p.online ? "Connected" : "Offline"}</small>
            <small>{p.alertsEnabled ? "Background alerts registered" : "Background alerts not registered"}</small>
          </span>
          <button
            className="subtle"
            onClick={() => void run(() => window.jarvis.remoteRevoke(p.id))}
          >
            Revoke
          </button>
        </div>
      ))}
      <h4>Incoming calls</h4>
      <p>
        {state?.pushConfigured
          ? "Firebase is configured. Enable notifications in the Android app, then test with the phone locked."
          : "Configure Firebase before testing alerts while the phone is locked. These JSON files stay encrypted on this Mac and are excluded from shared apps."}
      </p>
      <div className="settings-buttons">
        <button
          className="subtle"
          onClick={() => void run(() => window.jarvis.remoteConfigurePush())}
        >
          {state?.pushConfigured
            ? "Replace Firebase configuration"
            : "Configure Firebase JSON files"}
        </button>
        <button
          className="subtle"
          disabled={!state?.running || !state.phones.length}
          onClick={() =>
            void run(async () => {
              setCallStatus("");
              const r = (await window.jarvis.remoteNotify()) as any;
              if (r.accepted === false) throw Error(r.reason || "Call was not requested.");
              if (r.push?.some((p: any) => p.error))
                throw Error(
                  r.push
                    .map((p: any) => p.error)
                    .filter(Boolean)
                    .join("\n"),
                );
              const accepted = r.push?.filter((p: any) => p.accepted).length || 0;
              setCallStatus(accepted
                ? `${accepted} background call request accepted. Delivery and ringing still need confirmation on the phone.`
                : "No background alert was sent. Enable alerts in the Android app; a connected app alone does not establish push delivery.");
            })
          }
        >
          Call paired phone
        </button>
      </div>
      {callStatus && <p role="status">{callStatus}</p>}
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
    </section>
  );
}
