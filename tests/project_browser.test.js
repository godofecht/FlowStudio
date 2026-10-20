"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createProjectExplorer, validFilename, validFolderName } = require("../web/project.js");

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

function file(name) {
  const handle = { kind: "file", name, async isSameEntry(other) { return other === handle; } };
  return handle;
}
function dir(name, initial = []) {
  const entries = new Map(initial);
  return {
    kind: "directory", name,
    async *entries() { yield* entries.entries(); },
    async getFileHandle(filename, { create } = {}) {
      if (!entries.has(filename) && create) entries.set(filename, file(filename));
      const handle = entries.get(filename);
      if (!handle || handle.kind !== "file") throw new Error("File not found");
      return handle;
    },
    async getDirectoryHandle(filename, { create } = {}) {
      if (!entries.has(filename) && create) entries.set(filename, dir(filename));
      const handle = entries.get(filename);
      if (!handle || handle.kind !== "directory") throw new Error("Folder not found");
      return handle;
    },
    async requestPermission() { return "granted"; },
    async removeEntry(filename) {
      if (!entries.has(filename)) throw new Error("File not found");
      entries.delete(filename);
    },
  };
}
function setup(root, onOpen = async () => true, onDeleted = () => {}) {
  const tree = new FakeElement("div");
  const statuses = [];
  const project = createProjectExplorer({
    tree, status: (...args) => statuses.push(args), openHandle: onOpen,
    picker: async () => root, onDeleted,
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

test("deletes the exact opened file in a nested browser-granted folder", async () => {
  const target = file("model.py");
  const nested = dir("src", [["model.py", target]]);
  const root = dir("work", [["src", nested]]);
  const deleted = [];
  const { project, statuses } = setup(root, async () => true,
    (handle, path) => deleted.push([handle, path]));
  await project.choose();
  assert.equal(await project.deleteFile("work/src/model.py", target), true);
  assert.deepEqual(deleted, [[target, "work/src/model.py"]]);
  await assert.rejects(nested.getFileHandle("model.py"), /not found/);
  assert.deepEqual(statuses.at(-1), ["Deleted work/src/model.py", "ok"]);
});

test("refuses stale handles, traversal, and out-of-project deletion", async () => {
  const target = file("model.py");
  const root = dir("work", [["model.py", target]]);
  const { project } = setup(root);
  await project.choose();
  await assert.rejects(project.deleteFile("work/model.py", file("model.py")), /changed/);
  await assert.rejects(project.deleteFile("other/model.py", target), /opened project/);
  await assert.rejects(project.deleteFile("work/../model.py", target), /Invalid project/);
  assert.equal(await root.getFileHandle("model.py"), target);
});

test("requires explicit write permission and never deletes on denial", async () => {
  const target = file("model.py");
  const root = dir("work", [["model.py", target]]);
  root.requestPermission = async () => "denied";
  const { project } = setup(root);
  await project.choose();
  await assert.rejects(project.deleteFile("work/model.py", target), /Write permission/);
  assert.equal(await root.getFileHandle("model.py"), target);
});

test("creates nested folders, rejects duplicates and traversal", async () => {
  const nested = dir("src"), root = dir("work", [["src", nested]]);
  const { project } = setup(root);
  await project.choose();
  assert.equal(await project.createFolder("src/generated"), true);
  assert.equal((await nested.getDirectoryHandle("generated")).name, "generated");
  await assert.rejects(project.createFolder("src/generated"), /already exists/);
  await assert.rejects(project.createFolder("../escape"), /Invalid/);
  await assert.rejects(project.createFolder("missing/child"), /not found/);
});
test("folder creation and new files require permission", async () => {
  const root = dir("work", [["existing.flow", file("existing.flow")]]);
  const { project } = setup(root);
  await project.choose();
  await assert.rejects(project.create("existing.flow"), /already exists/);
  root.requestPermission = async () => "denied";
  await assert.rejects(project.create("new.flow"), /Write permission/);
  await assert.rejects(project.createFolder("new"), /Write permission/);
  await assert.rejects(root.getFileHandle("new.flow"), /not found/);
});
test("folder path component validation", () => {
  for (const name of ["", ".", "..", "a/b", "foo\\bar", "CON", "AUX.txt", "a:b", " bad", "bad ", "bad.", "x".repeat(256)])
    assert.equal(validFolderName(name), false, name);
  assert.equal(validFolderName("Données"), true);
});
