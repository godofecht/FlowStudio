"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("Flow-owned editor route serves checked-in HTML without undefined string helper", () => {
  const main = read("src/main.flow");
  assert.doesNotMatch(main, /\bs_replace\s*\(/);
  assert.match(main, /fs_reply\(200, "text\/html; charset=utf-8", page\.data\)/);
  assert.match(main, /if eq\(method, "GET"\) and eq\(path, "\/"\)/);
});

test("both editor routes share the same source HTML", () => {
  const routes = read("src/data_routes.flow");
  assert.match(routes, /if url == "\/index\.html"/);
  assert.match(routes, /path: "web\/index\.html"/);
  assert.match(read("src/main.flow"), /io_read_text\("web\/index\.html"\)/);
});

test("integrated console scripts load once, after workspace tabs", () => {
  const html = read("web/index.html");
  const tags = ['<script src="/console.js"></script>',
    '<script src="/workspace_console.js"></script>'];
  const tabs = html.indexOf("FlowStudioWorkspaceTabs.mount();");
  assert.ok(tabs >= 0);
  for (const tag of tags) {
    assert.equal(html.split(tag).length - 1, 1, tag);
    assert.ok(html.indexOf(tag) > tabs, tag);
    assert.ok(html.indexOf(tag) < html.indexOf("</body>"), tag);
  }
  assert.ok(html.indexOf(tags[0]) < html.indexOf(tags[1]));
  const routes = read("src/data_routes.flow");
  assert.match(routes, /if url == "\/console\.js"/);
  assert.match(routes, /if url == "\/workspace_console\.js"/);
});

test("saved projects module loads before the panel glue and is routed", () => {
  const html = read("web/index.html");
  const tag = '<script src="/saved_projects.js"></script>';
  assert.equal(html.split(tag).length - 1, 1, tag);
  const index = html.indexOf(tag);
  assert.ok(index >= 0, tag);
  assert.ok(index < html.indexOf('<script src="/workspace_panels.js"></script>'), tag);
  const routes = read("src/data_routes.flow");
  assert.match(routes, /if url == "\/saved_projects\.js"/);
  assert.match(routes, /path: "web\/saved_projects\.js"/);
});

test("native project replacement has an explicit conflict-checked undo", () => {
  const html = read("web/index.html");
  assert.match(html, /id="undoProjectReplace"[^>]*disabled/);
  assert.match(html, /project\.undoReplace\(\{isBlocked: blocked\}\)/);
  assert.match(html, /entry\.handle\.isSameEntry\(doc\.handle\)/);
});
