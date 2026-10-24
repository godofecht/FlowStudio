"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const outline = require("../web/ide_outline.js");
const symbols = require("../web/ide_symbols.js");
const root = path.join(__dirname, "..");

class FakeNode {
  constructor(tag, className = "") {
    this.tag = tag;
    this.className = className;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.style = { values: {}, setProperty(name, value) { this.values[name] = value; } };
    this.textContent = "";
    this.hidden = false;
    this.focused = false;
  }
  append(...nodes) { this.children.push(...nodes); return this; }
  replaceChildren(...nodes) { this.children = nodes; return this; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  fire(name, event = {}) { for (const fn of this.listeners[name] || []) fn({ target: this, ...event }); }
  focus() { this.focused = true; }
  matches(selector) {
    if (selector.startsWith("#")) return this.attributes.id === selector.slice(1);
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    return false;
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = node => {
      for (const child of node.children) {
        if (child.matches && child.matches(selector)) found.push(child);
        if (child.children) walk(child);
      }
    };
    walk(this);
    return found;
  }
}

function fixture() {
  const list = new FakeNode("ul");
  list.setAttribute("id", "outlineList");
  const label = new FakeNode("span");
  label.setAttribute("id", "outlineLabel");
  const empty = new FakeNode("p");
  empty.setAttribute("id", "outlineEmpty");
  empty.hidden = true;
  const elements = new Map([["outlineList", list], ["outlineLabel", label],
    ["outlineEmpty", empty]]);
  const doc = {
    createElement: tag => new FakeNode(tag),
    getElementById: id => elements.get(id) || null,
    activeElement: null
  };
  const jumps = [];
  const panel = outline.mount(doc, {
    symbols,
    jump: (line, column) => { jumps.push([line, column]); return true; }
  });
  return { doc, list, label, empty, panel, jumps, buttons: () => list.querySelectorAll(".outline-item") };
}

const PYTHON = [
  "MAX = 3",
  "",
  "class Store:",
  "    def load(self, path):",
  "        return path",
  "",
  "def helper(a, b):",
  "    return a + b"
].join("\n");

test("the panel renders one selectable row per symbol", () => {
  const app = fixture();
  assert.equal(app.panel.update({ language: "python", text: PYTHON, label: "store.py" }), 4);
  assert.equal(app.label.textContent, "store.py");
  assert.equal(app.empty.hidden, true);
  const rows = app.buttons();
  assert.equal(rows.length, 4);
  assert.equal(rows[0].title, "value MAX \u2014 line 1");
  assert.equal(rows[2].dataset.depth, "1");
  assert.equal(rows[2].dataset.kind, "function");
  assert.equal(rows[2].style.values["--depth"], "1");
  assert.match(rows[2].getAttribute("aria-label"), /^function load, line 4$/);
  const name = rows[2].children.find(child => child.className === "outline-name");
  assert.equal(name.textContent, "load");
  const glyph = rows[2].children.find(child => child.className === "outline-glyph");
  assert.equal(glyph.textContent, symbols.glyph("function"));
});

test("selecting a symbol jumps to its exact buffer position", () => {
  const app = fixture();
  app.panel.update({ language: "python", text: PYTHON });
  app.buttons()[3].fire("click");
  assert.deepEqual(app.jumps, [[7, 5]]);
  assert.deepEqual(app.panel.selected(), { name: "helper", kind: "function", line: 7,
    column: 5, depth: 0, detail: "(a, b):" });
});

test("buffers without symbols explain themselves instead of staying blank", () => {
  const app = fixture();
  assert.equal(app.panel.update({ language: "python", text: "print('hi')\n" }), 0);
  assert.equal(app.buttons().length, 0);
  assert.equal(app.empty.hidden, false);
  assert.match(app.empty.textContent, /No document symbols found/);
});

test("unreadable buffers surface the parser message", () => {
  const app = fixture();
  assert.equal(app.panel.update({ language: "flow", text: "x".repeat(symbols.MAX_SOURCE + 1) }), 0);
  assert.equal(app.empty.hidden, false);
  assert.match(app.empty.textContent, /2 MiB outline limit/);
  assert.equal(app.empty.dataset.state, "error");
});

test("arrow keys move focus through the outline rows", () => {
  const app = fixture();
  app.panel.update({ language: "python", text: PYTHON });
  const rows = app.buttons();
  app.doc.activeElement = rows[0];
  let prevented = 0;
  app.list.fire("keydown", { key: "ArrowDown", preventDefault() { prevented++; } });
  assert.equal(rows[1].focused, true);
  app.doc.activeElement = rows[1];
  app.list.fire("keydown", { key: "ArrowUp", preventDefault() {} });
  assert.equal(rows[0].focused, true);
  app.list.fire("keydown", { key: "End", preventDefault() {} });
  assert.equal(rows[rows.length - 1].focused, true);
  assert.equal(app.panel.focusFirst(), true);
  assert.equal(rows[0].focused, true);
  assert.equal(prevented, 1);
});

test("a missing outline panel disables mounting instead of throwing", () => {
  assert.equal(outline.mount({ getElementById: () => null }, {}), null);
});

test("the native workspace serves and mounts the outline modules", () => {
  const html = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
  assert.match(html, /id="tab-outline" role="tab" aria-controls="view-outline"/);
  assert.match(html, /id="view-outline" role="tabpanel"/);
  assert.match(html, /<script src="\/ide_symbols\.js"><\/script>/);
  assert.match(html, /<script src="\/ide_outline\.js"><\/script>/);
  assert.match(html, /FlowStudioOutline\.mount\(document, \{ jump: revealPosition \}\)/);
  assert.match(html, /function revealPosition\(line, column = 1\)/);
  assert.match(html, /data-command="goToSymbol"/);
  assert.match(html, /data-command="showOutline"/);
  const routes = fs.readFileSync(path.join(root, "src", "data_routes.flow"), "utf8");
  assert.match(routes, /if url == "\/ide_symbols\.js"/);
  assert.match(routes, /if url == "\/ide_outline\.js"/);
  for (const file of ["web/ide_symbols.js", "web/ide_outline.js"])
    assert.ok(fs.existsSync(path.join(root, file)), file + " must exist");
});
