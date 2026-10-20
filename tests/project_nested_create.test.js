"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {createProjectExplorer} = require("../web/project.js");
global.document = {createElement: tag => ({tag, children: [], textContent: "",
  append(...nodes) { this.children.push(...nodes); },
  replaceChildren(...nodes) { this.children = nodes; },
  addEventListener() {}})};
function directory(name, initial = []) {
  const entries = new Map(initial);
  return {kind: "directory", name,
    async *entries() {yield* entries.entries();},
    async requestPermission() {return "granted";},
    async getDirectoryHandle(n) {
      if (!entries.has(n) || entries.get(n).kind !== "directory") throw Error("Folder not found");
      return entries.get(n);
    },
    async getFileHandle(n, opts = {}) {
      if (!entries.has(n) && opts.create) {
        const h = {kind: "file", name: n, async isSameEntry(other) {return other === h;}};
        entries.set(n, h);
      }
      if (!entries.has(n) || entries.get(n).kind !== "file") throw Error("File not found");
      return entries.get(n);
    },
    async removeEntry(n) {entries.delete(n);},
    has(n) {return entries.has(n);}
  };
}
async function setup(root, onOpen = async () => true) {
  const project = createProjectExplorer({tree: document.createElement("div"),
    status() {}, picker: async () => root, openHandle: onOpen});
  assert.equal(await project.choose(), true);
  return project;
}
test("nested source creation opens the exact project path", async () => {
  const src = directory("src"), root = directory("project", [["src", src]]);
  const opened = [];
  const project = await setup(root, async (handle, path) => {opened.push([handle, path]); return true;});
  assert.equal(await project.create("src/analysis.py"), true);
  assert.equal(opened[0][0], await src.getFileHandle("analysis.py"));
  assert.equal(opened[0][1], "project/src/analysis.py");
});
test("rejects traversal, missing parents and duplicate files", async () => {
  const src = directory("src"), root = directory("project", [["src", src]]);
  const project = await setup(root);
  for (const path of ["../x.py", "src/../x.py", "src/evil.exe", "src\\x.py", "src//x.py"])
    await assert.rejects(project.create(path), /Invalid/);
  await assert.rejects(project.create("missing/x.py"), /not found/);
  await project.create("src/existing.R");
  await assert.rejects(project.create("src/existing.R"), /already exists/);
});
test("requires write permission on destination directory", async () => {
  const src = directory("src"), root = directory("project", [["src", src]]);
  src.requestPermission = async () => "denied";
  const project = await setup(root);
  await assert.rejects(project.create("src/denied.py"), /Write permission/);
  assert.equal(src.has("denied.py"), false);
});
test("declined editor opening rolls back the exact new file", async () => {
  const src = directory("src"), root = directory("project", [["src", src]]);
  const project = await setup(root, async () => false);
  assert.equal(await project.create("src/cancelled.py"), false);
  assert.equal(src.has("cancelled.py"), false);
});
test("failed editor reads roll back instead of leaving an orphan", async () => {
  const src = directory("src"), root = directory("project", [["src", src]]);
  const project = await setup(root, async () => {throw Error("read failed");});
  await assert.rejects(project.create("src/unreadable.py"), /read failed/);
  assert.equal(src.has("unreadable.py"), false);
});
test("does not delete a file replaced during a failed editor read", async () => {
  const src = directory("src"), root = directory("project", [["src", src]]);
  const project = await setup(root, async () => {
    await src.removeEntry("changed.py");
    await src.getFileHandle("changed.py", {create: true});
    throw Error("read failed");
  });
  await assert.rejects(project.create("src/changed.py"), /safely removed/);
  assert.equal(src.has("changed.py"), true);
});
