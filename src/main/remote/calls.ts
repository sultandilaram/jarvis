import type { AttentionRequest } from "../attention.ts";
export type DesktopCall = {
  attention?: AttentionRequest;
  expires: number;
  reason: string;
  phoneIds: string[];
  answeredBy?: string;
  declined: string[];
};
export class DesktopCalls {
  readonly calls = new Map<string, DesktopCall>();
  create(
    id: string,
    reason: string,
    phones: string[],
    now = Date.now(),
    attention?: AttentionRequest,
  ) {
    for (const [key, value] of this.calls)
      if (value.expires < now) this.calls.delete(key);
    const call: DesktopCall = {
      attention,
      expires: now + 120000,
      reason: reason.slice(0, 2000),
      phoneIds: [...new Set(phones)],
      declined: [],
    };
    this.calls.set(id, call);
    return call;
  }
  resolved(isPending: (attention: AttentionRequest) => boolean) {
    const removed: { id: string; call: DesktopCall }[] = [];
    for (const [id, call] of this.calls)
      if (call.attention && !call.answeredBy && !isPending(call.attention)) {
        this.calls.delete(id);
        removed.push({ id, call });
      }
    return removed;
  }
  info(id: unknown, phone: string, now = Date.now()) {
    const call = typeof id === "string" ? this.calls.get(id) : undefined;
    if (
      !call ||
      call.expires < now ||
      !call.phoneIds.includes(phone) ||
      call.declined.includes(phone) ||
      call.answeredBy
    )
      throw Error("This incoming call has expired or was already answered.");
    return { id, reason: call.reason, expires: call.expires };
  }
  accept(id: unknown, phone: string, now = Date.now()) {
    const value = this.info(id, phone, now);
    this.calls.get(value.id as string)!.answeredBy = phone;
    return value;
  }
  decline(id: unknown, phone: string) {
    const call = typeof id === "string" ? this.calls.get(id) : undefined;
    if (
      call &&
      !call.answeredBy &&
      call.phoneIds.includes(phone) &&
      !call.declined.includes(phone)
    )
      call.declined.push(phone);
    return { declined: true };
  }
}
