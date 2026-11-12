import test from "node:test";
import assert from "node:assert/strict";
import { Availability } from "../src/main/availability.ts";
test("availability keeps the system active only when enabled on AC, without blocking display sleep", () => {
  const events: any[] = [];
  const a = new Availability({
    start: (t) => {
      events.push(t);
      return 1;
    },
    stop: (id) => events.push(id),
  });
  assert(!a.update(false, false));
  assert(a.update(true, false));
  assert(a.update(true, false));
  assert.deepEqual(events, ["prevent-app-suspension"]);
  assert(!a.update(true, true));
  assert.deepEqual(events, ["prevent-app-suspension", 1]);
  a.update(true, false);
  a.close();
  assert.equal(a.id, null);
});
