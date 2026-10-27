"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.join(__dirname, "..");
const gallery = require(path.join(root, "web/examples_gallery.js"));

function fakeNode(tag) {
  const node = { tag, children: [], textContent: "", className: "",
    listeners: {}, attributes: {}, dataset: {},
    append(...nodes) { node.children.push(...nodes); },
    replaceChildren(...nodes) { node.children = [...nodes]; },
    setAttribute(name, value) { node.attributes[name] = value; } };
  node.addEventListener = (name, fn) => { node.listeners[name] = fn; };
  return node;
}
function fakeDocument() {
  const created = [];
  return { created, createElement(tag) { const node = fakeNode(tag); created.push(node); return node; } };
}
function host() {
  const element = { children: [],
    append(node) { element.children.push(node); },
    replaceChildren(...nodes) { element.children = [...nodes]; } };
  return element;
}
/* Walks the mounted tree: sections now live in saved/curated containers. */
function cards(hostElement) {
  const found = [];
  const walk = node => {
    for (const child of node.children || []) {
      if (child.className && child.className.split(" ").includes("example-card")) found.push(child);
      walk(child);
    }
  };
  walk(hostElement);
  return found;
}
function buttonsIn(cardElement) {
  const found = [];
  const walk = node => {
    if (node.tag === "button") found.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(cardElement);
  return found;
}
function sectionOf(hostElement, className) {
  return (hostElement.children || []).find(child =>
    child.className && child.className.split(" ").includes(className)) || null;
}

test("examples dataset is valid and interop-focused", () => {
  assert.equal(gallery.validate(), null);
  const examples = gallery.examples();
  assert.ok(examples.length >= 3, "curated set has at least three entries");
  const languages = new Set();
  for (const example of examples)
    for (const file of example.files) languages.add(file.language);
  assert.ok(languages.has("flow"), "covers Flow");
  assert.ok(languages.has("python"), "covers Python");
  assert.ok(languages.has("r"), "covers R");
});

test("gallery mounts example cards with open and demo actions", () => {
  const opened = [];
  const demos = [];
  const doc = fakeDocument();
  const hostElement = host();
  gallery.mount(doc, {
    host: hostElement,
    onOpen: (example, file) => opened.push([example.id, file.name]),
    onDemo: example => demos.push(example.id)
  });
  const mounted = cards(hostElement);
  assert.equal(mounted.length, gallery.examples().length, "one card per curated example");
  const buttons = mounted.flatMap(buttonsIn);
  assert.ok(buttons.length >= 3, "every example exposes actions");
  // Click the first file button and the demo button found across cards.
  for (const button of buttons) button.listeners.click?.();
  assert.ok(opened.length >= 1, "open callback fired for file buttons");
  assert.ok(demos.includes("python-r-handshake"), "one-shot demo wired");
});

test("primary open-project action loads every example file at once", () => {
  const opened = [];
  const demos = [];
  const doc = fakeDocument();
  const hostElement = host();
  gallery.mount(doc, {
    host: hostElement,
    onOpen: example => opened.push([example.id, "single"]),
    onOpenProject: example => opened.push([example.id, "project"]),
    onDemo: example => demos.push(example.id)
  });
  const examples = gallery.examples();
  assert.equal(cards(hostElement).length, examples.length);
  for (const card of cards(hostElement)) for (const child of card.children)
    if (child.listeners) child.listeners.click?.();
  const flowExample = examples.find(example => example.id === "flow-backend-mlir");
  assert.ok(opened.some(fired => fired[0] === "flow-backend-mlir" && fired[1] === "project"),
    "flow example exposes one-shot project open");
  assert.ok(demos.includes("python-r-handshake"));
  const chips = doc.created.filter(node => node.className === "example-langs");
  assert.ok(chips.length >= 3, "every card shows language chips");
});

test("opened projects appear as saved project files and reopen on demand", () => {
  const doc = fakeDocument();
  const hostElement = host();
  let savedList = [
    { id: "polyglot-pipeline", title: "Python → data file → R analysis",
      savedAt: 1730000000000,
      files: [{ name: "generate.py", language: "python", text: "print(1)" },
              { name: "analyse.R", language: "r", text: "cat(1)" }] }
  ];
  const reopened = [];
  const forgotten = [];
  gallery.mount(doc, {
    host: hostElement,
    onOpen: () => {},
    onReopenProject: (project, file) => reopened.push([project.id, file ? file.name : null]),
    onForgetProject: id => { forgotten.push(id); savedList = savedList.filter(p => p.id !== id); },
    saved: { list: () => savedList }
  });
  const savedSection = sectionOf(hostElement, "saved-projects");
  const curatedSection = sectionOf(hostElement, "curated-examples");
  assert.ok(savedSection, "saved projects get their own section ahead of curated examples");
  assert.ok(curatedSection, "curated examples keep their own section");
  assert.equal(cards(savedSection).length, 1, "one saved project card");
  const savedButtons = buttonsIn(cards(savedSection)[0]);
  const reopen = savedButtons.find(button => button.className === "primary");
  const forget = savedButtons.find(button => button.className === "example-forget");
  const fileChips = savedButtons.filter(button => button.className === "example-file-btn");
  assert.ok(reopen && forget, "saved card exposes reopen and forget");
  assert.equal(fileChips.length, 2, "saved card lists its project files");
  reopen.listeners.click?.();
  assert.deepEqual(reopened, [["polyglot-pipeline", null]], "reopen restores every buffer");
  fileChips[1].listeners.click?.();
  assert.deepEqual(reopened[1], ["polyglot-pipeline", "analyse.R"],
    "a file chip reopens the project and lands on that file");
  assert.ok(savedButtons.every(button => button.textContent.length > 0));
  forget.listeners.click?.();
  assert.deepEqual(forgotten, ["polyglot-pipeline"], "forget removes the saved project");
  assert.equal(cards(savedSection).length, 0, "saved section refreshes after forgetting");
  assert.match(savedSection.children.find(node => node.className === "muted").textContent,
    /saved on this device/);
});
