"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
  removeEventListener(name, fn) {
    this.listeners[name] = (this.listeners[name] || []).filter(item => item !== fn);
  }
  fire(name, event = {}) {
    for (const fn of this.listeners[name] || []) fn({ target: this, ...event });
  }
  focus() { this.focused = true; }
  matches(selector) {
    if (selector.startsWith("#")) return this.attributes.id === selector.slice(1);
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    const attribute = selector.match(/^\[([\w-]+)(?:='([^']*)')?\]$/);
    if (!attribute) return false;
    const value = this.attributes[attribute[1]] ?? this.dataset[attribute[1]];
    if (attribute[2] === undefined) return value !== undefined;
    return String(value) === attribute[2];
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = node => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function build() {
  const shellNode = new FakeNode("div");
  shellNode.setAttribute("id", "ideShell");

  const command = { fired: 0 };
  const menus = ["file", "edit"].map(name => {
    const menu = new FakeNode("div", "menu");
    const trigger = new FakeNode("button", "menu-trigger");
    trigger.attributes["aria-expanded"] = "false";
    const popup = new FakeNode("div", "menu-popup");
    popup.hidden = true;
    const item = new FakeNode("button");
    item.setAttribute("role", "menuitem");
    if (name === "file") item.dataset.command = "newDocument";
    popup.append(item);
    menu.append(trigger, popup);
    shellNode.append(menu);
    return { name, menu, trigger, popup, item };
  });

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
  return { shellNode, menus, splitter, strip, tabA, tabB, doc, storage, command };
}

test("the shell applies the default pane layout as CSS variables", () => {
  const app = build();
  const controller = shell.mount(app.doc, { storage: app.storage, commands: {} });
  assert.equal(app.shellNode.style.vars["--sidebar-width"], "290px");
  assert.equal(app.shellNode.style.vars["--right-width"], "320px");
  assert.equal(app.shellNode.style.vars["--dock-height"], "190px");
  assert.deepEqual(controller.layout(), { sidebar: 290, right: 320, dock: 190 });
});

test("clicking a menu trigger opens one popup and closes the other", () => {
  const app = build();
  shell.mount(app.doc, { storage: app.storage, commands: {} });
  app.menus[0].trigger.fire("click", { stopPropagation() {} });
  assert.equal(app.menus[0].popup.hidden, false);
  assert.equal(app.menus[0].trigger.getAttribute("aria-expanded"), "true");
  app.menus[1].trigger.fire("click", { stopPropagation() {} });
  assert.equal(app.menus[0].popup.hidden, true);
  assert.equal(app.menus[0].trigger.getAttribute("aria-expanded"), "false");
  assert.equal(app.menus[1].popup.hidden, false);
});

test("menu commands dispatch once and close the menu afterwards", () => {
  const app = build();
  let runs = 0;
  shell.mount(app.doc, { storage: app.storage, commands: { newDocument: () => { runs++; } } });
  app.menus[0].trigger.fire("click", { stopPropagation() {} });
  app.menus[0].popup.fire("click", { target: app.menus[0].item });
  assert.equal(runs, 1);
  assert.equal(app.menus[0].popup.hidden, true);
});

test("Escape closes an open menu and returns focus to its trigger", () => {
  const app = build();
  shell.mount(app.doc, { storage: app.storage, commands: {} });
  app.menus[0].trigger.fire("click", { stopPropagation() {} });
  app.menus[0].trigger.fire("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(app.menus[0].popup.hidden, true);
  assert.equal(app.menus[0].trigger.focused, true);
});

test("arrow keys on a splitter resize the pane and persist the layout", () => {
  const app = build();
  shell.mount(app.doc, { storage: app.storage, commands: {} });
  app.splitter.fire("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.equal(app.shellNode.style.vars["--sidebar-width"], "306px");
  assert.equal(JSON.parse(app.storage.getItem(shell.LAYOUT_KEY)).sidebar, 306);
  for (let step = 0; step < 40; step++)
    app.splitter.fire("keydown", { key: "ArrowLeft", preventDefault() {} });
  assert.equal(JSON.parse(app.storage.getItem(shell.LAYOUT_KEY)).sidebar, 180);
});

test("stored layout preferences are restored within documented limits", () => {
  const app = build();
  app.storage.setItem(shell.LAYOUT_KEY, JSON.stringify({ sidebar: 420, right: 9999, dock: "wide" }));
  const controller = shell.mount(app.doc, { storage: app.storage, commands: {} });
  assert.deepEqual(controller.layout(), { sidebar: 420, right: 560, dock: 190 });
});

test("document tab strips move focus with arrow keys without activating", () => {
  const app = build();
  shell.mount(app.doc, { storage: app.storage, commands: {} });
  app.doc.activeElement = app.tabA;
  app.strip.fire("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.equal(app.tabB.focused, true);
});

test("a missing shell disables mounting instead of throwing", () => {
  const doc = { getElementById: () => null };
  assert.equal(shell.mount(doc, {}), null);
});
