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

const WIDE = () => ({ width: 1440, height: 900 });

test("the shell applies the default layout as CSS variables and classes", () => {
  const app = build();
  const controller = shell.mount(app.doc, { storage: app.storage, viewport: WIDE });
  // The sidebar column holds the 42px activity bar plus the views.
  assert.equal(app.shellNode.style.vars["--sidebar-width"], (280 + shell.ACTIVITY) + "px");
  assert.equal(app.shellNode.style.vars["--right-width"], "0px", "the side panel starts hidden");
  assert.equal(app.shellNode.style.vars["--right-sash"], "0px");
  assert.equal(app.shellNode.style.vars["--dock-height"], "190px");
  assert.equal(app.shellNode.dataset.rightHidden, "true");
  assert.deepEqual(controller.layout().show, { sidebar: true, right: false, dock: true });
});

test("arrow keys on a splitter resize the pane and persist the layout", () => {
  const app = build();
  shell.mount(app.doc, { storage: app.storage, viewport: WIDE });
  app.splitter.fire("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.equal(app.shellNode.style.vars["--sidebar-width"], (296 + shell.ACTIVITY) + "px");
  assert.equal(JSON.parse(app.storage.getItem(shell.LAYOUT_KEY)).sidebar, 296);
  for (let step = 0; step < 40; step++)
    app.splitter.fire("keydown", { key: "ArrowLeft", preventDefault() {} });
  assert.equal(JSON.parse(app.storage.getItem(shell.LAYOUT_KEY)).sidebar, 180);
});

test("dragging a splitter grows the pane on the side the pointer moves away from", () => {
  for (const [panel, axis, variable, start, offset] of [
    ["sidebar", "x", "--sidebar-width", 280, shell.ACTIVITY], ["right", "x", "--right-width", 440, 0],
    ["dock", "y", "--dock-height", 190, 0]]) {
    const app = build();
    const splitter = new FakeNode("div", "splitter");
    splitter.dataset.panel = panel;
    splitter.dataset.axis = axis;
    splitter.setAttribute("data-splitter", "");
    app.shellNode.children = [splitter];
    const controller = shell.mount(app.doc, { storage: app.storage, viewport: WIDE });
    controller.show("right");
    const at = value => axis === "x" ? { clientX: value } : { clientY: value };
    splitter.fire("pointerdown", { ...at(500), preventDefault() {} });
    app.doc.fire("pointermove", at(440));          // pointer moves left or up by 60
    app.doc.fire("pointerup", {});
    const grows = panel !== "sidebar";             // trailing panes grow toward the pointer
    assert.equal(app.shellNode.style.vars[variable], (start + offset + (grows ? 60 : -60)) + "px", panel);
  }
});

test("dragging the dock below the snap height closes it", () => {
  const app = build();
  const splitter = new FakeNode("div", "splitter");
  splitter.dataset.panel = "dock";
  splitter.dataset.axis = "y";
  splitter.setAttribute("data-splitter", "");
  app.shellNode.children = [splitter];
  const controller = shell.mount(app.doc, { storage: app.storage, viewport: WIDE });
  splitter.fire("pointerdown", { clientY: 600, preventDefault() {} });
  app.doc.fire("pointermove", { clientY: 760 });   // 190 - 160 = 30px, under the snap
  app.doc.fire("pointerup", {});
  assert.equal(controller.isVisible("dock"), false);
  assert.equal(app.shellNode.style.vars["--dock-height"], "0px");
  assert.equal(JSON.parse(app.storage.getItem(shell.LAYOUT_KEY)).show.dock, false);
});

test("stored layout preferences are restored within documented limits", () => {
  const app = build();
  app.storage.setItem(shell.LAYOUT_KEY, JSON.stringify({ sidebar: 420, right: 9999, dock: "wide",
    show: { sidebar: false, right: true, dock: "yes" } }));
  const controller = shell.mount(app.doc, { storage: app.storage, viewport: WIDE });
  const layout = controller.layout();
  assert.deepEqual([layout.sidebar, layout.right, layout.dock], [420, 1100, 190]);
  assert.deepEqual(layout.show, { sidebar: false, right: true, dock: true });
});

test("the solver keeps the editor its minimum width by shrinking then hiding side panes", () => {
  const layout = { sidebar: 300, right: 500, dock: 190, show: { sidebar: true, right: true, dock: true } };
  const wide = shell.solve(layout, { width: 1600, height: 900 });
  assert.deepEqual([wide.sidebar, wide.right, wide.show.right], [300, 500, true]);
  // 1100px: the right pane shrinks so the editor keeps 360px.
  const medium = shell.solve(layout, { width: 1100, height: 900 });
  assert.equal(medium.show.right, true);
  assert.ok(medium.editor >= shell.EDITOR_MIN_W, "editor keeps its minimum: " + medium.editor);
  assert.ok(medium.right < 500 && medium.right >= shell.LIMITS.right[0]);
  // 800px: the right pane is hidden automatically, the sidebar stays.
  const narrow = shell.solve(layout, { width: 800, height: 900 });
  assert.deepEqual([narrow.show.right, narrow.auto.right, narrow.show.sidebar], [false, true, true]);
  assert.ok(narrow.editor >= shell.EDITOR_MIN_W);
  // A phone: both side panes collapse; the editor takes what is left.
  const phone = shell.solve(layout, { width: 390, height: 844 });
  assert.deepEqual([phone.show.sidebar, phone.show.right], [false, false]);
  assert.deepEqual([phone.auto.sidebar, phone.auto.right], [true, true]);
  assert.equal(phone.editor, 390 - shell.ACTIVITY - 2 * shell.SASH);
  // Automatic collapses never rewrite the user's preference.
  assert.deepEqual(layout.show, { sidebar: true, right: true, dock: true });
});

test("the dock never squeezes the editor below its minimum height", () => {
  const solved = shell.solve({ sidebar: 280, right: 400, dock: 900, show: { sidebar: true, right: false, dock: true } },
    { width: 1440, height: 700 });
  assert.ok(700 - 94 - solved.dock >= shell.EDITOR_MIN_H, "editor height " + (700 - 94 - solved.dock));
});

test("showing a pane that does not fit closes the other side pane to make room", () => {
  const app = build();
  const controller = shell.mount(app.doc, { storage: app.storage, viewport: () => ({ width: 820, height: 800 }) });
  assert.equal(controller.isVisible("sidebar"), true);
  controller.show("right");
  assert.equal(controller.isVisible("right"), true, "the requested pane is shown");
  assert.equal(controller.isVisible("sidebar"), false, "the sidebar made room");
});

test("toggle and keyboard shortcuts flip pane visibility", () => {
  const app = build();
  const controller = shell.mount(app.doc, { storage: app.storage, viewport: WIDE });
  const press = (key, extra = {}) => app.doc.fire("keydown", { key, ctrlKey: true, preventDefault() {}, ...extra });
  press("b");
  assert.equal(controller.isVisible("sidebar"), false);
  assert.equal(app.shellNode.style.vars["--sidebar-width"], shell.ACTIVITY + "px", "the activity bar stays");
  press("b");
  assert.equal(controller.isVisible("sidebar"), true);
  press("j");
  assert.equal(controller.isVisible("dock"), false);
  press("b", { altKey: true });
  assert.equal(controller.isVisible("right"), true);
  assert.equal(controller.toggleDockMax(), true);
  assert.equal(controller.isVisible("dock"), true, "maximizing shows the dock");
  assert.equal(app.shellNode.dataset.dockMax, "true");
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
