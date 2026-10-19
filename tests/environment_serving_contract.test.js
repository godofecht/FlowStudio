"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("Flow allowlists both persistent environment scripts", () => {
  const routes = read("src/data_routes.flow");
  for (const name of ["environment.js", "workspace_environment.js"]) {
    assert.ok(routes.includes('if url == "/' + name + '"'));
    assert.ok(routes.includes('path: "web/' + name + '"'));
  }
  const paths = [...routes.matchAll(/path: "(web\/[^"]+)"/g)].map(m => m[1]);
  assert.equal(paths.length, 19);
  assert.equal(new Set(paths).size, paths.length);
  for (const file of paths) assert.ok(fs.existsSync(path.join(root, file)), file);
});

test("served editor loads inspector after interactive console exactly once", () => {
  const html = read("web/index.html");
  const tags = ["/console.js", "/workspace_console.js", "/environment.js", "/workspace_environment.js"];
  const positions = tags.map(name => {
    const tag = '<script src="' + name + '"></script>';
    assert.equal(html.split(tag).length - 1, 1, tag);
    return html.indexOf(tag);
  });
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.ok(positions[0] > html.indexOf("FlowStudioWorkspaceTabs.mount();"));
  assert.ok(positions[3] < html.indexOf("</body>"));
  assert.doesNotMatch(html, /Variable inspection and persistent language sessions are planned/);
});

test("editor and console refresh the executed runtime after completion", () => {
  const html = read("web/index.html");
  const consoleSource = read("web/workspace_console.js");
  assert.match(html, /const executionLanguage = language\.value;/);
  assert.ok(html.includes('fetch("/api/run/" + executionLanguage'));
  assert.ok(html.includes("environment.afterExecution(executionLanguage)"));
  assert.ok(consoleSource.includes("environment.afterExecution(name)"));
  assert.match(consoleSource, /response\.status === 200 \|\| response\.status === 422/);
});
