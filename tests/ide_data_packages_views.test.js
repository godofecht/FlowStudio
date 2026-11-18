"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const data = require("../web/ide_data_view.js");
const packages = require("../web/ide_packages_view.js");

test("session frames keep only data frames, with their shape", () => {
  const r = data.sessionFrames({ variables: [
    { name: "iris_df", type: "data.frame", dimensions: [150, 5] },
    { name: "v", type: "integer", size: 5, dimensions: null },
    { name: "cars", type: "data.frame", dimensions: [32, 11] }
  ] }, "r");
  assert.deepEqual(r.map(f => [f.name, f.rows, f.cols]), [["cars", 32, 11], ["iris_df", 150, 5]]);
  const py = data.sessionFrames({ variables: [
    { name: "pdf", type: "DataFrame", dimensions: [2, 3] }, { name: "xs", type: "list", size: 3 }] }, "python");
  assert.deepEqual(py.map(f => f.name), ["pdf"]);
  assert.deepEqual(data.sessionFrames(null, "r"), []);
});

test("tabular files are the CSV, TSV and TAB files of the folder index", () => {
  const files = data.tabularFiles([{ name: "a.csv" }, { name: "b.TSV" }, { name: "c.flow" }, { name: "d.tab" }]);
  assert.deepEqual(files.map(f => f.name), ["a.csv", "b.TSV", "d.tab"]);
});

test("the Python table snippet accepts identifiers only and parses its marked line", () => {
  assert.throws(() => data.pythonTableCode("df; import os"), /identifier/);
  const code = data.pythonTableCode("sales_2024");
  assert.match(code, /\(__import__\('json'\), sales_2024\)\)$/);
  const output = "noise\n" + data.TABLE_MARK + JSON.stringify({ columns: ["a", 1], rows: [[1, "x"]], total: 9 }) + "\n";
  assert.deepEqual(data.parsePythonTable(output), { columns: ["a", "1"], rows: [["1", "x"]], total: 9 });
  assert.equal(data.parsePythonTable("Traceback ..."), null);
});

test("column kinds treat NA and blanks as missing numbers", () => {
  assert.deepEqual(data.columnKinds({ columns: ["n", "s", "e"],
    rows: [["1.5", "a", ""], ["NA", "b", ""], ["-2e3", "3", ""]] }), ["number", "text", "text"]);
});

test("package filtering ranks prefixes first and offers to install unknown names", () => {
  const list = [{ name: "statmod" }, { name: "stats" }, { name: "rstatix" }, { name: "numpy" }];
  const found = packages.filterPackages(list, "stat");
  assert.deepEqual(found.rows.map(p => p.name), ["statmod", "stats", "rstatix"]);
  assert.equal(found.offer, "stat");
  assert.equal(packages.filterPackages(list, "stats").offer, null);
  assert.equal(packages.filterPackages(list, "numpy==2.1.0").offer, "numpy==2.1.0");   // pinning reinstalls
  assert.equal(packages.filterPackages(list, "").rows.length, 4);
});

test("Python uninstall code embeds a validated name and fails loudly", () => {
  const code = packages.pythonUninstallCode("requests");
  assert.match(code, /'uninstall', '-y', 'requests'/);
  assert.match(code, /raise RuntimeError/);
});
