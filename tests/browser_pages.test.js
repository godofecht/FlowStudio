"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "docs/app/index.html"), "utf8");
const worker = fs.readFileSync(path.join(root, "docs/app/python-worker.js"), "utf8");
const home = fs.readFileSync(path.join(root, "docs/index.html"), "utf8");
test("Pages homepage links the actual browser workspace", () => {
  assert.match(home, /href="\.\/app\/"/);
  assert.match(home, /experimental R with webR/);
});
test("Browser workspace offers working local editor actions", () => {
  for (const id of ["source","language","console","environment","workspace","open","save","run","reset","file","previewfile"])
    assert.match(app, new RegExp('id="' + id + '"'));
  assert.match(app, /URL\.createObjectURL/);
  assert.match(app, /\$\("run"\)\.addEventListener\("click",/);
  assert.match(app, /\$\("runSelection"\)\.addEventListener\("click",/);
});
test("Python runs inside dedicated worker, not GitHub Pages server", () => {
  assert.match(app, /new Worker\("\.\/python-worker\.js"\)/);
  assert.match(worker, /importScripts\("https:\/\/cdn\.jsdelivr\.net\/pyodide\/v0\.27\.7\/full\/pyodide\.js"\)/);
  assert.match(worker, /_fs_environment_capture\.capture\(globals\(\)\)/);
  assert.match(worker, /prepareEnvironmentCapture\(py\)/);
  assert.match(worker, /validateEnvironmentSnapshot\(JSON\.parse\(raw\)\)/);
  assert.doesNotMatch(worker, /repr\(v\)/);
  assert.doesNotMatch(app, /fetch\("\/api\/execute/);
});
test("Static preview distinguishes native Flow from experimental browser R", () => {
  assert.match(app, /Flow \(native localhost only\)/);
  assert.match(app, /R \(browser; webR 0\.6\.0\)/);
  assert.match(app, /language !== "python" && language !== "r"/);
});
test("Submitted Python source is bounded; reset terminates worker", () => {
  const selection = fs.readFileSync(path.join(root, "docs/app/source_selection.js"), "utf8");
  assert.match(app, /FlowStudioSourceSelection\.prepare/);
  assert.match(selection, /MAX_SOURCE_BYTES = 65536/);
  assert.match(selection, /new TextEncoder\(\)\.encode\(code\)\.length > MAX_SOURCE_BYTES/);
  assert.match(worker, /new TextEncoder\(\)\.encode\(code\)\.length <= 65536/);
  assert.match(app, /worker\.terminate\(\)/);
});
test("All committed browser JavaScript parses in Node V8", () => {
  const inline = [...app.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x => x[1]).filter(x => x.trim());
  assert.match(app, /<script src="\.\/plot_history\.js"><\/script>/);
  assert.equal(inline.length, 1);
  new vm.Script(inline[0], {filename:"docs/app/index.html inline JS"});
  new vm.Script(worker, {filename:"docs/app/python-worker.js"});
});

test("Python worker queues asynchronous inspection behind execution", () => {
  assert.match(worker, /let serial = Promise\.resolve\(\)/);
  assert.match(worker, /serial = serial\.then\(\(\) => handle\(event\)\)/);
  assert.match(worker, /queued >= MAX_QUEUED/);
  assert.match(worker, /queued--/);
});
