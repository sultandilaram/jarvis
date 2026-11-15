import type { Approval, Snapshot } from "../shared/types.ts";

export const rendererWireLimit = 4 * 1024 * 1024;
const approvalLimit = 1800 * 1024;
const approvalBudget = 2300 * 1024;
const shortened =
  "\n[Shortened for display; full activity remains in local history.]";
const size = (value: string) => Buffer.byteLength(value, "utf8");
function clip(value: string, limit: number) {
  return value.length <= limit ? value : value.slice(0, limit) + shortened;
}
const omitted = Symbol("omitted display section");
const freeText = new Set([
  "goal",
  "result",
  "checkpoint",
  "review",
  "error",
  "detail",
  "text",
  "description",
  "notes",
  "title",
  "reason",
]);
// Records are atomic: never drop required keys or replace a record by a marker.
// Only free text is shortened; IDs, statuses and configuration retain exact values.
function bounded(
  value: unknown,
  key: string,
  depth: number,
  budget: { nodes: number },
): any {
  if (--budget.nodes < 0 || depth > 12) return omitted;
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string") {
    if (freeText.has(key)) return clip(value, 2000);
    return value.length <= 128 * 1024 ? value : omitted;
  }
  if (value === undefined) return undefined;
  if (typeof value !== "object") return omitted;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    let total = 0;
    for (const item of value.slice(0, 30)) {
      if (budget.nodes <= 0) break;
      const projected = bounded(item, key, depth + 1, budget);
      if (projected === omitted) continue;
      const bytes = size(JSON.stringify(projected) ?? "null");
      if (total + bytes > 48 * 1024) break;
      total += bytes;
      out.push(projected);
    }
    return out;
  }
  const pairs = Object.entries(value);
  if (pairs.length > 128) return omitted;
  const out: Record<string, unknown> = Object.create(null);
  for (const [name, item] of pairs) {
    if (name.length > 256) return omitted;
    const projected = bounded(item, name, depth + 1, budget);
    if (projected === omitted) return omitted;
    out[name] = projected;
  }
  return size(JSON.stringify(out)) <= 96 * 1024 ? out : omitted;
}

function exactApproval(approval: Approval): string | undefined {
  let nodes = 0;
  const seen = new Set<object>();
  const inspect = (value: unknown, depth: number): boolean => {
    if (++nodes > 20000 || depth > 12) return false;
    if (typeof value === "string") return value.length <= approvalLimit;
    if (!value || typeof value !== "object") return true;
    if (seen.has(value)) return false;
    seen.add(value);
    const ok = Object.values(value).every((child) => inspect(child, depth + 1));
    seen.delete(value);
    return ok;
  };
  if (!inspect(approval, 0)) return undefined;
  try {
    const wire = JSON.stringify(approval);
    return size(wire) <= approvalLimit ? wire : undefined;
  } catch {
    return undefined;
  }
}
export function rendererApprovals(approvals: Approval[]): Approval[] {
  let remaining = approvalBudget;
  return approvals
    .filter(
      (approval) =>
        ((typeof approval.id === "string" && approval.id.length <= 256) ||
          (typeof approval.id === "number" && Number.isFinite(approval.id))) &&
        typeof approval.method === "string" &&
        approval.method.length <= 256,
    )
    .slice(0, 32)
    .map((approval) => {
      const wire = exactApproval(approval);
      if (wire && size(wire) <= remaining) {
        remaining -= size(wire);
        return JSON.parse(wire);
      }
      return {
        id: approval.id,
        method: approval.method,
        params: {
          title: "This request is too large to review safely",
          reviewUnavailable: true,
          reason:
            "Decline this request and ask for a smaller, specific action. Nothing is approved.",
        },
      };
    });
}
export function rendererApprovalAllowed(
  approvals: Approval[],
  id: string | number,
): boolean {
  const approval = rendererApprovals(approvals).find((item) => item.id === id);
  return !!approval && approval.params.reviewUnavailable !== true;
}
// Only a display projection is bounded. Persistence, task state and approval
// authority remain in main; a shortened preview can never authorize an action.
export function rendererSnapshot(state: Snapshot): Snapshot {
  const { entries, approvals, ...rest } = state;
  const display = Object.create(null) as Snapshot;
  let omittedSection = false;
  for (const [key, value] of Object.entries(rest)) {
    const projected = bounded(value, key, 0, { nodes: 4000 });
    if (projected !== omitted) (display as any)[key] = projected;
    else omittedSection = true;
  }
  if (omittedSection && !display.interfaceNotice)
    display.interfaceNotice =
      "Some live details are unavailable in this view. Full records remain stored locally.";
  const recent = new Set([
    ...entries.filter((entry) => entry.role !== "activity").slice(-80),
    ...entries.filter((entry) => entry.role === "activity").slice(-120),
  ]);
  const selected = entries.filter((entry) => recent.has(entry));
  display.entries = selected.map((entry) => ({
    ...entry,
    text: clip(entry.text, entry.role === "activity" ? 6000 : 16000),
  }));
  let total = 0;
  display.entries = display.entries
    .reverse()
    .filter((entry) => {
      const cost = size(JSON.stringify(entry));
      if (total + cost > 320000) return false;
      total += cost;
      return true;
    })
    .reverse();
  display.approvals = rendererApprovals(approvals);
  return display;
}
export function rendererWire(state: Snapshot): string {
  const display = rendererSnapshot(state);
  let wire = JSON.stringify(display);
  if (size(wire) > rendererWireLimit) {
    // Keep controls/settings/approvals while omitting optional live summaries.
    // Never drop the exact approval details to make a request approvable.
    display.entries = [];
    display.memories = [];
    for (const key of [
      "maintenance",
      "jobs",
      "subagents",
      "monitors",
      "watches",
      "extensions",
      "providers",
      "pluginCatalog",
    ])
      delete (display as any)[key];
    display.interfaceNotice =
      "Live history was reduced to restore the interface. Full records remain stored locally.";
    wire = JSON.stringify(display);
  }
  if (size(wire) > rendererWireLimit)
    throw Error("The live interface state exceeded its display limit.");
  return wire;
}

// Streaming tokens and tool events collapse into one latest-state delivery.
export class RendererPublisher {
  timer?: ReturnType<typeof setTimeout>;
  ready = false;
  constructor(
    private get: () => string,
    private send: (wire: string) => void,
    private failed: (error: unknown) => void,
    private delay = 120,
  ) {}
  queue() {
    if (!this.ready || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.ready) return;
      try {
        this.send(this.get());
      } catch (error) {
        this.failed(error);
      }
    }, this.delay);
  }
  pause() {
    this.ready = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
  resume() {
    this.ready = true;
    this.queue();
  }
}
