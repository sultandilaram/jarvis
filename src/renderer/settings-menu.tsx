import React, {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { Search, X, ChevronLeft, type LucideIcon } from "lucide-react";
import "./settings-menu.css";
type PageProps = {
  id: string;
  title: string;
  description: string;
  keywords: string;
  icon: LucideIcon;
  children: React.ReactNode;
};
export function SettingsPage({ children }: PageProps) {
  return <>{children}</>;
}
export function SettingsMenu({
  children,
  onClose,
  error,
}: {
  children: React.ReactNode;
  onClose: () => void;
  error?: string;
}) {
  const pages = Children.toArray(children).filter(
    (p) => isValidElement(p) && p.type === SettingsPage,
  ) as React.ReactElement<PageProps>[];
  const [selected, setSelected] = useState("general"),
    [query, setQuery] = useState(""),
    [showPage, setShowPage] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const navButton = useRef<HTMLButtonElement>(null),
    returnToNav = useRef(false);
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = pages.filter((p) =>
    words.every((word) =>
      (p.props.title + " " + p.props.description + " " + p.props.keywords)
        .toLocaleLowerCase()
        .includes(word),
    ),
  );
  const active = visible.find((p) => p.props.id === selected) || visible[0];
  useEffect(() => {
    if (showPage) heading.current?.focus();
    else if (returnToNav.current) {
      navButton.current?.focus();
      returnToNav.current = false;
    }
  }, [active?.props.id, showPage]);
  return (
    <div className={`settings-shell ${showPage ? "settings-show-page" : ""}`}>
      <aside className="settings-sidebar" aria-label="Settings navigation">
        <button
          className="icon-button settings-menu-close"
          aria-label="Close settings"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <h2>Settings</h2>
        <label className="settings-search">
          <Search size={17} aria-hidden="true" />
          <input
            autoFocus
            type="search"
            aria-label="Search settings"
            placeholder="Search settings"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowPage(false);
            }}
          />
        </label>
        <nav aria-label="Settings sections">
          {visible.map(({ props: p }) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                ref={p.id === active?.props.id ? navButton : undefined}
                className={p.id === active?.props.id ? "selected" : ""}
                aria-current={p.id === active?.props.id ? "page" : undefined}
                onClick={() => {
                  setSelected(p.id);
                  setShowPage(true);
                }}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{p.title}</span>
              </button>
            );
          })}
        </nav>
        {query && (
          <p className="settings-search-status" role="status">
            {visible.length} {visible.length === 1 ? "section" : "sections"}{" "}
            found
          </p>
        )}
        <p className="settings-sidebar-note">
          Your Mac. Your assistant.
          <br />
          Settings saved on this Mac.
        </p>
      </aside>
      <section
        className="settings-detail"
        aria-label={active?.props.title || "Settings results"}
      >
        <div className="settings-detail-header">
          <button
            className="settings-back subtle"
            onClick={() => {
              returnToNav.current = true;
              setShowPage(false);
            }}
          >
            <ChevronLeft size={18} />
            All settings
          </button>
          <button
            className="icon-button settings-close"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={20} />
          </button>
          {active && (
            <>
              <h2 ref={heading} tabIndex={-1}>
                {active.props.title}
              </h2>
              <p>{active.props.description}</p>
            </>
          )}
        </div>
        <div className="settings-page-content">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {pages.map((p) => (
            <div key={p.props.id} hidden={p.props.id !== active?.props.id}>
              <SettingsPage {...p.props} />
            </div>
          ))}
          {!active && (
            <div className="settings-no-results">
              <h3>No matching settings</h3>
              <p>
                Try a provider, feature or permission, such as “Ollama”,
                “speaker” or “folders”.
              </p>
              <button onClick={() => setQuery("")}>Clear search</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
