import type { HistoryStore } from "../providers/engine.ts";
export type BuiltinPluginId = "browser" | "gmail" | "calendar";
export type PluginKind = "embedded" | "built-in" | "external";
export type CatalogEntry = {
  id: string;
  name: string;
  kind: PluginKind;
  required: boolean;
  enabled: boolean;
  connected: boolean;
  description: string;
  account?: string;
  capabilities: string[];
};
type Accounts = {
  gmail?: { email: string; write: boolean };
  calendar?: { email: string; write: boolean };
};
export const builtinPluginIds = ["browser", "gmail", "calendar"] as const;
export function isBuiltinPlugin(id: unknown): id is BuiltinPluginId {
  return (
    typeof id === "string" &&
    (builtinPluginIds as readonly string[]).includes(id)
  );
}
export class PluginCatalog {
  private generations = { gmail: 0, calendar: 0 };
  constructor(
    private store: HistoryStore,
    private accounts: () => Accounts,
    private changed: () => void,
  ) {}
  enabled(id: BuiltinPluginId) {
    if (id === "browser") return true;
    const flags = this.store.get<
      Partial<Record<"gmail" | "calendar", boolean>>
    >("builtinPluginEnabled", {});
    // Preserve existing Google connections when upgrading from pre-plugin releases.
    return typeof flags[id] === "boolean" ? flags[id]! : !!this.accounts()[id];
  }
  set(id: unknown, enabled: unknown) {
    if (!isBuiltinPlugin(id) || typeof enabled !== "boolean")
      throw Error("Choose a built-in plugin and an explicit state.");
    if (id === "browser") {
      if (!enabled)
        throw Error(
          "JARVIS Browser is an embedded plugin and cannot be disabled.",
        );
      return;
    }
    if (enabled && !this.accounts()[id])
      throw Error("Connect this plugin's Google account first.");
    const flags = this.store.get<
      Partial<Record<"gmail" | "calendar", boolean>>
    >("builtinPluginEnabled", {});
    this.store.set("builtinPluginEnabled", { ...flags, [id]: enabled });
    this.generations[id]++;
    this.changed();
  }
  beginConnect(id: "gmail" | "calendar") {
    this.set(id, false);
    return this.generations[id];
  }
  finishConnect(id: "gmail" | "calendar", generation: number) {
    if (generation === this.generations[id] && this.accounts()[id])
      this.set(id, true);
  }
  entries(): CatalogEntry[] {
    const a = this.accounts();
    return [
      {
        id: "browser",
        name: "JARVIS Browser",
        kind: "embedded",
        required: true,
        enabled: true,
        connected: true,
        description:
          "JARVIS’s own browser session, with manual takeover and reviewed page interaction.",
        capabilities: [
          "browser.open",
          "browser.read",
          "browser.click",
          "browser.type",
          "browser.show",
        ],
      },
      ...(["gmail", "calendar"] as const).map((id) => ({
        id,
        name: id === "gmail" ? "Gmail" : "Google Calendar",
        kind: "built-in" as const,
        required: false,
        enabled: this.enabled(id) && !!a[id],
        connected: !!a[id],
        account: a[id]?.email,
        description:
          id === "gmail"
            ? "Find and read your messages; sending needs optional permission and approval."
            : "Read your primary calendar; event creation needs optional permission and approval.",
        capabilities:
          id === "gmail"
            ? [
                "email.search",
                "email.read",
                ...(a[id]?.write ? ["email.send"] : []),
              ]
            : ["calendar.list", ...(a[id]?.write ? ["calendar.create"] : [])],
      })),
    ];
  }
}
