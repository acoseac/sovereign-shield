// The bug this pins: on an invalidated extension context, chrome.runtime.sendMessage throws
// SYNCHRONOUSLY, so the old `chrome.runtime.sendMessage(...).catch(() => {})` let an
// "Extension context invalidated" error escape uncaught (the .catch only ever saw a promise
// that was never returned). notifyWorker must swallow that throw, the async rejection, and a
// missing/torn-down context — and never throw itself.
import assert from "node:assert/strict";
import test from "node:test";

import { contextValid, notifyWorker } from "../src/runtime.ts";

// runtime.ts reads the global `chrome`; stub it per-case. Restore after each so cases don't leak.
const realChrome = (globalThis as { chrome?: unknown }).chrome;
function withChrome(stub: unknown, fn: () => void): void {
  (globalThis as { chrome?: unknown }).chrome = stub;
  try {
    fn();
  } finally {
    (globalThis as { chrome?: unknown }).chrome = realChrome;
  }
}

test("the reported case: a synchronous throw does not escape", () => {
  let called = false;
  withChrome(
    {
      runtime: {
        id: "abc",
        sendMessage() {
          called = true;
          throw new Error("Extension context invalidated.");
        },
      },
    },
    () => {
      assert.doesNotThrow(() => notifyWorker({ type: "ss-missed" }));
    },
  );
  assert.equal(called, true, "it did attempt the send");
});

test("a torn-down context is a no-op — sendMessage is never called", () => {
  let called = false;
  withChrome(
    { runtime: { id: undefined, sendMessage: () => ((called = true), Promise.resolve()) } },
    () => {
      notifyWorker({ type: "ss-reset" });
    },
  );
  assert.equal(called, false, "no id means no live context, so nothing is sent");
});

test("an async rejection is swallowed (no unhandled rejection)", async () => {
  withChrome(
    { runtime: { id: "abc", sendMessage: () => Promise.reject(new Error("no receiving end")) } },
    () => {
      assert.doesNotThrow(() => notifyWorker({ type: "ss-failopen" }));
    },
  );
  // Give the rejected microtask a tick to surface as unhandled if it were not caught.
  await new Promise((r) => setTimeout(r, 0));
});

test("the happy path still sends", () => {
  const sent: unknown[] = [];
  withChrome(
    { runtime: { id: "abc", sendMessage: (m: unknown) => (sent.push(m), Promise.resolve()) } },
    () => {
      notifyWorker({ type: "ss-redaction", category: "email" });
    },
  );
  assert.deepEqual(sent, [{ type: "ss-redaction", category: "email" }]);
});

test("a sendMessage that returns undefined instead of a Promise doesn't throw", () => {
  // Some environments/mocks return undefined; `.catch` on that would throw synchronously —
  // exactly the failure mode this module exists to prevent.
  withChrome({ runtime: { id: "abc", sendMessage: () => undefined } }, () => {
    assert.doesNotThrow(() => notifyWorker({ type: "ss-missed" }));
  });
});

test("when chrome is entirely undefined, both are safe no-ops", () => {
  withChrome(undefined, () => {
    assert.equal(contextValid(), false);
    assert.doesNotThrow(() => notifyWorker({ type: "ss-missed" }));
  });
});

test("even reading chrome.runtime can throw — contextValid returns false, notifyWorker no-ops", () => {
  const hostile = {
    get runtime(): never {
      throw new Error("Extension context invalidated.");
    },
  };
  withChrome(hostile, () => {
    assert.equal(contextValid(), false);
    assert.doesNotThrow(() => notifyWorker({ type: "ss-missed" }));
  });
});

test("contextValid reflects a live vs torn-down context", () => {
  withChrome({ runtime: { id: "abc" } }, () => assert.equal(contextValid(), true));
  withChrome({ runtime: { id: undefined } }, () => assert.equal(contextValid(), false));
  withChrome({}, () => assert.equal(contextValid(), false));
});
