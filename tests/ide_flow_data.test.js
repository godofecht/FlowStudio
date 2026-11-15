"use strict";
/* The Flow data viewer (web/ide_flow_data.js) and the Environment buttons
 * that open it (web/ide_flow_session.js). */
const test = require("node:test");
const assert = require("node:assert/strict");
const data = require("../web/ide_flow_data.js");
const session = require("../web/ide_flow_session.js");

const REPLY = {
  ok: true, name: "pts", type: "array<Point, 3>", columns: ["x", "y", "label"], kinds: ["f64", "f64", "string"],
  rows: [["1.0", "2.0", "a"], ["3.5", "-1.0", "b"], ["0.5", "9.0", "c"]], total: 3, truncated: false, hiddenColumns: 0
};

test("tableDataset turns a view reply into grid rows of strings", () => {
  const dataset = data.tableDataset(REPLY);
  assert.deepEqual(dataset.columns, ["x", "y", "label"]);
  assert.deepEqual(dataset.rows[1], ["3.5", "-1.0", "b"]);
  assert.equal(dataset.total, 3);
  assert.equal(dataset.truncated, false);
  assert.equal(data.metaText(dataset), "Flow  array<Point, 3>  3 rows × 3 columns");
  assert.equal(data.noteText(dataset), "");
  // Short rows are padded and long rows cut to the column count.
  const ragged = data.tableDataset({ ...REPLY, rows: [["1"], ["1", "2", "3", "4"], [null, 2, true]] });
  assert.deepEqual(ragged.rows, [["1", "", ""], ["1", "2", "3"], ["", "2", "true"]]);
});

test("a truncated value says how many rows the grid holds", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => [String(i)]);
  const dataset = data.tableDataset({ ok: true, name: "big", type: "array<f32, 5000>", columns: ["value"],
    rows, total: 5000, truncated: true, hiddenColumns: 2 });
  assert.equal(dataset.truncated, true);
  assert.equal(data.metaText(dataset), "Flow  array<f32, 5000>  5,000 rows × 3 columns");
  assert.equal(data.noteText(dataset), "Showing the first 1,000 of 5,000 rows. 2 columns are not shown.");
});

test("errors from the server become Error values", () => {
  assert.match(data.tableDataset({ ok: false, error: "There is no Flow variable named q." }).message, /no Flow variable/);
  assert.ok(data.tableDataset(null) instanceof Error);
  assert.ok(data.tableDataset({ ok: true, columns: [], rows: [] }) instanceof Error);
});

test("open asks the view route with the run intent and fills the data grid", async () => {
  const calls = [];
  const shown = [];
  const statuses = [];
  const viewer = data.create({
    request: async (url, init) => { calls.push([url, init.method, init.headers["X-FlowStudio-Intent"], init.body]);
      return { status: 200, ok: true, text: async () => JSON.stringify(REPLY) }; },
    dataView: () => ({ showGrid: (dataset, label, meta) => shown.push([dataset, label, meta]), dialog: null }),
    status: (message, kind) => statuses.push([message, kind]), doc: null
  });
  assert.equal(await viewer.open("pts"), true);
  assert.deepEqual(calls, [["/api/flow/session/view", "POST", "run", "pts"]]);
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0][0].columns, ["x", "y", "label"]);
  assert.equal(shown[0][0].rows.length, 3);
  assert.equal(shown[0][1], "pts");
  assert.equal(shown[0][2], "Flow  array<Point, 3>  3 rows × 3 columns");
  assert.equal(statuses.at(-1)[1], "ok");
  // A name that is not an identifier never reaches the server.
  assert.equal(await viewer.open("a b"), false);
  assert.equal(calls.length, 1);
  assert.equal(statuses.at(-1)[1], "error");
});

function fakeDocument() {
  function node(tag) {
    return {
      tag, children: [], dataset: {}, className: "", textContent: "", title: "", listeners: {},
      classList: { items: [], add(name) { this.items.push(name); } },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; }
    };
  }
  return { createElement: node, createTextNode: text => ({ tag: "#text", textContent: text }) };
}

test("the Environment makes arrays and structs open the viewer", () => {
  const doc = fakeDocument();
  const container = doc.createElement("div");
  const opened = [];
  session.renderEnvironment(container, [
    { name: "pts", type: "array<Point, 3>", display: "[...]", kept: true, mutable: true, viewable: true },
    { name: "n", type: "i32", display: "3", kept: true }
  ], doc, { onView: name => opened.push(name) });
  const rows = container.children[0].children.slice(2);
  const button = rows[0].children[0].children[0];
  assert.equal(button.tag, "button");
  assert.equal(button.className, "flow-env-view");
  assert.equal(button.textContent, "pts");
  assert.equal(rows[0].children[0].children[1].textContent, " (mut)");
  button.listeners.click();
  assert.deepEqual(opened, ["pts"]);
  // A scalar stays plain text.
  assert.equal(rows[1].children[0].children.length, 0);
  assert.equal(rows[1].children[0].textContent, "n");
});
