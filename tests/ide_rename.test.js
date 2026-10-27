"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const symbols = require("../web/ide_symbols.js");
const documents = require("../web/ide_documents.js");

function model(specs) {
  const state = documents.createModel();
  for (const spec of specs) state.open(spec);
  return state;
}

test("Flow lexical rename preserves comments, strings, members and partial identifiers", () => {
  const source = 'function calc() -> i32 {\n  calc() # calc\n  println("calc")\n  object.calc()\n  calculate()\n  return calc()\n}';
  const docs = model([{name:"a.flow",text:source,language:"flow"}]);
  const plan = symbols.planOpenRename("flow", docs.list(), "calc", "total", docs.active().id);
  assert.equal(plan.count, 3);
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].after,
    'function total() -> i32 {\n  total() # calc\n  println("calc")\n  object.calc()\n  calculate()\n  return total()\n}');
  assert.deepEqual(symbols.applyOpenRename(docs, plan), {documents:1,references:3});
  assert.equal(docs.active().dirty, true);
  assert.equal(docs.active().saved, source);
});

test("R dotted names are renamed without touching $ members, @ slots, or quoted text", () => {
  const source = 'foo.bar <- 1\nfoo.bar + foo.bar\nx$foo.bar\nx@foo.bar\n"foo.bar"\n# foo.bar';
  const docs = model([{name:"a.R",text:source,language:"r"}]);
  const plan = symbols.planOpenRename("r", docs.list(), "foo.bar", "total.value", docs.active().id);
  assert.equal(plan.count, 3);
  symbols.applyOpenRename(docs, plan);
  assert.equal(docs.active().text,
    'total.value <- 1\ntotal.value + total.value\nx$foo.bar\nx@foo.bar\n"foo.bar"\n# foo.bar');
});

test("Python triple strings and member attributes are excluded", () => {
  const source = "def task():\n    '''task\n    task'''\n    obj.task()\n    task()\n    # task";
  const docs = model([{name:"a.py",text:source,language:"python"}]);
  const plan = symbols.planOpenRename("python", docs.list(), "task", "run_task", docs.active().id);
  assert.equal(plan.count, 2);
  assert.match(plan.entries[0].after, /def run_task\(\)/);
  assert.match(plan.entries[0].after, /    run_task\(\)/);
  assert.match(plan.entries[0].after, /obj\.task\(\)/);
});

test("spaced member and namespace access cannot be renamed as free references", () => {
  const r = "foo.bar <- 1\nx $ foo.bar\nx @ foo.bar\npkg :: foo.bar\nfoo.bar";
  const python = "def task():\n    obj . task()\n    task()";
  assert.equal(symbols.findReferences("r",r,"foo.bar").matches.length,2);
  assert.equal(symbols.findReferences("python",python,"task").matches.length,2);
  assert.equal(symbols.identifierAt("python","obj . task",7),null);
  assert.equal(symbols.identifierAt("r","x $ foo.bar",6),null);
});

test("scope defaults to the active tab and never crosses languages", () => {
  const docs = model([
    {name:"a.py",text:"value = 1",language:"python"},
    {name:"b.py",text:"value += 1",language:"python"},
    {name:"c.R",text:"value <- 1",language:"r"}
  ]);
  const currentId = docs.list()[0].id;
  const local = symbols.planOpenRename("python", docs.list(), "value", "counter", currentId);
  assert.equal(local.count, 1);
  assert.equal(local.entries.length, 1);
  const all = symbols.planOpenRename("python", docs.list(), "value", "counter", currentId, true);
  assert.equal(all.count, 2);
  assert.equal(all.entries.length, 2);
  symbols.applyOpenRename(docs, all);
  assert.equal(docs.list()[0].text, "counter = 1");
  assert.equal(docs.list()[1].text, "counter += 1");
  assert.equal(docs.list()[2].text, "value <- 1");
});

test("reject keywords, invalid names, no-ops, collisions and missing references", () => {
  const docs = model([{name:"a.py",text:"value = 1\nother = value",language:"python"}]);
  const args = ["python", docs.list(), "value"];
  const id = docs.active().id;
  assert.throws(() => symbols.planOpenRename(...args,"for",id), /non-keyword/);
  assert.throws(() => symbols.planOpenRename(...args,"two words",id), /non-keyword/);
  assert.throws(() => symbols.planOpenRename(...args,"value",id), /differ/);
  assert.throws(() => symbols.planOpenRename(...args,"other",id), /already occurs/);
  assert.throws(() => symbols.planOpenRename("python",docs.list(),"missing","next_value",id), /No lexical references/);
  assert.equal(docs.active().dirty, false);
});

test("reject truncated rename and oversized output before any edits", () => {
  const docs = model([{name:"a.flow",text:"x ".repeat(201),language:"flow"}]);
  assert.throws(() => symbols.planOpenRename("flow",docs.list(),"x","longer",docs.active().id), /200/);
  assert.equal(docs.active().dirty, false);
  const large = model([{name:"big.flow",text:"x".padEnd(symbols.MAX_SOURCE," "),language:"flow"}]);
  assert.throws(() => symbols.planOpenRename("flow",large.list(),"x","expanded",large.active().id), /2 MiB/);
});

test("reject stale previews atomically across all tabs", () => {
  const docs = model([
    {name:"a.py",text:"value = 1",language:"python"},
    {name:"b.py",text:"print(value)",language:"python"}
  ]);
  const plan = symbols.planOpenRename("python",docs.list(),"value","total",docs.list()[0].id,true);
  docs.setText(docs.list()[1].id,"print(value + 1)");
  assert.throws(() => symbols.applyOpenRename(docs,plan), /changed after rename preview/);
  assert.equal(docs.list()[0].text,"value = 1");
  assert.equal(docs.list()[1].text,"print(value + 1)");
});

test("failed second-buffer mutation rolls back the first buffer", () => {
  const docs = model([
    {name:"a.py",text:"value = 1",language:"python"},
    {name:"b.py",text:"print(value)",language:"python"}
  ]);
  const plan = symbols.planOpenRename("python",docs.list(),"value","total",docs.list()[0].id,true);
  const fail = {
    find: id => docs.find(id),
    setText: (id, text) => id === docs.list()[1].id ? false : docs.setText(id,text)
  };
  assert.throws(() => symbols.applyOpenRename(fail,plan), /Could not update/);
  assert.equal(docs.list()[0].text,"value = 1");
  assert.equal(docs.list()[1].text,"print(value)");
});

test("native editor F2 exposes explicit preview, guarded apply, and unsaved state", () => {
  const html = fs.readFileSync(path.join(__dirname,"..","web","index.html"),"utf8");
  assert.match(html,/data-command="renameSymbol"/);
  assert.match(html,/event\.key === "F2" && event\.target === src/);
  assert.match(html,/id="renamePanel"/);
  assert.match(html,/id="renameAllOpen"/);
  assert.match(html,/id="renameApply"[^>]*disabled/);
  assert.match(html,/FlowStudioSymbols\.planOpenRename/);
  assert.match(html,/FlowStudioSymbols\.applyOpenRename/);
  assert.match(html,/loadDocumentIntoEditor\(activeDocument\(\)\)/);
  assert.match(html,/Save changed tabs explicitly/);
  assert.doesNotMatch(html,/document\.write\(/);
});
