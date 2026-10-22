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
  assert.match(home, /Flow and R still require a native runtime/);
});
test("Browser workspace offers working local editor actions", () => {
  for (const id of ["source","language","console","environment","workspace","open","save","run","reset","file","previewfile"])
    assert.match(app, new RegExp('id="' + id + '"'));
  assert.match(app, /URL\.createObjectURL/);
  assert.match(app, /\.addEventListener\("click", run\)/);
});
test("Python runs inside dedicated worker, not GitHub Pages server", () => {
  assert.match(app, /new Worker\("\.\/python-worker\.js"\)/);
  assert.match(worker, /importScripts\("https:\/\/cdn\.jsdelivr\.net\/pyodide\/v0\.27\.7\/full\/pyodide\.js"\)/);
  assert.match(worker, /runPythonAsync\(code\)/);
  assert.doesNotMatch(app, /fetch\("\/api\/execute/);
});
test("Static preview clearly does not claim Flow or R execution", () => {
  assert.match(app, /Flow \(not yet browser executable\)/);
  assert.match(app, /R \(not yet browser executable\)/);
  assert.match(app, /value !== "python"/);
});
test("Submitted Python source is bounded; reset terminates worker", () => {
  assert.match(app, /length > 65536/);
  assert.match(worker, /length > 65536/);
  assert.match(app, /worker\.terminate\(\)/);
});
test("All committed browser JavaScript parses in Node V8", () => {
  const inline = [...app.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x => x[1]);
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
