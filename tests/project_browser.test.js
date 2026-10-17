"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createProjectExplorer, validFilename } = require("../web/project.js");

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.textContent = "";
    this.open = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  async fire(name) { return this.listeners[name]?.(); }
}
global.document = { createElement: tag => new FakeElement(tag) };

function file(name) { return { kind: "file", name }; }
function dir(name, initial = []) {
  const entries = new Map(initial);
  return {
    kind: "directory", name,
    async *entries() { yield* entries.entries(); },
    async getFileHandle(filename, { create }) {
      if (!entries.has(filename) && create) entries.set(filename, file(filename));
      return entries.get(filename);
    },
  };
}
function setup(root, onOpen = async () => true) {
  const tree = new FakeElement("div");
  const statuses = [];
  const project = createProjectExplorer({
    tree, status: (...args) => statuses.push(args), openHandle: onOpen,
    picker: async () => root,
  });
  return { tree, statuses, project };
}

test("rejects unsafe or unsupported new file names", () => {
  for (const name of ["", ".", "..", "../evil.flow", "nested/x.py", "x\\evil.r", "x.exe", String.fromCharCode(0) + ".flow"]) {
    assert.equal(validFilename(name), false, name);
  }
  assert.equal(validFilename("analysis.R"), true);
  assert.equal(validFilename("example.flow"), true);
});

test("sorts directories first, ignores binary files, opens exact handles", async () => {
  const target = file("model.flow");
  const root = dir("work", [["z.png", file("z.png")], ["model.flow", target], ["src", dir("src")]]);
  const opened = [];
  const { tree, project } = setup(root, async (handle, path) => opened.push([handle, path]));
  assert.equal(await project.choose(), true);
  assert.equal(tree.children[1].tag, "details");
  assert.equal(tree.children[2].textContent, "File: model.flow");
  assert.equal(tree.children.length, 3);
  await tree.children[2].fire("click");
  assert.deepEqual(opened, [[target, "work/model.flow"]]);
});

test("lazy nested directory expansion and refresh", async () => {
  const nested = file("test.py");
  const root = dir("work", [["sub", dir("sub", [["test.py", nested]])]]);
  const opened = [];
  const { tree, project } = setup(root, async (handle, path) => opened.push([handle, path]));
  await project.choose();
  const details = tree.children[1];
  assert.equal(details.children[1].children.length, 0);
  details.open = true;
  await details.fire("toggle");
  assert.equal(details.children[1].children[0].textContent, "File: test.py");
  await details.children[1].children[0].fire("click");
  assert.deepEqual(opened, [[nested, "work/sub/test.py"]]);
  await project.refresh();
  assert.equal(tree.children[1].children[1].children.length, 0);
});

test("creates a file within selected root and opens it", async () => {
  const root = dir("work");
  const opened = [];
  const { tree, project } = setup(root, async (handle, path) => {
    opened.push([handle, path]);
    return true;
  });
  await project.choose();
  assert.equal(await project.create("new.flow"), true);
  assert.equal(opened[0][1], "work/new.flow");
  assert.equal(tree.children[1].textContent, "File: new.flow");
  await assert.rejects(project.create("../escape.py"), /Invalid source filename/);
});

test("folder picker failure leaves no project selected", async () => {
  const tree = new FakeElement("div");
  const errors = [];
  const project = createProjectExplorer({ tree, status: (message, level) => errors.push([message, level]),
    openHandle: async () => {}, picker: async () => { throw new Error("permission denied"); } });
  assert.equal(await project.choose(), false);
  assert.equal(project.hasProject(), false);
  assert.deepEqual(errors, [["permission denied", "error"]]);
});
