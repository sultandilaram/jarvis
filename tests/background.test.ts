import { test } from "node:test";
import assert from "node:assert/strict";
import { WakeController } from "../src/main/wake.ts";
class LocalWake extends WakeController {
  starts = 0;
  override start() {
    if (
      this.enabled &&
      !this.voiceActive &&
      !this.systemPaused &&
      !this.quitting
    ) {
      this.starts++;
      this.publish("listening", "Local test listener");
    }
  }
}
test("wake activates once only when enabled, local, unpaused, and outside cooldown", () => {
  const wake = new LocalWake("/unused");
  let activations = 0;
  wake.on("wake", () => activations++);
  wake.receive({ type: "wake", onDevice: true });
  assert.equal(activations, 0);
  wake.configure(true);
  wake.receive({ type: "wake", onDevice: false });
  assert.equal(activations, 0);
  wake.receive({ type: "wake", onDevice: true });
  wake.receive({ type: "wake", onDevice: true });
  assert.equal(activations, 1);
  assert.equal(wake.status.state, "paused");
  assert.ok(wake.status.lastWakeAt);
  wake.close();
});
test("voice and screen lock pause local capture; disabling cancels a pending rearm", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const wake = new LocalWake("/unused");
  wake.configure(true);
  assert.equal(wake.starts, 1);
  wake.setVoiceActive(true);
  assert.equal(wake.status.state, "paused");
  wake.receive({ type: "wake", onDevice: true });
  wake.setVoiceActive(false);
  wake.configure(false);
  t.mock.timers.tick(3000);
  assert.equal(wake.starts, 1);
  assert.equal(wake.status.state, "disabled");
  wake.configure(true);
  wake.setSystemPaused(true);
  assert.equal(wake.status.state, "paused");
  wake.setSystemPaused(false);
  assert.equal(wake.status.state, "listening");
  wake.close();
});
test("a missing helper or native recognition error never falls back to cloud processing", () => {
  const missing = new WakeController("/does-not-exist/jarvis-wake");
  missing.configure(true);
  assert.equal(missing.status.state, "error");
  assert.equal(missing.child, undefined);
  missing.close();
  const wake = new LocalWake("/unused");
  wake.configure(true);
  wake.receive({ type: "error", message: "On-device model unavailable" });
  assert.equal(wake.status.state, "error");
  assert.equal(wake.child, undefined);
  wake.close();
});
