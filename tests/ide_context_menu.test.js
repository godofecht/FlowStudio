"use strict";
/* Unit tests for the shared context menu (web/ide_context_menu.js):
 * placement and clamping, shortcut labels, keyboard, type-ahead, submenus,
 * disabled reasons and focus return. A small DOM fake stands in for the
 * browser; tests/native_context_menus_ui.mjs covers real Chromium. */
const test = require("node:test");
const assert = require("node:assert/strict");
const menu = require("../web/ide_context_menu.js");

/* ---------- a DOM fake with only what the menu touches ---------- */
class Node_ {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.textContent = "";
    this.tabIndex = 0;
    this.hidden = false;
    this.id = "";
    const classes = new Set();
    this._classes = classes;
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, on) => { if (on === undefined ? !classes.has(name) : on) classes.add(name); else classes.delete(name); }
    };
  }
  set className(value) { this._classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(name => this._classes.add(name)); }
  get className() { return [...this._classes].join(" "); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...nodes) { for (const node of nodes) { if (node.parentNode) node.remove(); node.parentNode = this; this.children.push(node); } }
  remove() { if (!this.parentNode) return; const list = this.parentNode.children; list.splice(list.indexOf(this), 1); this.parentNode = null; }
  contains(node) { for (let at = node; at; at = at.parentNode) if (at === this) return true; return false; }
  get isConnected() { return this.ownerDocument.body.contains(this); }
  matches(selector) { return selector.split(",").some(part => part.trim().startsWith(".") && this._classes.has(part.trim().slice(1))); }
  closest(selector) { for (let at = this; at && at.matches; at = at.parentNode) if (at.matches(selector)) return at; return null; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== fn); }
  dispatch(type, init = {}) {
    const event = Object.assign({ type, target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } }, init);
    for (let at = this; at && !event.stopped; at = at.parentNode || (at === this.ownerDocument.body ? this.ownerDocument : null))
      for (const fn of (at.listeners[type] || []).slice()) fn(event);
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; this.ownerDocument.focusLog.push(this); this.dispatch("focusin"); }
  /* A menu is 240 wide and 28 per row; rows stack from the menu's top. */
  getBoundingClientRect() {
    if (this._classes.has("fs-cm") || this._classes.has("fs-cm-tip")) {
      const rows = this.children.filter(child => child._classes.has("fs-cm-item")).length;
      const seps = this.children.filter(child => child._classes.has("fs-cm-sep")).length;
      const width = this._classes.has("fs-cm-tip") ? 180 : 240;
      const height = this._classes.has("fs-cm-tip") ? 30 : rows * 28 + seps * 9 + 8;
      const left = parseFloat(this.style.left) || 0, top = parseFloat(this.style.top) || 0;
      return { left, top, width, height, right: left + width, bottom: top + height };
    }
    if (this._classes.has("fs-cm-item")) {
      const box = this.parentNode.getBoundingClientRect();
      const index = this.parentNode.children.indexOf(this);
      const top = box.top + 4 + index * 28;
      return { left: box.left + 4, right: box.right - 4, top, bottom: top + 28, width: box.width - 8, height: 28 };
    }
    return this.rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
}
function makeDocument(width = 1440, height = 900) {
  const doc = {
    listeners: {}, focusLog: [], activeElement: null,
    createElement: tag => new Node_(doc, tag),
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== fn); },
    defaultView: { innerWidth: width, innerHeight: height, navigator: { platform: "MacIntel" },
      listeners: {}, addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
      removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== fn); },
      matchMedia: () => ({ matches: false }) },
    menus() { return this.body.children.filter(child => child._classes.has("fs-cm")); }
  };
  doc.body = new Node_(doc, "body");
  doc.documentElement = doc.body;
  return doc;
}
const key = (doc, name, extra = {}) => doc.activeElement.dispatch("keydown", Object.assign({ key: name }, extra));
const activeLabel = doc => {
  const node = doc.activeElement;
  const label = node && node.children.find(child => child._classes.has("fs-cm-label"));
  return label ? label.textContent : null;
};

/* ---------- placement ---------- */
test("a menu opens at the pointer when it fits", () => {
  const spot = menu.place({ width: 240, height: 200 }, { x: 100, y: 120 }, { width: 1440, height: 900 });
  assert.deepEqual([spot.left, spot.top, spot.flippedX, spot.flippedY], [100, 120, false, false]);
});
test("a menu flips left and up at the window edges", () => {
  const spot = menu.place({ width: 240, height: 200 }, { x: 1400, y: 850 }, { width: 1440, height: 900 });
  assert.deepEqual([spot.left, spot.top, spot.flippedX, spot.flippedY], [1160, 650, true, true]);
});
test("a menu that fits neither way is clamped inside the window", () => {
  const spot = menu.place({ width: 300, height: 600 }, { x: 200, y: 450 }, { width: 390, height: 844 });
  assert.ok(spot.left >= 4 && spot.left + 300 <= 386, "inside horizontally: " + spot.left);
  assert.ok(spot.top >= 4 && spot.top + 600 <= 840, "inside vertically: " + spot.top);
});
test("a menu taller than the window scrolls", () => {
  const spot = menu.place({ width: 240, height: 1200 }, { x: 10, y: 10 }, { width: 1024, height: 700 });
  assert.equal(spot.top, 4);
  assert.equal(spot.maxHeight, 692);
});
test("a keyboard menu goes below its anchor and flips above near the bottom", () => {
  const below = menu.place({ width: 240, height: 200 }, { left: 50, right: 150, top: 100, bottom: 120 }, { width: 1440, height: 900 }, "below");
  assert.deepEqual([below.left, below.top], [50, 122]);
  const above = menu.place({ width: 240, height: 200 }, { left: 50, right: 150, top: 800, bottom: 820 }, { width: 1440, height: 900 }, "below");
  assert.deepEqual([above.top, above.flippedY], [598, true]);
});
test("a submenu opens to the right and flips left at the edge", () => {
  const right = menu.place({ width: 200, height: 100 }, { left: 100, right: 340, top: 200, bottom: 228 }, { width: 1440, height: 900 }, "submenu");
  assert.deepEqual([right.left, right.flippedX], [338, false]);
  const left = menu.place({ width: 200, height: 100 }, { left: 1200, right: 1430, top: 200, bottom: 228 }, { width: 1440, height: 900 }, "submenu");
  assert.deepEqual([left.left, left.flippedX], [1002, true]);
});

/* ---------- labels and item lists ---------- */
test("shortcuts read as macOS glyphs on a Mac and Ctrl+ elsewhere", () => {
  assert.equal(menu.formatShortcut("Mod+Shift+P", true), "⇧⌘P");
  assert.equal(menu.formatShortcut("Mod+Alt+Shift+Ctrl+K", true), "⌃⌥⇧⌘K");
  assert.equal(menu.formatShortcut("Mod+Shift+P", false), "Ctrl+Shift+P");
  assert.equal(menu.formatShortcut("Shift+Alt+F", false), "Shift+Alt+F");
  assert.equal(menu.formatShortcut("Delete", true), "⌦");
  assert.equal(menu.formatShortcut("F2", true), "F2");
  assert.equal(menu.formatShortcut("Mod+Enter", true), "⌘↩");
  assert.equal(menu.formatShortcut("Mod+K Mod+C", false), "Ctrl+K Ctrl+C");
  assert.equal(menu.formatShortcut("", true), "");
});
test("separators collapse and hidden items drop out", () => {
  const items = menu.normalizeItems([null, { label: "A" }, null, null, { label: "B", hidden: true }, { label: "C" }, null]);
  assert.deepEqual(items.map(item => item && item.label), ["A", null, "C"]);
});
test("type-ahead cycles through rows with the same first letter", () => {
  const items = menu.normalizeItems([{ label: "Copy" }, { label: "Cut" }, null, { label: "Close" }, { label: "Paste" }]);
  assert.equal(menu.typeAheadIndex(items, -1, "c"), 0);
  assert.equal(menu.typeAheadIndex(items, 0, "c"), 1);
  assert.equal(menu.typeAheadIndex(items, 1, "c"), 3);
  assert.equal(menu.typeAheadIndex(items, 3, "c"), 0, "wraps");
  assert.equal(menu.typeAheadIndex(items, 0, "cl"), 3, "a longer prefix narrows");
  assert.equal(menu.typeAheadIndex(items, 0, "x"), -1);
});

/* ---------- the live menu ---------- */
function openMenu(doc, items, extra = {}) {
  const editor = doc.createElement("div");
  doc.body.append(editor);
  editor.focus();
  const handle = menu.open(Object.assign({ doc, items, x: 40, y: 50, mac: true }, extra));
  return { editor, handle };
}

test("opens at the pointer with menu roles and right-aligned shortcuts", () => {
  const doc = makeDocument();
  const { handle } = openMenu(doc, [{ label: "Copy", shortcut: "Mod+C", run() {} }, null, { label: "Paste", run() {} }]);
  const [element] = doc.menus();
  assert.equal(element, handle.element);
  assert.equal(element.getAttribute("role"), "menu");
  assert.deepEqual([element.style.left, element.style.top], ["40px", "50px"]);
  const rows = element.children.filter(child => child._classes.has("fs-cm-item"));
  assert.equal(rows[0].getAttribute("role"), "menuitem");
  assert.equal(rows[0].children[2].textContent, "⌘C");
  assert.equal(element.children[1].getAttribute("role"), "separator");
  menu.close();
});

test("arrows skip separators and wrap, Home and End jump", () => {
  const doc = makeDocument();
  openMenu(doc, [{ label: "One" }, null, { label: "Two" }, { label: "Three" }]);
  key(doc, "ArrowDown");
  assert.equal(activeLabel(doc), "One");
  key(doc, "ArrowDown");
  assert.equal(activeLabel(doc), "Two", "separator skipped");
  key(doc, "End");
  assert.equal(activeLabel(doc), "Three");
  key(doc, "ArrowDown");
  assert.equal(activeLabel(doc), "One", "wraps to the top");
  key(doc, "ArrowUp");
  assert.equal(activeLabel(doc), "Three", "wraps to the bottom");
  key(doc, "Home");
  assert.equal(activeLabel(doc), "One");
  menu.close();
});

test("typing a letter moves to the matching row", () => {
  const doc = makeDocument();
  openMenu(doc, [{ label: "Copy" }, { label: "Run Again" }, { label: "Rename" }, { label: "Clear" }]);
  key(doc, "r");
  assert.equal(activeLabel(doc), "Run Again");
  key(doc, "e");
  assert.equal(activeLabel(doc), "Rename", "re matches Rename");
  menu.close();
});

test("Enter runs the item, closes the menu and returns focus first", () => {
  const doc = makeDocument();
  const seen = [];
  const { editor } = openMenu(doc, [{ label: "Copy", run: () => seen.push(doc.activeElement) }]);
  key(doc, "ArrowDown");
  key(doc, "Enter");
  assert.equal(doc.menus().length, 0, "menu closed");
  assert.deepEqual(seen, [editor], "focus was back on the editor when the action ran");
});

test("Escape closes the menu and focus returns to where it was", () => {
  const doc = makeDocument();
  const { editor } = openMenu(doc, [{ label: "Copy", run() { throw new Error("must not run"); } }]);
  key(doc, "ArrowDown");
  assert.notEqual(doc.activeElement, editor);
  key(doc, "Escape");
  assert.equal(doc.menus().length, 0);
  assert.equal(doc.activeElement, editor);
  assert.equal(menu.isOpen(), false);
});

test("a disabled item does not run and explains why", () => {
  const doc = makeDocument();
  let ran = false;
  openMenu(doc, [{ label: "Rename", disabled: "Select one item to rename.", run: () => { ran = true; } }]);
  key(doc, "ArrowDown");
  key(doc, "Enter");
  assert.equal(ran, false);
  assert.equal(doc.menus().length, 1, "menu stays open");
  const row = doc.activeElement;
  assert.equal(row.getAttribute("aria-disabled"), "true");
  const tip = doc.body.children.find(child => child._classes.has("fs-cm-tip"));
  assert.ok(tip && !tip.hidden, "tooltip shown");
  assert.equal(tip.textContent, "Select one item to rename.");
  assert.equal(row.getAttribute("aria-describedby"), tip.id);
  menu.close();
});

test("ArrowRight opens a submenu and ArrowLeft closes it back to its row", () => {
  const doc = makeDocument();
  let saved = "";
  openMenu(doc, [{ label: "Save as", submenu: [{ label: "PNG", run: () => { saved = "png"; } }, { label: "SVG", run: () => { saved = "svg"; } }] }]);
  key(doc, "ArrowDown");
  key(doc, "ArrowRight");
  assert.equal(doc.menus().length, 2, "submenu open");
  assert.equal(activeLabel(doc), "PNG");
  const [parent, child] = doc.menus();
  assert.equal(parent.children[0].getAttribute("aria-expanded"), "true");
  assert.equal(parseFloat(child.style.left), parseFloat(parent.style.left) + 240 - 4 - 2, "beside the parent row");
  key(doc, "ArrowLeft");
  assert.equal(doc.menus().length, 1, "submenu closed");
  assert.equal(activeLabel(doc), "Save as");
  key(doc, "ArrowRight");
  key(doc, "ArrowDown");
  key(doc, "Enter");
  assert.equal(saved, "svg");
  assert.equal(doc.menus().length, 0);
});

test("only one menu is open at a time and an outside press closes it", () => {
  const doc = makeDocument();
  openMenu(doc, [{ label: "First" }]);
  openMenu(doc, [{ label: "Second" }]);
  assert.equal(doc.menus().length, 1);
  assert.equal(doc.menus()[0].children[0].children[1].textContent, "Second");
  const outside = doc.createElement("div");
  doc.body.append(outside);
  for (const fn of doc.listeners.pointerdown || []) fn({ target: outside });
  assert.equal(doc.menus().length, 0);
});

test("scroll, blur and resize close the menu", () => {
  for (const close of [
    doc => { for (const fn of doc.listeners.scroll || []) fn({ type: "scroll", target: doc }); },
    doc => { for (const fn of doc.defaultView.listeners.blur || []) fn({}); },
    doc => { for (const fn of doc.defaultView.listeners.resize || []) fn({}); }
  ]) {
    const doc = makeDocument();
    openMenu(doc, [{ label: "Copy" }]);
    close(doc);
    assert.equal(doc.menus().length, 0);
    assert.equal(menu.isOpen(), false);
  }
});

test("the app scrolling a pane leaves the menu open, a wheel closes it", () => {
  const doc = makeDocument();
  const pane = doc.createElement("div");
  doc.body.append(pane);
  menu.open({ doc, items: [{ label: "Copy" }], x: 10, y: 10 });
  for (const fn of doc.listeners.scroll || []) fn({ type: "scroll", target: pane });
  assert.equal(doc.menus().length, 1, "output scrolling a pane keeps the menu");
  for (const fn of doc.listeners.wheel || []) fn({ type: "wheel", target: pane });
  assert.equal(doc.menus().length, 0, "the person scrolling closes it");
});

test("a keyboard-opened menu focuses its first row and sits under the anchor", () => {
  const doc = makeDocument();
  const anchor = doc.createElement("div");
  anchor.rect = { left: 300, right: 400, top: 200, bottom: 222, width: 100, height: 22 };
  doc.body.append(anchor);
  anchor.focus();
  const handle = menu.open({ doc, items: [null, { label: "Close" }, { label: "Pin" }], anchor, keyboard: true, mac: false });
  assert.equal(activeLabel(doc), "Close");
  assert.deepEqual([handle.element.style.left, handle.element.style.top], ["300px", "224px"]);
  key(doc, "Tab");
  assert.equal(doc.activeElement, anchor, "Tab also returns focus");
});

test("an action that fails reports to the status line and leaves no rejection", async () => {
  const doc = makeDocument();
  const messages = [];
  globalThis.FlowStudioApp = { status: (message, state) => messages.push([message, state]) };
  try {
    openMenu(doc, [{ label: "Save", run: async () => { throw new Error("disk full"); } }]);
    key(doc, "ArrowDown");
    key(doc, "Enter");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(messages, [["Save failed: disk full", "error"]]);
  } finally { delete globalThis.FlowStudioApp; }
});
