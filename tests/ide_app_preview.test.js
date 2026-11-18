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
  dispatch(name, event = {}) { for (const fn of this.listeners[name] || []) fn(event); }
  click() { this.dispatch("click"); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}
function memoryStorage() {
  const data = new Map();
  return { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)) };
}
/* buildResults: each entry answers one POST. An entry with a `steps` array
 * answers the POST with steps[0] and each status poll with the next step. */
function setup(t, buildResults, extra = {}) {
  const ids = ["previewStage", "previewTitle", "previewStatus", "previewDot", "previewError", "previewEmpty",
    "previewHot", "previewRestart", "previewStop", "rpTab-preview", "previewNewApp"];
  const nodes = Object.fromEntries(ids.map(id => [id, new Node("div")]));
  nodes.previewHot.checked = true;
  nodes["rpTab-preview"].setAttribute("aria-selected", "true");
  const splitter = new Node("div");
  const docListeners = {};
  const doc = { getElementById: id => nodes[id] || null, createElement: tag => new Node(tag),
    querySelector: selector => (selector === '[data-splitter][data-panel="right"]' ? splitter : null),
    addEventListener: (name, fn) => { (docListeners[name] ||= []).push(fn); },
    dispatch: (name, event = {}) => { for (const fn of docListeners[name] || []) fn(event); },
    activeElement: null };
  const docs = new Map([["d1", { id: "d1", name: "app.flow", text: "v1" }]]);
  const app = { documents: { find: id => docs.get(id) || null, active: () => docs.get("d1") }, activateDocument: () => true,
    revealPosition: (line, column) => { app.revealed = [line, column]; } };
  const layout = { shown: false, right: 440, grows: [],
    show() { this.shown = true; }, hide() { this.shown = false; }, isVisible() { return this.shown; },
    ensureSize(panel, width) { this.grows.push(width); if (this.right < width) this.right = width; },
    setPanel(panel, width) { this.right = width; }, layout() { return { right: this.right }; } };
  const requests = [];
  const statusPolls = [];
  let steps = null;
  const fetch = async (url, init) => {
    if (!init) {
      statusPolls.push(url);
      const result = steps && steps.length ? steps.shift() : { ok: false, log: "no such build" };
      return { status: 200, json: async () => result };
    }
    requests.push(init.body);
    const entry = buildResults.shift() || { ok: true, build: requests.length, ms: 900, gfx: true, log: "" };
    if (entry.steps) { steps = entry.steps.slice(1); return { status: 202, json: async () => entry.steps[0] }; }
    return { status: entry.ok ? 200 : 422, json: async () => entry };
  };
  if (!extra.timersOn) t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  let onMessage = null;
  const controller = preview.mount(doc, { app, layout, fetch, onMessage: fn => { onMessage = fn; }, origin: "x",
    storage: extra.storage || memoryStorage(), projects: { current: () => ({ name: "demo" }) } });
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const advance = async ms => { for (let at = 0; at < ms; at += 50) { t.mock.timers.tick(50); await settle(); } };
  const frames = () => nodes.previewStage.children.filter(n => n.tagName === "IFRAME");
  /* The newest frame reports that the app opened its canvas. */
  const started = (width = 480, height = 360) => {
    const list = frames();
    const frame = list[list.length - 1];
    onMessage({ origin: "x", source: frame.contentWindow,
      data: { source: "flowstudio-app", event: "start", detail: { width, height } } });
  };
  const progressCard = () => nodes.previewStage.children.find(n => n.attributes.role === "status") || null;
  return { nodes, docs, app, layout, requests, statusPolls, controller, settle, advance, frames, started, doc,
    splitter, progressCard };
}

test("Run builds once and mounts the app frame in the side panel", async t => {
  const env = setup(t, []);
  env.controller.start(env.docs.get("d1"));
  await env.settle();
  assert.deepEqual(env.requests, ["v1"]);
  assert.equal(env.frames().length, 1);
  assert.equal(env.frames()[0].src, "/app-host.html#build=1");
  assert.equal(env.layout.shown, true, "the side panel opens for the preview");
  env.started();
  assert.equal(env.nodes.previewDot.dataset.state, "live");
  assert.match(env.nodes.previewStatus.textContent, /^Built in /);
  env.controller.dispose();
});

test("an edit rebuilds once after the typing pause, not on every keystroke", async t => {
  const env = setup(t, []);
  env.controller.start(env.docs.get("d1"));
  await env.settle();
  env.started();
  for (const text of ["v2", "v23", "v234"]) { env.docs.get("d1").text = text; await env.advance(150); }
  assert.equal(env.requests.length, 1, "no build while typing");
  await env.advance(900);
  assert.deepEqual(env.requests, ["v1", "v234"]);
  env.started();
  assert.match(env.nodes.previewStatus.textContent, /^Reloaded in /);
  env.controller.dispose();
});

test("a failed build keeps the running app; undoing the edit clears the error without a build", async t => {
  const env = setup(t, [{ ok: true, build: 1, ms: 900, gfx: true, log: "" },
    { ok: false, build: 2, ms: 50, gfx: false, log: "app.flow:3:5: error: bad call" }]);
  env.controller.start(env.docs.get("d1"));
  await env.settle();
  env.started();
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

test("a build shows each stage with the time so far, and says why the first build is slow", async t => {
  const env = setup(t, [{ steps: [
    { state: "check", build: 1, elapsed: 0, cold: true },
    { state: "check", build: 1, elapsed: 150, cold: true },
    { state: "wasm", build: 1, elapsed: 300, cold: true },
    { state: "wasm", build: 1, elapsed: 450, cold: true },
    { ok: true, state: "done", build: 1, ms: 600, gfx: true, cold: true, log: "" }
  ] }]);
  env.controller.start(env.docs.get("d1"));
  await env.settle();
  const card = env.progressCard();
  assert.ok(card, "a progress card replaces the empty Preview");
  assert.equal(card.hidden, false);
  assert.equal(env.nodes.previewEmpty.hidden, true, "the placeholder does not show while building");
  assert.equal(card.dataset.stage, "check");
  assert.match(env.nodes.previewStatus.textContent, /^Checking Flow  0\.0 s$/);
  assert.equal(card.parts.note.hidden, false, "the first build explains itself");
  assert.equal(card.parts.note.textContent, preview.COLD_NOTE);
  await env.advance(300);
  assert.equal(card.dataset.stage, "wasm");
  assert.match(env.nodes.previewStatus.textContent, /^Building WebAssembly  0\.[2-4] s$/);
  const rows = card.parts.list.children.map(row => row.dataset.state);
  assert.deepEqual(rows, ["done", "active", "waiting"]);
  await env.advance(400);
  assert.ok(env.statusPolls.every(url => url === "/flowapp/1/status"), "it follows the build it started");
  assert.equal(env.frames().length, 1);
  assert.equal(card.dataset.stage, "load");
  assert.match(env.nodes.previewStatus.textContent, /^Starting the app /);
  assert.equal(card.hidden, false, "the card stays until the app has drawn");
  env.started();
  assert.equal(card.hidden, true);
  assert.equal(env.nodes.previewDot.dataset.state, "live");
  assert.match(env.nodes.previewStatus.textContent, /^Built in 0\.[6-9] s$/);
  env.controller.dispose();
});

test("saving rebuilds at once, and a rebuild keeps the running app until the new one draws", async t => {
  const env = setup(t, []);
  env.controller.start(env.docs.get("d1"));
  await env.settle();
  env.started();
  env.docs.get("d1").text = "v2";
  env.doc.dispatch("flowstudio:saved", { detail: { id: "d1" } });
  await env.advance(50);
  assert.deepEqual(env.requests, ["v1", "v2"], "the save built without waiting for the typing pause");
  assert.equal(env.frames().length, 2, "the old frame stays while the new one loads");
  assert.equal(env.frames()[0].classList.contains("pv-loading"), false);
  env.started();
  assert.equal(env.frames().length, 1);
  assert.equal(env.frames()[0].src, "/app-host.html#build=2");
  assert.match(env.nodes.previewStatus.textContent, /^Reloaded in /);
  // Saving again without a change does not rebuild.
  env.doc.dispatch("flowstudio:saved", { detail: { id: "d1" } });
  await env.advance(600);
  assert.equal(env.requests.length, 2);
  env.controller.dispose();
});

test("saving a graphics program starts the Preview when no app runs", async t => {
  const env = setup(t, []);
  env.docs.get("d1").text = 'import "stdlib/gfx.flow"\nfunction main() -> i32 {\n    return 0\n}\n';
  env.doc.dispatch("flowstudio:saved", { detail: { id: "d1" } });
  await env.settle();
  assert.equal(env.controller.running(), true);
  assert.equal(env.requests.length, 1);
  assert.equal(env.frames().length, 1);
  env.controller.dispose();
});

test("a rebuild keeps the panel width the person chose, and the project remembers it", async t => {
  const storage = memoryStorage();
  const env = setup(t, [], { storage });
  env.controller.start(env.docs.get("d1"));
  await env.settle();
  env.started(640, 480);
  assert.deepEqual(env.layout.grows, [605], "the first run fits the panel to the app once");
  // The person drags the splitter to make the panel narrower.
  env.splitter.dispatch("pointerdown");
  env.layout.right = 300;
  env.doc.dispatch("pointerup");
  env.docs.get("d1").text = "v2";
  await env.advance(900);
  env.started(640, 480);
  assert.equal(env.frames().length, 1);
  assert.deepEqual(env.layout.grows, [605], "a rebuild does not resize the panel");
  assert.equal(env.layout.right, 300);
  env.controller.dispose();
  // Reopening the project later restores that width.
  const again = setup(t, [], { storage, timersOn: true });
  again.layout.right = 520;
  again.controller.start(again.docs.get("d1"));
  await again.settle();
  again.started(640, 480);
  assert.equal(again.layout.right, 300);
  assert.deepEqual(again.layout.grows, []);
  again.controller.dispose();
});

test("saving the running source after a broken edit clears the error without a build", async t => {
  const env = setup(t, [{ ok: true, build: 1, ms: 900, gfx: true, log: "" },
    { ok: false, build: 2, ms: 50, gfx: false, log: "app.flow:3:5: error: bad call" }]);
  env.controller.start(env.docs.get("d1"));
  await env.settle();
  env.started();
  env.docs.get("d1").text = "broken";
  env.doc.dispatch("flowstudio:saved", { detail: { id: "d1" } });
  await env.advance(50);
  assert.equal(env.nodes.previewError.hidden, false);
  env.docs.get("d1").text = "v1";
  env.doc.dispatch("flowstudio:saved", { detail: { id: "d1" } });
  await env.advance(1000);
  assert.equal(env.requests.length, 2);
  assert.equal(env.nodes.previewError.hidden, true, "the error goes once the source matches the running app");
  assert.equal(env.nodes.previewDot.dataset.state, "live");
  env.controller.dispose();
});
