"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { create, exportTranscript, MAX_EXPORT_BYTES } =
  require("../web/terminal_sessions.js");

test("export preserves exact selected runtime/session, multiline commands and Unicode", () => {
  const sessions = create({ runtime: () => "python",
    clock: () => new Date("2026-10-28T12:34:56Z") });
  const python = sessions.active();
  sessions.recordCommand(python, "print('α')\nprint('β')");
  sessions.beginRun("python");
  sessions.append("python", "\x1b[31mαβ\x1b[0m\n", "out");
  sessions.append("flow", "flow-only secret\n", "out");
  const original = python.entries.map(entry => ({ ...entry }));
  const text = exportTranscript(python);
  assert.match(text, /Runtime: python\nSession: 1\nInterpreter: shared persistent python interpreter/);
  assert.match(text, /> print\('α'\)\nprint\('β'\)/);
  assert.match(text, /αβ/);
  assert.doesNotMatch(text, /\x1b|flow-only secret/);
  assert.deepEqual(python.entries, original, "export must not mutate session state");
});

test("export strips OSC and unsafe control bytes, preserving line breaks and tab", () => {
  const sessions = create({ runtime: () => "r" });
  const r = sessions.active();
  sessions.append("r", "hello\x1b]8;;https://bad.example\x07link\x1b]8;;\x07\tworld\x00\r\nnext\n", "out");
  const text = exportTranscript(r);
  assert.match(text, /hellolink\tworld\nnext/);
  assert.doesNotMatch(text, /\x1b|\x00|bad\.example/);
});

test("figure entries are honest placeholders; clear and new session isolate exports", () => {
  const sessions = create({ runtime: () => "r" });
  const first = sessions.active();
  sessions.append("r", "before\n", "out");
  sessions.append("r", "", "fig", { figIndex: 2, plot: { data: "private-image-data" } });
  const initial = exportTranscript(first);
  assert.match(initial, /Captured figure 2; image data is not included/);
  assert.doesNotMatch(initial, /private-image-data/);
  sessions.clearVisible(first);
  assert.doesNotMatch(exportTranscript(first), /before|Captured figure/);
  const second = sessions.createFor("r");
  sessions.append("r", "second only\n", "out");
  assert.match(exportTranscript(second), /Session: 2/);
  assert.match(exportTranscript(second), /second only/);
  assert.doesNotMatch(exportTranscript(first), /second only/);
});

test("oversized UTF-8 export fails rather than truncating or mutating output", () => {
  const sessions = create({ runtime: () => "python" });
  const session = sessions.active();
  sessions.append("python", "界".repeat(Math.ceil(MAX_EXPORT_BYTES / 3)), "out");
  assert.throws(() => exportTranscript(session), /2 MiB export limit/);
  assert.equal(session.entries.length, 1);
});

test("malformed session/entry metadata is rejected", () => {
  assert.throws(() => exportTranscript({ runtime: "javascript", ordinal: 1, entries: [] }),
    /Invalid terminal session/);
  assert.throws(() => exportTranscript({ runtime: "r", ordinal: 1,
    entries: [{ kind: "out", text: null }] }), /Invalid terminal entry/);
});
