"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.join(__dirname, "..");
const gallery = require(path.join(root, "web/examples_gallery.js"));

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
  const created = [];
  const doc = {
    createElement(tag) {
      const node = { tag, children: [], textContent: "", className: "",
        listeners: {}, append(...nodes) { node.children.push(...nodes); } };
      node.addEventListener = (name, fn) => { node.listeners[name] = fn; };
      created.push(node);
      return node;
    }
  };
  let card = null;
  const host = {
    children: [],
    append(node) { card = node; host.children.push(node); }
  };
  gallery.mount(doc, {
    host,
    onOpen: (example, file) => opened.push([example.id, file.name]),
    onDemo: example => demos.push(example.id)
  });
  assert.ok(card, "cards were appended");
  const buttons = created.filter(node => node.tag === "button");
  assert.ok(buttons.length >= 3, "every example exposes actions");
  // Click the first file button and the demo button found across cards.
  for (const button of buttons) button.listeners.click?.();
  assert.ok(opened.length >= 1, "open callback fired for file buttons");
  assert.ok(demos.includes("python-r-handshake"), "one-shot demo wired");
});
