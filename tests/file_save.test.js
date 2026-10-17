"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readSnapshot, writeIfUnchanged, FileConflictError, MAX_BYTES } = require("../web/file_save.js");
function handle(initial) {
  let text = initial;
  let writes = 0;
  let aborts = 0;
  let fail = false;
  return {
    getFile: async () => ({ size: Buffer.byteLength(text), text: async () => text }),
    createWritable: async () => ({
      write: async next => { if (fail) throw new Error("disk full"); text = next; writes++; },
      close: async () => {},
      abort: async () => { aborts++; }
    }),
    external: next => { text = next; },
    fail: () => { fail = true; },
    state: () => ({ text, writes, aborts })
  };
}
test("reads UTF-8 source and writes Unicode without losing data", async () => {
  const h = handle("α\n");
  const baseline = await readSnapshot(h);
  assert.equal(baseline, "α\n");
  assert.equal(await writeIfUnchanged(h, baseline, "β\n"), "β\n");
  assert.deepEqual(h.state(), { text: "β\n", writes: 1, aborts: 0 });
});
test("rejects changed disk content before opening a writer", async () => {
  const h = handle("before");
  const baseline = await readSnapshot(h);
  h.external("external edit");
  await assert.rejects(writeIfUnchanged(h, baseline, "local edit"), FileConflictError);
  assert.deepEqual(h.state(), { text: "external edit", writes: 0, aborts: 0 });
});
test("identical external rewrite is accepted based on content", async () => {
  const h = handle("same");
  h.external("same");
  await writeIfUnchanged(h, "same", "new");
  assert.equal(h.state().text, "new");
});
test("writer failures are surfaced and abort attempted", async () => {
  const h = handle("before");
  h.fail();
  await assert.rejects(writeIfUnchanged(h, "before", "after"), /disk full/);
  assert.deepEqual(h.state(), { text: "before", writes: 0, aborts: 1 });
});
test("rejects missing baseline and invalid handles", async () => {
  const h = handle("old");
  await assert.rejects(writeIfUnchanged(h, null, "new"), TypeError);
  await assert.rejects(readSnapshot(null), TypeError);
  await assert.rejects(writeIfUnchanged({}, "old", "new"), TypeError);
});
test("rejects oversized source without touching writer", async () => {
  const h = handle("ok");
  await assert.rejects(writeIfUnchanged(h, "ok", "x".repeat(MAX_BYTES + 1)), RangeError);
  assert.equal(h.state().writes, 0);
});
test("rejects oversized disk files before reading", async () => {
  const h = { getFile: async () => ({ size: MAX_BYTES + 1, text: () => { throw new Error("should not read"); } }) };
  await assert.rejects(readSnapshot(h), RangeError);
});
