import type { ActionPlan } from "../desktop/broker.ts";
export type PhoneTarget = { id: string; name: string; online: boolean; alertsEnabled: boolean };
export type PhoneControl = {
  ready: () => boolean;
  phones: () => PhoneTarget[];
  call: (reason: string, phoneId: string, signal: AbortSignal) => Promise<unknown>;
};
export function phoneAction(action: string, args: Record<string, unknown>, control: PhoneControl): ActionPlan {
  if (action === "phone.status") return {
    title: "Check paired phone connection", approval: false, preview: {},
    run: async () => ({ connected: control.ready(), phones: control.phones(), capabilities: ["Call a paired phone with a short update after approval"], limitations: ["No access to Android files, apps, contacts or telephone calls", "Push acceptance is not proof the phone rang"] }),
  };
  if (action !== "phone.call") throw Error("Unsupported phone action");
  const id = args.phoneId;
  const reason = typeof args.text === "string" ? args.text.trim() : "";
  if (typeof id !== "string" || !reason || reason.length > 2000) throw Error("Select a phoneId from phone.status and provide the exact update text (up to 2000 characters).");
  const phone = control.phones().find(p => p.id === id);
  if (!phone) throw Error("This phone is not paired. Check phone.status.");
  const verify = async () => {
    if (!control.ready()) throw Error("The permanent phone link is not connected.");
    const current = control.phones().find(p => p.id === id);
    if (!current || current.name !== phone.name) throw Error("The phone target changed; request a new approval.");
    if (!current.alertsEnabled) throw Error("Enable alerts in this phone's JARVIS Settings before requesting a background call.");
  };
  return { title: "Call " + phone.name, approval: true,
    preview: { recipient: phone.name, phoneId: id, update: reason, effect: "End an active Mac voice session to hand over, then ring this paired phone and speak this update after it answers. No phone files or apps are accessed." },
    verify, run: async (signal) => {
      signal.throwIfAborted();
      const result = await control.call(reason, id, signal) as any;
      if (result?.accepted === false) throw Error(result.reason || "The phone call was not requested.");
      const failed = result?.push?.find((item: any) => item.error);
      if (failed) throw Error(failed.error);
      return result;
    },
  };
}
