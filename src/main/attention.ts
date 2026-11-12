import type { Snapshot } from "../shared/types.ts";
export type AttentionRequest = {
  taskId: string;
  requestId: string | number;
  kind: "question" | "approval";
};
export type TaskUpdate = { text: string; attention?: AttentionRequest };
export function pendingAttention(snapshot: Snapshot): TaskUpdate[] {
  if (!snapshot.activeTaskId) return [];
  return snapshot.approvals.flatMap((a) => {
    if (
      a.params.action === "phone.call" ||
      String(a.params.action || "").startsWith("watch.")
    )
      return [];
    const question = a.method === "item/tool/requestUserInput";
    const detail = question
      ? (a.params.questions || [])
          .map((q: any) => q.question)
          .filter((s: unknown) => typeof s === "string")
          .join(" ")
      : a.params.title ||
        a.params.command ||
        "Review the exact action in JARVIS.";
    return [
      {
        text: `${question ? "I need your information to continue" : "Your approval is needed"}. ${String(detail).slice(0, 1500)}`,
        attention: {
          taskId: snapshot.activeTaskId!,
          requestId: a.id,
          kind: question ? ("question" as const) : ("approval" as const),
        },
      },
    ];
  });
}
export function attentionPending(ref: AttentionRequest, snapshot: Snapshot) {
  return (
    snapshot.activeTaskId === ref.taskId &&
    snapshot.approvals.some(
      (a) =>
        a.id === ref.requestId &&
        (ref.kind === "question"
          ? a.method === "item/tool/requestUserInput"
          : /requestApproval$/.test(a.method)),
    )
  );
}
export function attentionKey(ref: AttentionRequest) {
  return JSON.stringify([ref.taskId, ref.requestId, ref.kind]);
}
