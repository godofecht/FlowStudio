"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const shell = require("../web/ide_shell.js");

class FakeNode {
  constructor(tag, className = "") {
    this.tag = tag;
    this.className = className;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.hidden = false;
    this.focused = false;
    this.style = {
      vars: {},
      setProperty(name, value) { this.vars[name] = value; }
    };
  }
  append(...nodes) { this.children.push(...nodes); return this; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  fire(name, event = {}) {
    for (const fn of this.listeners[name] || []) fn({ target: this, ...event });
  }
  focus() { this.focused = true; }
  click() { this.fire("click", {}); }
  matches(selector) {
    return nodeMatches(this, selector);
  }
  querySelectorAll(selector) { return walkMatch(this, selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function nodeMatches(node, selector) {
  if (selector.startsWith("#")) return node.attributes.id === selector.slice(1);
  if (selector.startsWith(".")) return node.className.split(/\s+/).includes(selector.slice(1));
  const attribute = selector.match(/^\[([\w-]+)(?:='([^']*)')?\]$/);
  if (!attribute) return false;
  const value = node.attributes[attribute[1]] ?? node.dataset[attribute[1]];
  if (attribute[2] === undefined) return value !== undefined;
  return String(value) === attribute[2];
}
function walkMatch(root, selector) {
  const found = [];
  const visit = child => {
    for (const node of child.children || []) {
      if (nodeMatches(node, selector)) found.push(node);
      visit(node);
    }
  };
  visit(root);
  return found;
}

function build() {
  const shellNode = new FakeNode("div");
  shellNode.setAttribute("id", "ideShell");

  const splitter = new FakeNode("div", "splitter");
  splitter.dataset.panel = "sidebar";
  splitter.dataset.axis = "x";
  splitter.setAttribute("data-splitter", "");
  shellNode.append(splitter);

  const strip = new FakeNode("div");
  strip.setAttribute("id", "docTabs");
  const tabA = new FakeNode("div");
  tabA.setAttribute("role", "tab");
  const tabB = new FakeNode("div");
  tabB.setAttribute("role", "tab");
  strip.append(tabA, tabB);
  shellNode.append(strip);

  const elements = new Map([["ideShell", shellNode], ["docTabs", strip]]);
  const documentListeners = {};
  const doc = {
    getElementById: id => elements.get(id) || null,
    addEventListener: (name, fn) => { (documentListeners[name] ||= []).push(fn); },
    removeEventListener: (name, fn) => {
      documentListeners[name] = (documentListeners[name] || []).filter(item => item !== fn);
    },
    fire: (name, event) => { for (const fn of documentListeners[name] || []) fn(event); },
    activeElement: null
  };
  const storageData = new Map();
  const storage = {
    getItem: key => (storageData.has(key) ? storageData.get(key) : null),
    setItem: (key, value) => storageData.set(key, String(value))
  };
  return { shellNode, splitter, strip, tabA, tabB, doc, storage };
}

test("the shell applies the default pane layout as CSS variables", () => {
  const app = build();
  const controller = shell.mount(app.doc, { storage: app.storage });
  assert.equal(app.shellNode.style.vars["--sidebar-width"], "260px");
  assert.equal(app.shellNode.style.vars["--right-width"], "280px");
  assert.equal(app.shellNode.style.vars["--dock-height"], "240px");
  assert.deepEqual(controller.layout(), { sidebar: 260, right: 280, dock: 240 });
});

test("arrow keys on a splitter resize the pane and persist the layout", () => {
  const app = build();
  shell.mount(app.doc, { storage: app.storage });
  app.splitter.fire("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.equal(app.shellNode.style.vars["--sidebar-width"], "276px");
  assert.equal(JSON.parse(app.storage.getItem(shell.LAYOUT_KEY)).sidebar, 276);
  for (let step = 0; step < 40; step++)
    app.splitter.fire("keydown", { key: "ArrowLeft", preventDefault() {} });
  assert.equal(JSON.parse(app.storage.getItem(shell.LAYOUT_KEY)).sidebar, 180);
});

test("dragging a splitter grows the pane on the side the pointer moves away from", () => {
  for (const [panel, axis, variable, start] of [
    ["sidebar", "x", "--sidebar-width", 260], ["right", "x", "--right-width", 280],
    ["dock", "y", "--dock-height", 240]]) {
    const app = build();
    const splitter = new FakeNode("div", "splitter");
    splitter.dataset.panel = panel;
    splitter.dataset.axis = axis;
    splitter.setAttribute("data-splitter", "");
    app.shellNode.children = [splitter];
    shell.mount(app.doc, { storage: app.storage });
    const at = value => axis === "x" ? { clientX: value } : { clientY: value };
    splitter.fire("pointerdown", { ...at(500), preventDefault() {} });
    app.doc.fire("pointermove", at(440));          // pointer moves left or up by 60
    app.doc.fire("pointerup", {});
    const grows = panel !== "sidebar";             // trailing panes grow toward the pointer
    assert.equal(app.shellNode.style.vars[variable], (start + (grows ? 60 : -60)) + "px", panel);
  }
});

test("stored layout preferences are restored within documented limits", () => {
  const app = build();
  app.storage.setItem(shell.LAYOUT_KEY, JSON.stringify({ sidebar: 420, right: 9999, dock: "wide" }));
  const controller = shell.mount(app.doc, { storage: app.storage });
  assert.deepEqual(controller.layout(), { sidebar: 420, right: 560, dock: 240 });
});

test("document tab strips move focus with arrow keys without activating", () => {
  const app = build();
  shell.mount(app.doc, { storage: app.storage });
  app.doc.activeElement = app.tabA;
  app.strip.fire("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.equal(app.tabB.focused, true);
});

test("a missing shell disables mounting instead of throwing", () => {
  const doc = { getElementById: () => null };
  assert.equal(shell.mount(doc, {}), null);
});
