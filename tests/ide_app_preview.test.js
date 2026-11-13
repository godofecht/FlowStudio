"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const preview = require("../web/ide_app_preview.js");

test("graphics programs are recognised by their gfx import or gfx_open", () => {
  assert.equal(preview.isGraphicsProgram('import "stdlib/gfx.flow"\nfunction main() -> i32 { return 0 }'), true);
  assert.equal(preview.isGraphicsProgram("let g = gfx_open(320, 200, \"x\")"), true);
  assert.equal(preview.isGraphicsProgram('# import "stdlib/gfx.flow" is only a comment\nfunction main() -> i32 { return 0 }'), false);
  assert.equal(preview.isGraphicsProgram("function main() -> i32 {\n    println(\"hi\")\n    return 0\n}"), false);
  assert.equal(preview.isGraphicsProgram(null), false);
});

test("build errors become line and column links", () => {
  const log = "/tmp/x/app.flow:4:21: error: No matching overload for function 'gfx_clear'\n" +
    "app.flow:9:2: Undefined name 'q'\nerror: emcc: undefined symbol flow_gfx_text\n";
  assert.deepEqual(preview.parseErrors(log), [
    { line: 4, column: 21, message: "No matching overload for function 'gfx_clear'" },
    { line: 9, column: 2, message: "Undefined name 'q'" }
  ]);
  assert.deepEqual(preview.parseErrors(undefined), []);
  assert.equal(preview.seconds(930), "0.9 s");
});

/* ---------- a small DOM for the panel ---------- */
class Node {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {};
    this.hidden = false; this.disabled = false; this.textContent = ""; this.listeners = {};
    this.classList = { set: new Set(), add: c => this.classList.set.add(c), remove: c => this.classList.set.delete(c),
      contains: c => this.classList.set.has(c) };
    this.contentWindow = { postMessage: () => {} };
  }
  set className(value) { for (const c of String(value).split(/\s+/).filter(Boolean)) this.classList.add(c); }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  replaceChildren(...nodes) { this.children = []; this.textContent = ""; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  click() { for (const fn of this.listeners.click || []) fn({}); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}
function setup(t, buildResults) {
  const ids = ["previewStage", "previewTitle", "previewStatus", "previewDot", "previewError", "previewEmpty",
    "previewHot", "previewRestart", "previewStop", "rpTab-preview", "previewNewApp"];
  const nodes = Object.fromEntries(ids.map(id => [id, new Node("div")]));
  nodes.previewHot.checked = true;
  nodes["rpTab-preview"].setAttribute("aria-selected", "true");
  const doc = { getElementById: id => nodes[id] || null, createElement: tag => new Node(tag) };
  const docs = new Map([["d1", { id: "d1", name: "app.flow", text: "v1" }]]);
  const app = { documents: { find: id => docs.get(id) || null }, activateDocument: () => true,
    revealPosition: (line, column) => { app.revealed = [line, column]; } };
  const layout = { shown: false, show() { this.shown = true; }, hide() { this.shown = false; },
    isVisible() { return this.shown; }, ensureSize() {} };
  const requests = [];
  const fetch = async (url, init) => {
    requests.push(init.body);
    const result = buildResults.shift() || { ok: true, build: requests.length, ms: 900, gfx: true, log: "" };
    return { status: result.ok ? 200 : 422, json: async () => result };
  };
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const controller = preview.mount(doc, { app, layout, fetch, onMessage: () => {}, origin: "x" });
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const advance = async ms => { for (let at = 0; at < ms; at += 50) { t.mock.timers.tick(50); await settle(); } };
  return { nodes, docs, app, layout, requests, controller, settle, advance,
    frames: () => nodes.previewStage.children.filter(n => n.tagName === "IFRAME") };
}

test("Run builds once and mounts the app frame in the side panel", async t => {
  const env = setup(t, []);
  env.controller.start(env.docs.get("d1"));
  await env.settle();
  assert.deepEqual(env.requests, ["v1"]);
  assert.equal(env.frames().length, 1);
  assert.equal(env.frames()[0].src, "/app-host.html#build=1");
  assert.equal(env.layout.shown, true, "the side panel opens for the preview");
  assert.equal(env.nodes.previewDot.dataset.state, "live");
  env.controller.dispose();
});

test("an edit rebuilds once after the typing pause, not on every keystroke", async t => {
  const env = setup(t, []);
  env.controller.start(env.docs.get("d1"));
  await env.settle();
  for (const text of ["v2", "v23", "v234"]) { env.docs.get("d1").text = text; await env.advance(150); }
  assert.equal(env.requests.length, 1, "no build while typing");
  await env.advance(900);
  assert.deepEqual(env.requests, ["v1", "v234"]);
  assert.match(env.nodes.previewStatus.textContent, /^Reloaded in /);
  env.controller.dispose();
});

test("a failed build keeps the running app; undoing the edit clears the error without a build", async t => {
  const env = setup(t, [{ ok: true, build: 1, ms: 900, gfx: true, log: "" },
    { ok: false, build: 2, ms: 50, gfx: false, log: "app.flow:3:5: error: bad call" }]);
  env.controller.start(env.docs.get("d1"));
  await env.settle();
  env.docs.get("d1").text = "broken";
  await env.advance(1000);
  assert.equal(env.requests.length, 2);
  assert.equal(env.nodes.previewError.hidden, false);
  assert.equal(env.frames().length, 1, "the last good build stays");
  assert.match(env.nodes.previewStatus.textContent, /last good build is still running/);
  env.nodes.previewError.children[0].click();
  assert.deepEqual(env.app.revealed, [3, 5], "the error links to its line");
  env.docs.get("d1").text = "v1";
  await env.advance(1000);
  assert.equal(env.requests.length, 2, "returning to the running source needs no build");
  assert.equal(env.nodes.previewError.hidden, true);
  env.controller.dispose();
});

test("stopping gives back the side panel the preview opened", async t => {
  const env = setup(t, []);
  env.controller.start(env.docs.get("d1"));
  await env.settle();
  env.controller.stop();
  assert.equal(env.layout.shown, false);
  assert.equal(env.frames().length, 0);
  env.controller.dispose();
});
