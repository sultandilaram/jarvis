import test from "node:test";
import assert from "node:assert/strict";
import {
  pendingAttention,
  attentionKey,
  attentionPending,
} from "../src/main/attention.ts";
test("information requests describe the real question and remain distinct from approval", () => {
  const s: any = {
    activeTaskId: "task",
    approvals: [
      {
        id: 1,
        method: "item/tool/requestUserInput",
        params: {
          questions: [
            { id: "q", question: "Which client should this report cover?" },
          ],
        },
      },
      {
        id: 2,
        method: "jarvis/desktop/requestApproval",
        params: { title: "Write report.pdf" },
      },
    ],
  };
  const updates = pendingAttention(s);
  assert.match(updates[0].text, /Which client/);
  assert.equal(updates[0].attention?.kind, "question");
  assert.equal(updates[1].attention?.kind, "approval");
  assert.notEqual(
    attentionKey(updates[0].attention!),
    attentionKey({ ...updates[0].attention!, taskId: "next" }),
  );
  assert(attentionPending(updates[0].attention!, s));
  assert(
    !attentionPending(updates[0].attention!, { ...s, activeTaskId: "next" }),
  );
});
