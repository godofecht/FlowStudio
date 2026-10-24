"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const documents = require("../web/ide_documents.js");

test("opening documents keeps one active buffer and labels project paths", () => {
  const model = documents.createModel();
  const first = model.open({ name: "analysis.R", text: "x <- 1", language: "r" });
  assert.equal(first.created, true);
  assert.equal(model.active().id, first.document.id);
  assert.equal(documents.label(model.active()), "analysis.R");
  const second = model.open({ name: "run.py", path: "project/run.py", text: "x = 1", language: "python" });
  assert.equal(model.count(), 2);
  assert.equal(model.active().id, second.document.id);
  assert.equal(documents.label(model.active()), "project/run.py");
});

test("reopening the same handle or path activates the existing tab", () => {
  const model = documents.createModel();
  const handle = { name: "a.flow" };
  const opened = model.open({ name: "a.flow", text: "one", handle });
  const again = model.open({ name: "a.flow", text: "stale", handle });
  assert.equal(again.created, false);
  assert.equal(again.document.id, opened.document.id);
  assert.equal(model.count(), 1);
  const byPath = model.open({ name: "b.flow", path: "p/a.flow", text: "one" });
  const byPathAgain = model.open({ name: "b.flow", path: "p/a.flow", text: "two" });
  assert.equal(byPathAgain.created, false);
  assert.equal(byPathAgain.document.id, byPath.document.id);
  assert.equal(model.count(), 2);
});

test("dirty state follows edits against the last saved baseline", () => {
  const model = documents.createModel();
  const doc = model.open({ name: "a.flow", text: "start", baseline: "start" }).document;
  assert.equal(doc.dirty, false);
  model.setText(doc.id, "changed");
  assert.equal(model.active().dirty, true);
  model.setText(doc.id, "start");
  assert.equal(model.active().dirty, false);
  model.setText(doc.id, "changed");
  model.markSaved(doc.id);
  assert.equal(model.active().dirty, false);
  assert.equal(model.active().saved, "changed");
});

test("closing the active tab activates its neighbour and reports the new active id", () => {
  const model = documents.createModel();
  const a = model.open({ name: "a.flow", text: "" }).document;
  const b = model.open({ name: "b.flow", text: "" }).document;
  const c = model.open({ name: "c.flow", text: "" }).document;
  model.activate(b.id);
  const closed = model.close(b.id);
  assert.equal(closed.document.id, b.id);
  assert.equal(closed.activeId, c.id);
  assert.equal(model.active().id, c.id);
  model.close(c.id);
  assert.equal(model.active().id, a.id);
  assert.equal(model.close(a.id).activeId, null);
  assert.equal(model.count(), 0);
  assert.equal(model.active(), null);
});

test("closing an inactive tab leaves the active buffer selected", () => {
  const model = documents.createModel();
  const a = model.open({ name: "a.flow", text: "" }).document;
  const b = model.open({ name: "b.flow", text: "" }).document;
  assert.equal(model.active().id, b.id);
  const closed = model.close(a.id);
  assert.equal(closed.activeId, b.id);
  assert.equal(model.close("doc-missing"), null);
});

test("the document limit is enforced before state changes", () => {
  const model = documents.createModel({ limit: 2 });
  model.open({ name: "a.flow", text: "" });
  model.open({ name: "b.flow", text: "" });
  assert.throws(() => model.open({ name: "c.flow", text: "" }), /Close a document/);
  assert.equal(model.count(), 2);
  assert.equal(model.limit(), 2);
});

test("invalid documents and languages are rejected or normalized", () => {
  const model = documents.createModel();
  assert.throws(() => model.open({ name: "", text: "" }), TypeError);
  assert.throws(() => model.open({ name: "a.flow", text: 5 }), TypeError);
  assert.throws(() => model.open(null), TypeError);
  const doc = model.open({ name: "a.txt", text: "", language: "cobol" }).document;
  assert.equal(doc.language, "flow");
  model.setLanguage(doc.id, "python");
  assert.equal(model.active().language, "python");
  model.rename(doc.id, "renamed.py", "project/renamed.py");
  assert.equal(model.active().name, "renamed.py");
  assert.equal(documents.label(model.active()), "project/renamed.py");
});

test("the checked-in editor embeds a byte-identical copy of the model", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "web/index.html"), "utf8");
  const block = html.split("<!-- BEGIN EMBEDDED DOCUMENT MODEL")[1];
  assert.ok(block, "document model block is missing");
  const inner = block.split("<!-- END EMBEDDED DOCUMENT MODEL")[0];
  const source = inner.slice(inner.indexOf("<script>") + "<script>".length)
    .replace(/<\/script>\s*$/, "").trim();
  assert.equal(source, fs.readFileSync(path.join(__dirname, "..", "web/ide_documents.js"), "utf8").trim());
});
