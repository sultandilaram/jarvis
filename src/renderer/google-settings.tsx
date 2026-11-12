import React, { useState } from "react";
import { CalendarDays, Mail, Check, Loader2 } from "lucide-react";
import type { GoogleState } from "../main/integrations/google";
import "./google-settings.css";
export function GoogleSettings({ state }: { state?: GoogleState }) {
  const [write, setWrite] = useState({
    gmail: !!state?.gmail?.write,
    calendar: !!state?.calendar?.write,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const perform = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The connection could not be updated. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const waiting = !!state?.connecting;
  return (
    <details className="settings-section google-settings">
      <summary>
        Email and calendar
        {(state?.gmail || state?.calendar) && (
          <span className="google-summary"> · Connected</span>
        )}
      </summary>
      <p>
        Bring your inbox and schedule into the conversation. Connect on this
        Mac; use them here or through your paired phone.
      </p>
      {!state?.configured ? (
        <div className="google-setup">
          <h3>Set up Google sign-in</h3>
          <p>
            Enable the Gmail and Google Calendar APIs in your Google Cloud
            project. Configure the consent screen, add your account as a test
            user, then create a <strong>Desktop app</strong> OAuth client and
            download its JSON.
          </p>
          <div className="settings-actions">
            <button
              disabled={busy}
              onClick={() => void perform(() => window.jarvis.googleSetup())}
            >
              Open Google Cloud setup
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void perform(() => window.jarvis.googleConfigure())
              }
            >
              {busy ? "Working…" : "Import OAuth client JSON"}
            </button>
          </div>
          <p className="muted small">
            For personal testing, use your own client. Google may require
            verification before public distribution; Gmail access uses
            restricted scopes. A Firebase push key cannot connect your inbox.
          </p>
        </div>
      ) : (
        <p className="google-client-ready">
          <Check size={16} aria-hidden="true" /> Google sign-in is configured.
          Choose what to connect below.
        </p>
      )}
      <div className="google-connections">
        {(["gmail", "calendar"] as const).map((service) => {
          const account = state?.[service],
            name = service === "gmail" ? "Gmail" : "Google Calendar",
            Icon = service === "gmail" ? Mail : CalendarDays;
          const active = state?.connecting === service;
          return (
            <section
              className="google-connection"
              key={service}
              aria-labelledby={`google-${service}-title`}
            >
              <div className="google-connection-title">
                <Icon size={21} aria-hidden="true" />
                <h3 id={`google-${service}-title`}>{name}</h3>
                <span className="google-connection-status">
                  {active
                    ? "Awaiting Google sign-in"
                    : account
                      ? "Connected"
                      : "Not connected"}
                </span>
              </div>
              {account ? (
                <p className="google-account">
                  {account.email}
                  <span>
                    {account.write
                      ? service === "gmail"
                        ? "Read and approved sending"
                        : "Read and approved event creation"
                      : "Read-only access"}
                  </span>
                </p>
              ) : (
                <p>
                  {service === "gmail"
                    ? "Find messages and read email summaries."
                    : "Ask about upcoming events on your primary calendar."}
                </p>
              )}
              <label className="google-write-option">
                <input
                  type="checkbox"
                  checked={write[service]}
                  disabled={busy || waiting}
                  onChange={(e) =>
                    setWrite({ ...write, [service]: e.target.checked })
                  }
                />
                <span>
                  {service === "gmail"
                    ? "Allow sending after approval"
                    : "Allow creating events after approval"}
                  <small>
                    {service === "gmail"
                      ? "Every email shows the sender, recipients and full message before sending."
                      : "Every event shows its time, details and invitees before creation."}{" "}
                    Google will ask for this extra permission when you connect.
                  </small>
                </span>
              </label>
              {account && account.write !== write[service] && (
                <p className="muted small">
                  Reconnect to apply this permission change.
                </p>
              )}
              <div className="settings-actions">
                <button
                  disabled={!state?.configured || busy || waiting}
                  onClick={() =>
                    void perform(() =>
                      window.jarvis.googleConnect(service, write[service]),
                    )
                  }
                >
                  {active ? (
                    <>
                      <Loader2 size={15} aria-hidden="true" /> Waiting for
                      sign-in…
                    </>
                  ) : account ? (
                    account.write !== write[service] ? (
                      `Apply ${name} permissions`
                    ) : (
                      `Reconnect ${name}`
                    )
                  ) : (
                    `Connect ${name}`
                  )}
                </button>
                {account && (
                  <button
                    className="subtle"
                    disabled={busy || waiting}
                    onClick={() =>
                      void perform(() =>
                        window.jarvis.googleDisconnect(service),
                      )
                    }
                  >
                    Disconnect {name}
                  </button>
                )}
              </div>
              {active && (
                <p role="status">
                  Finish sign-in in your browser.{" "}
                  <button
                    className="subtle"
                    onClick={() => void window.jarvis.googleCancel()}
                  >
                    Cancel sign-in
                  </button>
                </p>
              )}
            </section>
          );
        })}
      </div>
      {(error || state?.error) && (
        <p className="google-error" role="alert">
          {error || state?.error}
        </p>
      )}
      <p className="muted small">
        Tokens stay encrypted on this Mac. Email and event details requested in
        a task become part of its local history and may be sent to your AI
        provider for processing. No inbox monitoring starts when you connect.
      </p>
      {state?.configured && (
        <details className="google-advanced">
          <summary>Connection management</summary>
          <p>
            Disconnect removes JARVIS’s local tokens. To revoke access at Google
            too, use Manage Google access. Revoking the shared OAuth client may
            disconnect both services. Chat history remains.
          </p>
          <div className="settings-actions">
            <button
              disabled={busy || waiting}
              onClick={() =>
                void perform(() => window.jarvis.googleManageAccess())
              }
            >
              Manage Google access
            </button>
            <button
              disabled={busy || waiting || !!state.gmail || !!state.calendar}
              onClick={() =>
                void perform(() => window.jarvis.googleConfigure())
              }
            >
              Replace OAuth client
            </button>
          </div>
          {(state.gmail || state.calendar) && (
            <p className="muted small">
              Disconnect both services before replacing the client.
            </p>
          )}
        </details>
      )}
    </details>
  );
}
