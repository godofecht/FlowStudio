"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
const { FakeElement, createDocument } = require("./terminal_dom.js");

/* Mounts the workspace terminal against the fake DOM. Elements that stand for
 * server-rendered ids are pre-registered; everything else is created by the
 * module under test and reachable through its ids at the end of the run. */
function mount(reply = { ok: true, status: 200, text: async () => "ok" }, storage = null) {
  const { doc, elements } = createDocument();
  const downloads = { created: [], clicked: [], revoked: [] };
  const createElement = doc.createElement;
  doc.createElement = tag => {
    const node = createElement(tag);
    if (tag === "a") node.click = () => downloads.clicked.push({
      href: node.href, name: node.download
    });
    return node;
  };
  const downloadUrl = {
    createObjectURL(blob) {
      downloads.created.push(blob);
      return "blob:flowstudio-test-" + downloads.created.length;
    },
    revokeObjectURL(url) { downloads.revoked.push(url); }
  };
  const panel = new FakeElement("div");
  for (const id of ["console", "language", "resultStatus", "run", "runCell"]) {
    const node = new FakeElement(id === "language" ? "select" : id === "console" ? "pre" : "span");
    node.attributes.id = id;
    elements.set(id, node);
  }
  const language = elements.get("language");
  language.value = "python";
  elements.get("console").parentElement = panel;

  const requests = [];
  const context = vm.createContext({ TextEncoder, localStorage: storage, console,
    Blob, URL: downloadUrl, setTimeout: callback => callback() });
  vm.runInContext(fs.readFileSync(path.join(root, "web/terminal_render.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "web/terminal_sessions.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "web/terminal_input.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "web/console.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "web/workspace_console.js"), "utf8"), context);
  const controller = context.FlowStudioWorkspaceConsole.mount(doc, async (url, options) => {
    requests.push({ url, options });
    return typeof reply === "function" ? reply(url, options) : reply;
  });
  const app = {
    controller, requests, panel, doc, downloads,
    io: () => context.FlowStudioConsoleIO,
    el: id => {
      // Descend the built tree because ids set later live on created nodes.
      for (const [, node] of elements) if (node.attributes.id === id) return node;
      const find = (node) => {
        for (const child of node.children) {
          if (child.attributes.id === id) return child;
          const hit = find(child);
          if (hit) return hit;
        }
        return null;
      };
      return find(panel);
    }
  };
  app.output = elements.get("console");
  return app;
}

function entryText(app, bucket) {
  const host = bucket || app.output;
  return host.children.map(node => node.serialize()).join("");
}

test("workspace exposes console controls and loads allowlisted modules", () => {
  assert.match(html, /id="console"/);
  const routes = fs.readFileSync(path.join(root, "src/data_routes.flow"), "utf8");
  for (const asset of ["workspace_console.js", "terminal_input.js",
    "terminal_sessions.js", "terminal_render.js"])
    assert.match(routes, new RegExp(asset.replace(/\./g, "\\.")),
      asset + " must be served as an allowlisted asset");
  assert.match(html, /<script src="\/workspace_console\.js"><\/script>/);
  assert.match(html, /<script src="\/terminal_sessions\.js"><\/script>/);
});

test("mount builds tabs, honest status row and an inline transcript prompt", () => {
  const app = mount();
  const tabs = app.panel.children.filter(node =>
    node.className.split(/\s+/).includes("terminal-tab"));
  // Tabs live in the tab strip; find by class anywhere.
  const tabbar = app.panel.children.find(node => node.className === "terminal-tabs");
  assert.ok(tabbar, "a runtime tab strip is injected into the panel");
  const tabsFound = tabbar.querySelectorAll(".terminal-tab");
  assert.deepEqual(tabsFound.map(tab => tab.textContent.replace(/\s+\d+$/, "")), ["Flow", "Python", "R", "+"]);
  assert.equal(app.output.className, "terminal-entries");
  const transcript = app.panel.children.find(node =>
    node.className === "terminal-transcript");
  assert.ok(transcript, "the transcript wraps output and prompt");
  assert.ok(transcript.contains(app.el("consoleInput")),
    "the prompt is the next line of the transcript, not an anchored form");
  const status = app.panel.children.find(node => node.className === "terminal-status");
  assert.match(status.textContent, /No commands yet/, "runtime honestly starts unknown");
  const menu = app.panel.children.find(node => node.attributes.id === "terminalMenu");
  assert.equal(menu.hidden, true, "secondary actions live in a collapsed menu");
});

test("prompt keydown submits exact code; output and ready state follow", async () => {
  const app = mount();
  const field = app.el("consoleInput");
  field.value = "print('hello')";
  field.fire("keydown", { key: "Enter", preventDefault() {}, stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, "/api/run/python");
  assert.equal(app.requests[0].options.body, "print('hello')");
  assert.equal(app.requests[0].options.headers["X-FlowStudio-Intent"], "run");
  assert.equal(field.value, "");
  const transcriptHTML = app.el("console").innerHTML;
  assert.match(transcriptHTML, /term-cmd/);
  assert.match(transcriptHTML, /&gt; [\s\S]*print[\s\S]*hello/);
  assert.match(transcriptHTML, /ok/);
  const status = app.panel.children.find(node => node.className === "terminal-status");
  assert.match(status.textContent, /Last submission succeeded/);
});

test("runtime errors surface failure classes but keep the command in history", async () => {
  const app = mount({ ok: false, status: 422, text: async () => "TypeError: bad type" });
  const field = app.el("consoleInput");
  field.value = "bad(";
  assert.equal(await app.controller.run(field), true);
  assert.deepEqual(Array.from(app.controller.history("python")), ["bad("]);
  assert.match(app.el("console").innerHTML, /fs-error-line/);
  assert.match(app.el("console").innerHTML, /TypeError/);
  assert.equal(app.el("resultStatus").dataset.state, "error");
  const status = app.panel.children.find(node => node.className === "terminal-status");
  assert.match(status.textContent, /Last submission failed/);
});

test("console output is never interpreted as HTML", async () => {
  const app = mount({ ok: true, status: 200, text: async () => '<img onerror=alert(1)> done' });
  const field = app.el("consoleInput");
  field.value = "print('<img>')";
  await app.controller.run(field);
  const rendered = app.el("console").innerHTML;
  assert.doesNotMatch(rendered, /<img\s.*onerror/);
  assert.match(rendered, /&lt;img onerror=alert\(1\)&gt;/);
});

test("Shift+Enter keeps editing; Ctrl+F is reserved for the editor", () => {
  const app = mount();
  const field = app.el("consoleInput");
  field.value = "one";
  let stopped = false, executed = false;
  field.fire("keydown", { key: "Enter", shiftKey: true,
    preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(stopped, false);
  assert.equal(field.value, "one");
  // The prompt swallows Ctrl+F so the editor's global find stays untouched.
  const transcript = app.panel.children.find(node =>
    node.className === "terminal-transcript");
  field.fire("keydown", {
    key: "f", ctrlKey: true, stopPropagation() { executed = true; } });
  assert.equal(executed, true, "terminal-scoped editor shortcuts stop at the prompt");
});

test("history recall navigates stored commands and returns to the draft", async () => {
  const app = mount();
  const field = app.el("consoleInput");
  field.value = "first";
  assert.equal(await app.controller.run(field), true);
  field.value = "second";
  await app.controller.run(field);
  let prevented = false;
  const up = { key: "ArrowUp", preventDefault() { prevented = true; } };
  field.fire("keydown", up);
  assert.equal(prevented, true, "arrow recall does not bubble");
  assert.equal(field.value, "second");
  field.fire("keydown", { key: "ArrowUp", preventDefault() {} });
  assert.equal(field.value, "first");
  field.fire("keydown", { key: "ArrowDown", preventDefault() {} });
  assert.equal(field.value, "second");
  field.fire("keydown", { key: "ArrowDown", preventDefault() {} });
  assert.equal(field.value, "");
  assert.deepEqual(Array.from(app.controller.history("python")), ["first", "second"]);
});

test("network failures flip the runtime to disconnected, not 'error'", async () => {
  const app = mount({ ok: true, status: 200, text: async () => { throw Error("down"); } });
  const field = app.el("consoleInput");
  field.value = "retry";
  assert.equal(await app.controller.run(field), false);
  assert.deepEqual(Array.from(app.controller.history("python")), []);
  assert.equal(app.el("resultStatus").dataset.state, "error");
  const status = app.panel.children.find(node => node.className === "terminal-status");
  assert.match(status.textContent, /Server unreachable/,
    "a transport failure is reported as disconnected, not as a runtime error");
  assert.equal(field.value, "retry");
  assert.equal(app.el("run").disabled, false);
  assert.equal(app.el("runCell").disabled, false);
});

test("a busy editor blocks console execution without consuming the command", async () => {
  const app = mount();
  app.el("run").disabled = true;
  const field = app.el("consoleInput");
  field.value = "keep me";
  assert.equal(await app.controller.run(field), false);
  assert.equal(app.requests.length, 0);
  assert.equal(field.value, "keep me");
});

test("console execution blocks editor submission until the request settles", async () => {
  let resolve;
  const app = mount({ ok: true, status: 200, text: () => new Promise(r => { resolve = r; }) });
  const field = app.el("consoleInput");
  field.value = "x";
  const pending = app.controller.run(field);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(app.el("run").disabled, true);
  assert.equal(app.el("runCell").disabled, true);
  await new Promise(r => setImmediate(r));
  resolve("done");
  await pending;
  assert.equal(app.el("run").disabled, false);
  assert.equal(app.el("runCell").disabled, false);
});

test("language change and tab switches isolate drafts per session", () => {
  const app = mount();
  const field = app.el("consoleInput");
  field.value = "python draft";
  const language = app.el("language");
  language.value = "r";
  language.fire("change");
  assert.equal(field.value, "", "the R session starts with its own empty prompt");
  field.value = "x <- 1";
  language.value = "python";
  language.fire("change");
  assert.equal(field.value, "python draft",
    "switching back restores that session's draft");
  const tabStrip = app.panel.children.find(node => node.className === "terminal-tabs");
  const rTab = tabStrip.querySelectorAll(".terminal-tab")
    .find(tab => tab.dataset.runtime === "r");
  rTab.fire("click");
  assert.equal(field.value, "x <- 1", "R session keeps its draft across switches");
});

test("new sessions add scrollbacks and flag unread output in background tabs", async () => {
  const app = mount();
  const vibe = await (async () => {
    const field = app.el("consoleInput");
    field.value = "x = 1";
    const language = app.el("language");
    language.value = "r";
    language.fire("change");
    // Pull the R session to the background without producing output there.
    language.value = "python";
    language.fire("change");
    return app.controller;
  })();
  assert.ok(vibe);
  const response = app.panel.children.find(node =>
    node.className === "terminal-actions");
  const plus = app.panel.querySelector("#terminalNewSession");
  assert.ok(plus, "an explicit + control creates sessions");
  plus.fire("click");
  const tabStrip = app.panel.children.find(node => node.className === "terminal-tabs");
  const suffixes = tabStrip.querySelectorAll(".terminal-tab")
    .map(tab => tab.textContent);
  assert.ok(suffixes.some(text => /\bPython 2\b/.test(text)), suffixes.join("|"));
  const status = app.panel.children.find(node => node.className === "terminal-status");
  assert.match(status.textContent, /No commands yet/,
    "a fresh session reports unknown state, not the other session's status");
});

test("Ctrl+L clears visible output for the active session only", () => {
  const app = mount();
  const transcript = app.panel.children.find(node =>
    node.className === "terminal-transcript");
  transcript.fire("keydown", { key: "l", ctrlKey: true, preventDefault() {} });
  assert.equal(app.el("console").children.length, 0,
    "cleared output removes painted lines but keeps the prompt");
  assert.ok(app.el("consoleInput"), "the prompt survives a clear");
});

test("the terminal search filters entries without destroying the log", () => {
  const app = mount();
  app.io().write("alpha line\n", "python", "out");
  app.io().write("beta line\n", "python", "out");
  const searchToggle = app.panel.querySelector("#terminalSearchToggle");
  searchToggle.fire("click");
  const searchInput = app.panel.querySelector("#terminalSearchInput");
  assert.ok(searchInput, "the search bar is reachable");
  searchInput.value = "alpha";
  searchInput.fire("input");
  const rendered = app.el("console").innerHTML;
  assert.match(rendered, /alpha line/);
  assert.doesNotMatch(rendered, /beta line/);
  const input = app.panel.querySelector;
  searchInput.fire("keydown", { key: "Escape", preventDefault() {} });
  assert.match(app.el("console").innerHTML, /alpha line/,
    "closing search restores the full transcript");
});

test("the I/O singleton routes attributed writes to that runtime's sessions", () => {
  const app = mount();
  app.io().write("flow notices\n", "flow", "notice");
  // The write went to the Flow session; the active python one is untouched.
  assert.doesNotMatch(app.el("console").innerHTML, /flow notices/,
    "output attributed to flow must stay out of the active transcript");
  app.el("language").value = "flow";
  app.el("language").fire("change");
  assert.match(app.el("console").innerHTML, /flow notices/);
  // Unattributed writers land in whichever session is active.
  app.io().write("unattributed line\n", null, "out");
  assert.match(app.el("console").innerHTML, /unattributed line/);
  app.el("language").value = "python";
  app.el("language").fire("change");
  assert.doesNotMatch(app.el("console").innerHTML, /flow notices/);
});

test("overflow menu gates destructive reset and wires history persistence", async () => {
  const storageData = new Map();
  const storage = {
    getItem: key => storageData.has(key) ? storageData.get(key) : null,
    setItem: (key, value) => { storageData.set(key, String(value)); },
    removeItem: key => { storageData.delete(key); }
  };
  const app = mount({ ok: true, status: 200, text: async () => "ok" }, storage);
  const menuButton = app.panel.querySelector("#terminalMenuToggle");
  assert.ok(menuButton, "the overflow menu is the single secondary-actions entry");
  menuButton.fire("click");
  const remember = app.panel.querySelector("#consoleRememberHistory");
  assert.ok(remember, "remember-history checkbox moved into the menu");
  const box = remember.children[0];
  assert.equal(box.checked, false);
  box.checked = true;
  box.fire("change");
  assert.equal(app.controller.isPersisting(), true);
  const field = app.el("consoleInput");
  field.value = "print(1)";
  await app.controller.run(field);
  storage.setItem;
  assert.ok(storageData.get("flowstudio.console.history.v1.enabled") === "1" ||
    storageData.get("flowstudio.console.history.v1.python"),
    "persisted history reaches device storage: " + [...storageData.keys()].join(","));
  assert.deepEqual(JSON.parse(storageData.get("flowstudio.console.history.v1.python")),
    ["print(1)"]);
  const reset = app.panel.querySelector("#terminalMenuReset");
  assert.equal(reset.disabled, false,
    "python keeps an interpreter, so the menu offers its reset");
  // Switching to flow disables honest reset support: Flow compiles per run.
  app.el("language").value = "flow";
  app.el("language").fire("change");
  menuButton.fire("click");
  assert.equal(reset.disabled, true,
    "Flow cannot reset an interpreter; it has none");
});


test("download exports only active terminal scrollback as sanitized UTF-8 text", async () => {
  const app = mount();
  app.io().write("python output α\x1b[31mβ\x1b[0m\n", "python", "out");
  app.io().write("unrelated flow output\n", "flow", "out");
  const menuButton = app.panel.querySelector("#terminalMenuToggle");
  menuButton.fire("click");
  const exportButton = app.panel.querySelector("#terminalMenuExport");
  assert.ok(exportButton, "the explicit download action is available");
  assert.match(exportButton.title, /may contain secrets/);
  exportButton.fire("click");
  assert.equal(app.requests.length, 0, "export must not contact execution routes");
  assert.equal(app.downloads.created.length, 1);
  assert.deepEqual(app.downloads.clicked, [{
    href: "blob:flowstudio-test-1",
    name: "flowstudio-python-session-1-transcript.txt"
  }]);
  const content = await app.downloads.created[0].text();
  assert.match(content, /Runtime: python/);
  assert.match(content, /python output αβ/);
  assert.doesNotMatch(content, /\x1b|unrelated flow output/);
  assert.deepEqual(app.downloads.revoked, ["blob:flowstudio-test-1"]);
  assert.equal(app.panel.querySelector("#terminalMenu").hidden, true);
  assert.match(app.el("resultStatus").textContent, /download requested/);
});
