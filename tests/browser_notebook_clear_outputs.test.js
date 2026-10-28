"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const {cellAt, parseCells} = require("../docs/app/source_cells.js");
const format = require("../docs/app/notebook_format.js");

const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
const found = html.match(/function clearNotebookOutputs\(onlyCaret = false\) \{[\s\S]*?\n\}\nasync function runNotebook/);
assert.ok(found, "actual browser clear-output implementation must exist");
const implementation = found[0].slice(0, -"\nasync function runNotebook".length);
const source = "# %% [python]\nprint(1)\n# %% [markdown]\n# Notes\n# %% [python]\nprint(2)\n";

function fixture(options = {}) {
  const messages = [], events = [], cards = [];
  function card(index, code) {
    const item = {dataset:code ? {notebookResult:"1", cellIndex:String(index)} : {},
      remove() { cards.splice(cards.indexOf(item), 1); }};
    cards.push(item);
  }
  card(0, true);
  card(1, false);
  card(2, true);
  const elements = {
    source:{value:options.stale ? "changed" : source,
      selectionStart:options.caret ?? source.indexOf("print(2)")},
    language:{value:options.language || "python"}
  };
  const ctx = {
    busy:options.busy || false,
    notebookRunner:options.running ? {isRunning:()=>true} : null,
    notebookEntries:[
      {index:0, kind:"code", language:"python", ok:true, output:"first", truncated:false, plots:[], images:[]},
      {index:2, kind:"code", language:"python", ok:true, output:"second", truncated:false, plots:[], images:[]}
    ],
    notebookExecutionSource:source,
    notebookExecutionLanguage:"python",
    notebookOutput:{children:cards},
    notebookRecoveryFailed:false,
    draftStorage:{},
    $:id=>elements[id],
    notice:message=>messages.push(message),
    FlowStudioSourceCells:{cellAt},
    FlowStudioNotebookRecovery:{
      save:(_storage, savedSource, language, entries)=>{
        events.push(["save", savedSource, language, entries.map(entry=>entry.index)]);
        return !options.saveFails;
      }
    },
    clearNotebookRecovery:()=>events.push(["clear"])
  };
  vm.createContext(ctx);
  vm.runInContext(implementation, ctx, {filename:"docs/app/index.html"});
  return {ctx, cards, events, messages, clear:onlyCaret=>
    vm.runInContext("clearNotebookOutputs(" + (onlyCaret ? "true" : "false") + ")", ctx)};
}

test("clear current cell removes only its output and persists remaining entries", () => {
  const f = fixture();
  f.clear(true);
  assert.deepEqual(Array.from(f.ctx.notebookEntries, entry=>entry.index), [0]);
  assert.deepEqual(f.cards.map(card=>card.dataset.cellIndex), ["0", undefined]);
  assert.deepEqual(f.events.map(event=>event[0]), ["clear", "save"]);
  assert.deepEqual(Array.from(f.events[1][3]), [0]);
  assert.match(f.messages.at(-1), /cell 3.*variables are unchanged/);
});

test("clear all outputs removes code result cards, keeps Markdown and clears recovery", () => {
  const f = fixture();
  f.clear(false);
  assert.equal(f.ctx.notebookEntries.length, 0);
  assert.equal(f.cards.length, 1);
  assert.equal(f.cards[0].dataset.notebookResult, undefined);
  assert.deepEqual(f.events.map(event=>event[0]), ["clear"]);
  assert.match(f.messages.at(-1), /all saved notebook outputs/);
});

test("Markdown caret, missing result, and stale source cannot discard outputs", () => {
  const markdown = fixture({caret:source.indexOf("Notes")});
  markdown.clear(true);
  assert.equal(markdown.ctx.notebookEntries.length, 2);
  assert.equal(markdown.events.length, 0);
  assert.match(markdown.messages.at(-1), /Markdown cells/);

  const missing = fixture();
  missing.ctx.notebookEntries = [{index:0, output:"first"}];
  missing.clear(true);
  assert.equal(missing.ctx.notebookEntries.length, 1);
  assert.equal(missing.events.length, 0);
  assert.match(missing.messages.at(-1), /no saved output/);

  const stale = fixture({stale:true});
  stale.clear();
  assert.equal(stale.ctx.notebookEntries.length, 2);
  assert.equal(stale.events.length, 0);
});

test("running execution blocks both clear actions without losing results", () => {
  for (const options of [{busy:true}, {running:true}]) {
    const f = fixture(options);
    f.clear();
    f.clear(true);
    assert.equal(f.ctx.notebookEntries.length, 2);
    assert.equal(f.cards.length, 3);
    assert.equal(f.events.length, 0);
    assert.match(f.messages.at(-1), /Wait for notebook execution/);
  }
});

test("failed recovery save reports loss of reload persistence without restoring deleted output", () => {
  const f = fixture({saveFails:true});
  f.clear(true);
  assert.deepEqual(Array.from(f.ctx.notebookEntries, entry=>entry.index), [0]);
  assert.equal(f.ctx.notebookRecoveryFailed, true);
  assert.match(f.messages.at(-1), /could not be saved for reload recovery/);
});

test("cleared snapshots are absent from real .ipynb and portable .fsnb exports", () => {
  const f = fixture();
  f.clear(true);
  const ipynb = JSON.parse(format.encode(source, "python", f.ctx.notebookEntries, parseCells));
  assert.deepEqual(ipynb.cells.filter(cell=>cell.cell_type === "code")
    .map(cell=>cell.outputs.length), [1, 0]);
  const portable = JSON.parse(format.encodeBundle(source, "python",
    f.ctx.notebookEntries, parseCells));
  assert.deepEqual(portable.results.map(entry=>entry.index), [0]);
  f.clear();
  const cleared = JSON.parse(format.encodeBundle(source, "python",
    f.ctx.notebookEntries, parseCells));
  assert.equal(cleared.results.length, 0);
});

test("actual browser controls are wired, guarded during execution, and bootstrap parses", () => {
  for (const id of ["clearNotebookCell", "clearNotebookAll"])
    assert.match(html, new RegExp('id="' + id + '"'));
  const busyControls = html.match(/function setBusy\\(value\\) \\{[\\s\\S]*?for \\(const id of \\[([^\\]]+)\\]\\)/);
  assert.ok(busyControls, "busy-state control list must exist");
  const guardedIds = JSON.parse("[" + busyControls[1] + "]");
  for (const id of ["clearNotebookCell", "clearNotebookAll", "renderQuarto"])
    assert.ok(guardedIds.includes(id), id + " must be disabled during execution");
  assert.match(html, /\$\("clearNotebookCell"\)\.addEventListener\("click", \(\) => clearNotebookOutputs\(true\)\)/);
  assert.match(html, /\$\("clearNotebookAll"\)\.addEventListener\("click", \(\) => clearNotebookOutputs\(\)\)/);
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script[1]));
});
