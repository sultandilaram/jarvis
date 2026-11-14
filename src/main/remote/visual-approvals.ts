import type { Approval } from "../../shared/types.ts";
export function phoneApprovals(approvals: Approval[], visualPreview: unknown) {
  return approvals.map((a) =>
    a.params.action !== "desktop.click_image" || visualPreview === 1
      ? a
      : {
          ...a,
          params: {
            ...a.params,
            preview: {
              ...a.params.preview,
              imageUrl: undefined,
              effect:
                "This visual action needs a current JARVIS client. Review the marked image on the Mac or update this phone before approving.",
            },
          },
        },
  );
}
export function checkVisualApproval(
  approvals: Approval[],
  id: unknown,
  accept: unknown,
  visualPreview: unknown,
) {
  const a = approvals.find((a) => a.id === id);
  if (
    accept === true &&
    a?.params.action === "desktop.click_image" &&
    visualPreview !== 1
  )
    throw Error(
      "This phone cannot review the marked window image. Approve on the Mac or update the phone app. No action was approved.",
    );
}
