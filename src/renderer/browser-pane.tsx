import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  Plus,
  Globe,
  Hand,
  Play,
  LockKeyhole,
} from "lucide-react";
import type { BrowserState } from "../main/desktop/browser";
import "./browser-pane.css";
export function browserAddress(raw: string) {
  const s = raw.trim();
  if (!s) throw Error("Enter an address or search phrase.");
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s))
    throw Error("Only HTTP(S) pages can open here.");
  if (
    !/\s/.test(s) &&
    (/^[^/]+\.[^/]+(?:\/|$)/.test(s) || /^localhost(?::\d+)?(?:\/|$)/.test(s))
  )
    return "https://" + s;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(s);
}
export function BrowserPane({
  state,
  visible,
  layoutKey,
}: {
  state?: BrowserState;
  visible: boolean;
  layoutKey: boolean;
}) {
  const tabs = state?.tabs || [],
    active = tabs.find((t) => t.id === state?.activeTabId);
  const [address, setAddress] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const stage = useRef<HTMLDivElement>(null),
    editing = useRef(false),
    initial = useRef(false),
    live = useRef(false);
  useEffect(() => {
    if (!editing.current) setAddress(active?.url || "");
  }, [active?.id, active?.url]);
  const act = async (action: string, id = active?.id, value?: string) => {
    setError("");
    setBusy(true);
    try {
      return await window.jarvis.browserAction(action, id, value);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The browser action did not complete.",
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (visible && !tabs.length && !initial.current) {
      initial.current = true;
      void act("new", undefined);
    }
  }, [visible, tabs.length]);
  useLayoutEffect(() => {
    let cancelled = false;
    live.current = visible && !!active?.url;
    const update = () => {
      if (cancelled || !live.current || !stage.current) return;
      const b = stage.current.getBoundingClientRect();
      void window.jarvis
        .browserLayout({
          x: Math.floor(b.x),
          y: Math.floor(b.y),
          width: Math.floor(b.width),
          height: Math.floor(b.height),
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    };
    const observer = new ResizeObserver(update);
    if (stage.current) observer.observe(stage.current);
    void window.jarvis
      .browserSurface(live.current)
      .then(() => {
        if (!cancelled) update();
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
      live.current = false;
      observer.disconnect();
      void window.jarvis.browserSurface(false);
    };
  }, [visible, active?.id, !!active?.url, layoutKey]);
  return (
    <section
      id="browser-view"
      className="browser-pane"
      role="tabpanel"
      aria-labelledby="tab-browser"
    >
      <div
        className="browser-tabs"
        role="tablist"
        aria-label="Browser pages"
        onKeyDown={(e) => {
          if (
            !tabs.length ||
            !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
          )
            return;
          e.preventDefault();
          const index = tabs.findIndex((t) => t.id === active?.id),
            next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? tabs.length - 1
                  : (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                    tabs.length;
          void act("activate", tabs[next].id);
          e.currentTarget
            .querySelector<HTMLButtonElement>(
              `[data-tab-id="${tabs[next].id}"]`,
            )
            ?.focus();
        }}
      >
        {tabs.map((t) => (
          <div
            className={
              "browser-page-tab" + (t.id === active?.id ? " selected" : "")
            }
            key={t.id}
            role="presentation"
          >
            <button
              role="tab"
              data-tab-id={t.id}
              aria-selected={t.id === active?.id}
              tabIndex={t.id === active?.id ? 0 : -1}
              onClick={() => void act("activate", t.id)}
              title={t.title}
            >
              <Globe size={14} />
              <span>{t.title || "New tab"}</span>
            </button>
            <button
              className="browser-close-tab"
              aria-label={"Close " + (t.title || "new tab")}
              onClick={() => void act("close", t.id)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button
          className="browser-icon"
          aria-label="New browser tab"
          disabled={busy || tabs.length >= 16}
          onClick={() => void act("new", undefined)}
        >
          <Plus size={17} />
        </button>
      </div>
      <div className="browser-toolbar">
        <button
          className="browser-icon"
          aria-label="Back"
          disabled={!visible || !active?.canGoBack}
          onClick={() => void act("back")}
        >
          <ArrowLeft size={18} />
        </button>
        <button
          className="browser-icon"
          aria-label="Forward"
          disabled={!visible || !active?.canGoForward}
          onClick={() => void act("forward")}
        >
          <ArrowRight size={18} />
        </button>
        <button
          className="browser-icon"
          aria-label={active?.loading ? "Stop loading" : "Reload page"}
          disabled={!visible || !active?.url}
          onClick={() => void act(active?.loading ? "stop" : "reload")}
        >
          {active?.loading ? <X size={17} /> : <RotateCw size={17} />}
        </button>
        <form
          className="browser-address"
          onSubmit={(e) => {
            e.preventDefault();
            if (!active) return;
            try {
              const url = browserAddress(address);
              editing.current = false;
              setAddress(url);
              void act("navigate", active.id, url);
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          <label className="sr-only" htmlFor="browser-address">
            Search or enter an address
          </label>
          <Globe size={15} aria-hidden="true" />
          <input
            id="browser-address"
            value={address}
            disabled={!visible || !active}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search DuckDuckGo or enter an address"
            onFocus={() => {
              editing.current = true;
              if (active) void act("take-control");
            }}
            onBlur={() => (editing.current = false)}
            onChange={(e) => setAddress(e.target.value)}
          />
        </form>
        {active && (
          <button
            className="browser-control"
            disabled={!visible || busy}
            aria-label={active.manual ? "Let JARVIS use this tab" : "Take control"}
            title={active.manual ? "Let JARVIS use this tab" : "Take control"}
            onClick={() => void act(active.manual ? "resume" : "take-control")}
          >
            {active.manual ? <Play size={15} /> : <Hand size={15} />}
            <span>
              {active.manual ? "Let JARVIS use this tab" : "Take control"}
            </span>
          </button>
        )}
      </div>
      <div className="browser-status" role="status">
        <span>
          <LockKeyhole size={13} />
          {active?.manual
            ? "You’re in control · browser automation paused"
            : "JARVIS can use this tab · consequential actions need approval"}
        </span>
        <span>{tabs.length} / 16 tabs</span>
      </div>
      {(error || active?.error) && (
        <p role="alert" className="browser-error">
          {error || active?.error}
        </p>
      )}
      {active?.popup && (
        <div className="browser-popup">
          <span>
            Blocked new tab from{" "}
            {(() => {
              try {
                return new URL(active.popup!).hostname;
              } catch {
                return "this page";
              }
            })()}
          </span>
          <button disabled={!visible} onClick={() => void act("popup")}>
            Open this link
          </button>
        </div>
      )}
      <div ref={stage} className="browser-stage">
        {!visible ? (
          <div className="browser-home">
            <LockKeyhole size={28} />
            <h2>Review comes first.</h2>
            <p>The page is hidden while settings or an approval is open.</p>
          </div>
        ) : !active?.url ? (
          <div className="browser-home">
            <Globe size={38} />
            <h2>JARVIS Browser</h2>
            <p>Open a page, sign in yourself, then hand the tab to JARVIS.</p>
            <p className="muted">
              Your tabs share a separate JARVIS session. Clicking or typing in a
              page returns control to you. Some providers require system-browser
              sign-in.
            </p>
            {!tabs.length && (
              <button onClick={() => void act("new", undefined)}>
                Open a new tab
              </button>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
