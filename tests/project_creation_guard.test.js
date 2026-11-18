"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createProjectExplorer } = require("../web/project.js");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.textContent = "";
    this.listeners = {};
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
}
global.document = { createElement: tag => new Element(tag) };

function fixture(initial = {}) {
  const files = new Map(Object.entries(initial));
  const calls = [];
  const opened = [];
  const root = {
    kind: "directory",
    name: "work",
    async *entries() { yield* files.entries(); },
    async getFileHandle(name, options) {
      calls.push([name, Boolean(options?.create)]);
      if (files.has(name)) return files.get(name);
      if (!options?.create) {
        const error = new Error("No such file");
        error.name = "NotFoundError";
        throw error;
      }
      const handle = { kind: "file", name };
      files.set(name, handle);
      return handle;
    }
  };
  const explorer = createProjectExplorer({
    tree: new Element("div"),
    status() {},
    picker: async () => root,
    openHandle: async (handle, path) => {
      opened.push([handle, path]);
      return true;
    }
  });
  return { explorer, root, calls, opened, files };
}

test("served editor embeds the exact tested project module", () => {
  const moduleSource = fs.readFileSync("web/project.js", "utf8").trimEnd();
  const html = fs.readFileSync("web/index.html", "utf8");
  const start = "<!-- BEGIN EMBEDDED PROJECT MODULE: mirrors web/project.js -->\n<script>\n";
  const end = "\n</script>\n<!-- END EMBEDDED PROJECT MODULE -->";
  const i = html.indexOf(start);
  const j = html.indexOf(end, i + start.length);
  assert.ok(i >= 0 && j > i);
  assert.equal(html.indexOf(start, i + 1), -1);
  assert.equal(html.slice(i + start.length, j), moduleSource);
});

test("existing source file is never reopened by New file", async () => {
  const original = { kind: "file", name: "existing.flow", contents: "keep me" };
  const f = fixture({ "existing.flow": original });
  assert.equal(await f.explorer.choose(), true);
  await assert.rejects(f.explorer.create("existing.flow"), /already exists/);
  assert.equal(f.files.get("existing.flow"), original);
  assert.equal(f.opened.length, 0);
  assert.equal(f.calls.filter(call => call[1]).length, 0);
});

test("new source is created only after a NotFoundError", async () => {
  const f = fixture();
  await f.explorer.choose();
  assert.equal(await f.explorer.create("fresh.py"), true);
  assert.equal(f.files.get("fresh.py").kind, "file");
  assert.deepEqual(f.calls, [["fresh.py", false], ["fresh.py", true]]);
  assert.equal(f.opened[0][1], "work/fresh.py");
});

test("permission failure never triggers file creation", async () => {
  const f = fixture();
  f.root.getFileHandle = async () => {
    const error = new Error("Access denied");
    error.name = "NotAllowedError";
    throw error;
  };
  await f.explorer.choose();
  await assert.rejects(f.explorer.create("new.R"), /Access denied/);
  assert.equal(f.opened.length, 0);
});

test("invalid filename is rejected before filesystem access", async () => {
  const f = fixture();
  await f.explorer.choose();
  await assert.rejects(f.explorer.create("../escape.flow"), /Invalid source filename/);
  assert.equal(f.calls.length, 0);
});
