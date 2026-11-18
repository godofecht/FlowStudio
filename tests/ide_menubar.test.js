"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeNode, makeDoc, menubarFixture } = require("./ui_dom.js");
const menubar = require("../web/ide_menubar.js");

const EVENT = { preventDefault() {} };

function standardDoc(extra = {}) {
  const { bar, menus } = menubarFixture([
    { name: "File", items: [
      { label: "New buffer", dataset: { "data-command": "newDocument" } },
      { label: "Save", dataset: { "data-act": "save" } },
      { label: "Ghost", dataset: { "data-command": "notRegistered" } },
      { label: "Run flowish", dataset: { "data-command": "run", "data-when": "not-running" } },
      { label: "Check on idle", role: "menuitemcheckbox", dataset: { "data-check-of": "autoCheckFlow" },
        children: [span("menu-check")] },
      { label: "Open recent", sub: [
        { label: "Project A", dataset: { "data-recent-id": "a" } }
      ] }
    ] },
    { name: "Run", items: [
      { label: "Run project", dataset: { "data-command": "runProject" } },
      { label: "Reset R session", dataset: { "data-act": "resetR", "data-when": "lang-r-or-python" } },
      { label: "Examples tab", dataset: { "data-tab": "tab-examples" } }
    ] }
  ]);
  const run = new FakeNode("button");
  run.disabled = Boolean(extra.running);
  const language = new FakeNode("select");
  language.value = extra.languageValue || "flow";
  const flowBackend = new FakeNode("select");
  flowBackend.value = extra.backendValue || "";
  const save = new FakeNode("button");
  const resetR = new FakeNode("button");
  const tabExamples = new FakeNode("button");
  const autoCheckFlow = new FakeNode("input");
  autoCheckFlow.checked = Boolean(extra.autoChecked);
  const examplesHost = new FakeNode("div");
  const doc = makeDoc({
    bar, run, language, flowBackend, save, resetR, autoCheckFlow, examplesHost,
    "tab-examples": tabExamples
  });
  return { doc, bar, menus, run, language, flowBackend, save, resetR,
    tabExamples, autoCheckFlow, examplesHost };
}
function span(className) {
  const node = new FakeNode("span", className);
  node.textContent = "✓";
  return node;
}
function itemOf(menu, label) {
  const found = menu.items.find(entry => entry.spec.label === label);
  assert.ok(found, "menu item fixture missing: " + label);
  return found.item;
}

test("ArrowDown opens the menu, focuses the first enabled item and renders dynamic state", () => {
  const context = standardDoc();
  const controller = menubar.mount(context.doc, {
    commands: { newDocument() {}, run() {}, runProject() {} },
    menubar: context.bar
  });
  const [fileMenu, runMenu] = controller.controllers;
  controller.triggerKey(fileMenu, { key: "ArrowDown", ...EVENT });
  assert.equal(fileMenu.popup.hidden, false);
  assert.equal(fileMenu.trigger.getAttribute("aria-expanded"), "true");
  assert.equal(controller.focusedItem(), itemOf(context.menus[0], "New buffer"));
  // Missing command disables the item at open time.
  const ghost = itemOf(context.menus[0], "Ghost");
  assert.equal(ghost.getAttribute("aria-disabled"), "true");
  const save = itemOf(context.menus[0], "Save");
  assert.equal(save.getAttribute("aria-disabled"), "false");
  assert.equal(runMenu.popup.hidden, true);
});

test("sticky hover switches to another root menu without losing keyboard ownership", () => {
  const context = standardDoc();
  const controller = menubar.mount(context.doc, { commands: {}, menubar: context.bar });
  const [fileMenu, runMenu] = controller.controllers;
  fileMenu.open(true);
  runMenu.trigger.fire("mouseenter", {});
  assert.equal(runMenu.popup.hidden, false);
  assert.equal(runMenu.trigger.getAttribute("aria-expanded"), "true");
  assert.equal(fileMenu.popup.hidden, true);
  assert.equal(fileMenu.trigger.getAttribute("aria-expanded"), "false");
});

test("arrows navigate enabled items and skip disabled ones", () => {
  const context = standardDoc();
  const controller = menubar.mount(context.doc, {
    commands: { newDocument() {}, run() {}, runProject() {} },
    menubar: context.bar
  });
  const fileMenu = controller.controllers[0];
  controller.triggerKey(fileMenu, { key: "ArrowDown", ...EVENT });
  controller.popupKey(fileMenu, { key: "ArrowDown", ...EVENT });
  assert.equal(controller.focusedItem(), itemOf(context.menus[0], "Save"));
  controller.popupKey(fileMenu, { key: "ArrowDown", ...EVENT });   // skips Ghost
  assert.equal(controller.focusedItem(), itemOf(context.menus[0], "Run flowish"));
  controller.popupKey(fileMenu, { key: "ArrowUp", ...EVENT });
  assert.equal(controller.focusedItem(), itemOf(context.menus[0], "Save"));
  controller.popupKey(fileMenu, { key: "Home", ...EVENT });
  assert.equal(controller.focusedItem(), itemOf(context.menus[0], "New buffer"));
  controller.popupKey(fileMenu, { key: "End", ...EVENT });
  assert.equal(controller.focusedItem(), itemOf(context.menus[0], "Open recent"));
});

test("typeahead jumps by label prefix and Enter activates the dispatched command", () => {
  const context = standardDoc();
  const fired = [];
  const controller = menubar.mount(context.doc, {
    commands: {
      newDocument() {}, run() {}, runProject() {},
      saveFile() { fired.push("saveFile"); }
    },
    menubar: context.bar
  });
  const fileMenu = controller.controllers[0];
  let saved = 0;
  context.save.addEventListener("click", () => { saved++; });
  controller.triggerKey(fileMenu, { key: "ArrowDown", ...EVENT });
  const chosen = controller.typeahead(fileMenu, "s");
  assert.equal(chosen, itemOf(context.menus[0], "Save"));
  // Pressing the same printable key lands the focus, like the real menubar does.
  controller.popupKey(fileMenu, { key: "s", ...EVENT });
  assert.equal(controller.focusedItem(), itemOf(context.menus[0], "Save"));
  controller.popupKey(fileMenu, { key: "Enter", ...EVENT });
  assert.equal(saved, 1);
  assert.equal(fileMenu.popup.hidden, true);
});

test("data-act click dispatches the referenced element and data-tab clicks the tab", () => {
  const context = standardDoc();
  let resetFired = 0;
  context.resetR.addEventListener("click", () => { resetFired++; });
  let tabFired = 0;
  context.tabExamples.addEventListener("click", () => { tabFired++; });
  const controller = menubar.mount(context.doc, {
    commands: { runProject() {} },
    menubar: context.bar
  });
  const runMenu = controller.controllers[1];
  // "Reset R session" only applies to R/Python sessions, so it is disabled here.
  runMenu.open(true);
  const resetItem = itemOf(context.menus[1], "Reset R session");
  assert.equal(resetItem.getAttribute("aria-disabled"), "true");
  resetItem.fire("click", {});              // disabled: no dispatch, menu stays open
  assert.equal(resetFired, 0);
  assert.equal(runMenu.popup.hidden, false);
  context.language.value = "r";
  runMenu.open(true);
  resetItem.fire("click", {});
  assert.equal(resetFired, 1);
  assert.equal(runMenu.popup.hidden, true);
  context.language.value = "flow";
  runMenu.open(true);
  itemOf(context.menus[1], "Examples tab").fire("click", {});
  assert.equal(tabFired, 1);
});

test("disabled items are skipped by navigation and ignore clicks", () => {
  const context = standardDoc({ running: true, languageValue: "flow" });
  let resetFired = 0;
  context.resetR.addEventListener("click", () => { resetFired++; });
  const controller = menubar.mount(context.doc, {
    commands: { runProject() {} },
    menubar: context.bar
  });
  const runMenu = controller.controllers[1];
  runMenu.open(true);
  const runItem = itemOf(context.menus[1], "Run project");
  assert.equal(runItem.getAttribute("aria-disabled"), "false");
  const resetItem = itemOf(context.menus[1], "Reset R session");
  assert.equal(resetItem.getAttribute("aria-disabled"), "true");
  resetItem.fire("click", {});
  assert.equal(resetFired, 0);
  assert.equal(runMenu.popup.hidden, false, "disabled click keeps the menu open");
  context.language.value = "r";
  runMenu.open(true);
  assert.equal(resetItem.getAttribute("aria-disabled"), "false");
});

test("menuitemcheckbox reflects the bound checkbox at open time", () => {
  const context = standardDoc({ autoChecked: false });
  let toggles = 0;
  context.autoCheckFlow.addEventListener("click", () => {
    toggles++;
    context.autoCheckFlow.checked = !context.autoCheckFlow.checked;
  });
  const controller = menubar.mount(context.doc, { commands: {}, menubar: context.bar });
  const fileMenu = controller.controllers[0];
  fileMenu.open(true);
  const box = itemOf(context.menus[0], "Check on idle");
  assert.equal(box.getAttribute("aria-checked"), "false");
  assert.equal(toggles, 0);
  box.fire("click", {});
  assert.equal(toggles, 1);
  fileMenu.open(true);
  assert.equal(box.getAttribute("aria-checked"), "true");
  const marker = box.querySelector(".menu-check");
  assert.ok(marker, "check marker span present");
  assert.equal(marker.getAttribute("data-checked"), "true");
});

test("submenus open with ArrowRight, and Escape/ArrowLeft close just the submenu", () => {
  const context = standardDoc();
  const controller = menubar.mount(context.doc, {
    commands: { newDocument() {}, run() {}, runProject() {} },
    menubar: context.bar
  });
  const fileMenu = controller.controllers[0];
  controller.triggerKey(fileMenu, { key: "ArrowDown", ...EVENT });
  for (let step = 0; step < 4; step++)
    controller.popupKey(fileMenu, { key: "ArrowDown", ...EVENT });
  assert.equal(controller.focusedItem(), itemOf(context.menus[0], "Open recent"));
  controller.popupKey(fileMenu, { key: "ArrowRight", ...EVENT });
  assert.equal(controller.submenuDepth(), 1);
  assert.equal(controller.focusedItem().getAttribute("data-recent-id"), "a");
  assert.equal(itemOf(context.menus[0], "Open recent").getAttribute("aria-expanded"), "true");
  controller.popupKey(fileMenu, { key: "ArrowLeft", ...EVENT });
  assert.equal(controller.submenuDepth(), 0);
  assert.equal(controller.focusedItem(), itemOf(context.menus[0], "Open recent"));
  // Reopen, then Escape inside the submenu must not close the root menu.
  controller.popupKey(fileMenu, { key: "ArrowRight", ...EVENT });
  controller.popupKey(fileMenu, { key: "Escape", ...EVENT });
  assert.equal(controller.submenuDepth(), 0);
  assert.equal(fileMenu.popup.hidden, false);
  controller.popupKey(fileMenu, { key: "Escape", ...EVENT });
  assert.equal(fileMenu.popup.hidden, true);
  assert.equal(fileMenu.trigger.focused, true);
});

test("clicking a submenu parent toggles instead of running commands", () => {
  const context = standardDoc();
  const controller = menubar.mount(context.doc, { commands: {}, menubar: context.bar });
  const fileMenu = controller.controllers[0];
  fileMenu.open(true);
  const parent = itemOf(context.menus[0], "Open recent");
  parent.fire("click", {});
  assert.equal(controller.submenuDepth(), 1);
  assert.equal(fileMenu.popup.hidden, false);
  parent.fire("click", {});
  assert.equal(controller.submenuDepth(), 0);
  assert.equal(fileMenu.popup.hidden, false);
});

test("the recent-projects submenu fills from the saved-projects store and reopens", () => {
  const context = standardDoc();
  let reopened = 0;
  const card = new FakeNode("section", "example-card saved-project");
  card.setAttribute("data-project-id", "a");
  const reopen = new FakeNode("button", "primary");
  reopen.addEventListener("click", () => { reopened++; });
  card.append(reopen);
  context.examplesHost.querySelectorAll = selector =>
    selector === "[data-project-id]" ? [card] : [];
  const saved = { createStore: () => ({ list: () => [{ id: "a", title: "Regression study" }] }) };
  const previous = globalThis.FlowStudioSavedProjects;
  globalThis.FlowStudioSavedProjects = saved;
  try {
    const controller = menubar.mount(context.doc, { commands: {}, menubar: context.bar });
    const fileMenu = controller.controllers[0];
    fileMenu.open(true);
    const parent = itemOf(context.menus[0], "Open recent");
    parent.fire("click", {});
    const sub = controller.activePopup();
    assert.equal(sub.className.includes("menu-sub"), true);
    const filled = sub.querySelectorAll("[role='menuitem']");
    assert.equal(filled.length, 1);
    assert.equal(filled[0].textContent, "Regression study");
    filled[0].fire("click", {});
    assert.equal(reopened, 1);
    assert.equal(fileMenu.popup.hidden, true);
  } finally {
    if (previous === undefined) delete globalThis.FlowStudioSavedProjects;
    else globalThis.FlowStudioSavedProjects = previous;
  }
});

test("a menubar without static menus declines to mount", () => {
  const doc = makeDoc({});
  assert.equal(menubar.mount(doc, {}), null);
});
