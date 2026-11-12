"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Explorer = require("../web/ide_explorer.js");
const Workspace = require("../web/ide_workspace.js");
const Save = require("../web/file_save.js");

/* In-memory File System Access fake: enough of the handle surface the
 * explorer uses, with identity, NotFound/TypeMismatch errors and removeEntry. */
function notFound(name) { const e = new Error(name + " not found"); e.name = "NotFoundError"; return e; }
function mismatch(name) { const e = new Error(name + " is a directory"); e.name = "TypeMismatchError"; return e; }
function file(name, content = "") {
  return {
    kind: "file", name, content,
    async isSameEntry(other) { return this === other; },
    async getFile() { const text = this.content; return { size: Buffer.byteLength(text), text: async () => text }; },
    async createWritable() {
      let staged = this.content;
      return { write: async value => { staged = typeof value === "string" ? value : Buffer.from(value).toString("utf8"); },
        close: async () => { if (this.failWrites) throw new Error("disk full"); this.content = staged; }, abort: async () => {} };
    }
  };
}
function dir(name, children = []) {
  const entries = new Map(children.map(child => [child.name, child]));
  return {
    kind: "directory", name, entries_: entries,
    async isSameEntry(other) { return this === other; },
    async *entries() { yield* [...entries.entries()]; },
    async getFileHandle(child, options = {}) {
      const found = entries.get(child);
      if (found && found.kind === "directory") throw mismatch(child);
      if (found) return found;
      if (!options.create) throw notFound(child);
      const created = file(child);
      entries.set(child, created);
      return created;
    },
    async getDirectoryHandle(child, options = {}) {
      const found = entries.get(child);
      if (found && found.kind === "file") throw mismatch(child);
      if (found) return found;
      if (!options.create) throw notFound(child);
      const created = dir(child);
      entries.set(child, created);
      return created;
    },
    async removeEntry(child, options = {}) {
      const found = entries.get(child);
      if (!found) throw notFound(child);
      if (found.kind === "directory" && found.entries_.size && !options.recursive) {
        const e = new Error("not empty"); e.name = "InvalidModificationError"; throw e;
      }
      entries.delete(child);
    }
  };
}

test("folders sort before files with natural numeric order", () => {
  const items = [
    { name: "b10.flow", kind: "file" }, { name: "src", kind: "directory" },
    { name: "b2.flow", kind: "file" }, { name: "A.py", kind: "file" }, { name: "data", kind: "directory" }
  ];
  items.sort(Explorer.compareEntries);
  assert.deepEqual(items.map(item => item.name), ["data", "src", "A.py", "b2.flow", "b10.flow"]);
});

test("file badges distinguish the IDE's languages", () => {
  assert.equal(Explorer.fileBadge("main.flow").tone, "flow");
  assert.equal(Explorer.fileBadge("fit.R").tone, "r");
  assert.equal(Explorer.fileBadge("x.py").tone, "python");
  assert.equal(Explorer.fileBadge("report.qmd").tone, "markdown");
  assert.equal(Explorer.fileBadge("rows.csv").tone, "data");
  assert.equal(Explorer.fileBadge("photo.png").tone, "other");
});

test("loading hides VCS noise, keeps child identity and flattens expanded rows", async () => {
  const root = dir("proj", [dir(".git", [file("HEAD")]), dir("src", [file("b.flow"), file("a.flow")]),
    file("README.md"), file(".DS_Store")]);
  const tree = Explorer.createTree(root);
  await Explorer.loadChildren(tree);
  assert.deepEqual(tree.children.map(child => child.name), ["src", "README.md"]);
  const src = tree.children[0];
  assert.deepEqual(Explorer.visibleRows(tree).map(node => node.rel), ["src", "README.md"]);
  src.expanded = true;
  await Explorer.loadChildren(src);
  assert.deepEqual(Explorer.visibleRows(tree).map(node => node.rel), ["src", "src/a.flow", "src/b.flow", "README.md"]);
  assert.equal(src.children[0].depth, 2);
  await Explorer.loadChildren(tree);
  assert.equal(tree.children[0], src, "refresh keeps the expanded folder node");
  assert.equal(Explorer.findByRel(tree, "src/b.flow").name, "b.flow");
  assert.equal(Explorer.findByRel(tree, "src/missing"), null);
});

test("type-ahead finds the next matching row and wraps", () => {
  const rows = ["alpha", "beta", "bravo", "charlie"].map(name => ({ name }));
  assert.equal(Explorer.typeAheadIndex(rows, 0, "b"), 1);
  assert.equal(Explorer.typeAheadIndex(rows, 1, "b"), 2, "repeated single letter cycles");
  assert.equal(Explorer.typeAheadIndex(rows, 2, "b"), 1, "and wraps");
  assert.equal(Explorer.typeAheadIndex(rows, 1, "br"), 2, "longer prefix refines in place");
  assert.equal(Explorer.typeAheadIndex(rows, 0, "z"), -1);
});

test("a folder is never a valid drop target inside itself", () => {
  assert.equal(Explorer.isInside("src/a", "src"), true);
  assert.equal(Explorer.isInside("src", "src"), true);
  assert.equal(Explorer.isInside("srcx", "src"), false);
  assert.equal(Explorer.isInside("anything", ""), true);
});

test("moveFile copies, verifies and removes the original without handle.move", async () => {
  const moving = file("fit.R", "x <- 1\n");
  const from = dir("proj", [moving]);
  const to = dir("lib");
  const result = await Explorer.moveFile({ from, handle: moving, name: "fit.R", to, fileSave: Save });
  assert.equal(result.moved, true);
  assert.equal((await to.getFileHandle("fit.R")).content, "x <- 1\n");
  await assert.rejects(from.getFileHandle("fit.R"), { name: "NotFoundError" });
});

test("moveFile refuses to overwrite an existing destination file", async () => {
  const moving = file("fit.R", "new");
  const existing = file("fit.R", "keep me");
  const from = dir("proj", [moving]);
  const to = dir("lib", [existing]);
  await assert.rejects(Explorer.moveFile({ from, handle: moving, name: "fit.R", to, fileSave: Save }), /already exists/);
  assert.equal(existing.content, "keep me");
  assert.equal((await from.getFileHandle("fit.R")).content, "new");
});

test("moveFile uses the atomic handle.move when the browser offers it", async () => {
  const moving = file("a.py", "print(1)");
  const from = dir("proj", [moving]);
  const to = dir("lib");
  let calls = 0;
  moving.move = async (destination, name) => {
    calls++;
    from.entries_.delete("a.py");
    destination.entries_.set(name, moving);
  };
  const result = await Explorer.moveFile({ from, handle: moving, name: "a.py", to, fileSave: Save });
  assert.equal(calls, 1);
  assert.equal(result.handle, moving, "the same handle stays valid after an atomic move");
});

test("countEntries reports nested files and folders for delete confirmation", async () => {
  const root = dir("proj", [dir("a", [file("1.flow"), dir("b", [file("2.flow")])]), file("3.flow")]);
  assert.deepEqual(await Explorer.countEntries(root), { files: 3, folders: 2, capped: false });
});

test("open tabs follow a renamed folder to the new paths", () => {
  assert.equal(Workspace.remapPath("proj/src/a.flow", "proj/src", "proj/lib"), "proj/lib/a.flow");
  assert.equal(Workspace.remapPath("proj/src", "proj/src", "proj/lib"), "proj/lib");
  assert.equal(Workspace.remapPath("proj/srcx/a.flow", "proj/src", "proj/lib"), null);
});

test("resolveFile walks from the root to a fresh handle", async () => {
  const target = file("x.R", "1");
  const root = dir("proj", [dir("lib", [dir("deep", [target])])]);
  assert.equal(await Workspace.resolveFile(root, "proj/lib/deep/x.R"), target);
  await assert.rejects(Workspace.resolveFile(root, "proj/lib/none/x.R"), { name: "NotFoundError" });
});

test("createTree rejects a non-directory root", () => {
  assert.throws(() => Explorer.createTree(file("x.flow")), /Choose a folder/);
  assert.throws(() => Explorer.createTree(null), /Choose a folder/);
});

test("moveFolder renames by verified copy when handle.move is missing", async () => {
  const src = dir("src", [file("a.flow", "A"), dir("deep", [file("b.R", "B")])]);
  const root = dir("proj", [src]);
  const result = await Explorer.moveFolder({ from: root, handle: src, name: "src", to: root, nextName: "lib" });
  assert.equal(result.copied, true);
  await assert.rejects(root.getDirectoryHandle("src"), { name: "NotFoundError" });
  const lib = await root.getDirectoryHandle("lib");
  assert.equal((await lib.getFileHandle("a.flow")).content, "A");
  assert.equal((await (await lib.getDirectoryHandle("deep")).getFileHandle("b.R")).content, "B");
});

test("moveFolder keeps the original and removes the partial copy when a write fails", async () => {
  const broken = file("b.R", "B");
  const src = dir("src", [file("a.flow", "A"), broken]);
  const root = dir("proj", [src]);
  // Make writes into the new folder fail by flagging files as they are created.
  const originalGetDirectoryHandle = root.getDirectoryHandle.bind(root);
  root.getDirectoryHandle = async (name, options) => {
    const created = await originalGetDirectoryHandle(name, options);
    if (name === "lib") {
      const getFile = created.getFileHandle.bind(created);
      created.getFileHandle = async (child, opts) => {
        const handle = await getFile(child, opts);
        if (child === "b.R") handle.failWrites = true;
        return handle;
      };
    }
    return created;
  };
  await assert.rejects(Explorer.moveFolder({ from: root, handle: src, name: "src", to: root, nextName: "lib" }), /disk full/);
  await assert.rejects(originalGetDirectoryHandle("lib"), { name: "NotFoundError" }, "partial copy removed");
  assert.equal((await src.getFileHandle("a.flow")).content, "A", "original untouched");
});

test("moveFolder refuses an occupied destination name", async () => {
  const src = dir("src", [file("a.flow", "A")]);
  const root = dir("proj", [src, dir("lib")]);
  await assert.rejects(Explorer.moveFolder({ from: root, handle: src, name: "src", to: root, nextName: "lib" }), /already exists/);
  assert.equal((await root.getDirectoryHandle("src")).entries_.size, 1);
});

test("breadcrumb segments follow the document path", () => {
  assert.deepEqual(Workspace.crumbs({ path: "proj/src/a.flow", name: "a.flow" }).map(c => [c.name, c.path, c.current]),
    [["proj", "proj", false], ["src", "proj/src", false], ["a.flow", "proj/src/a.flow", true]]);
  assert.deepEqual(Workspace.crumbs({ path: null, name: "untitled.flow" }).map(c => c.name), ["untitled.flow"]);
  assert.deepEqual(Workspace.crumbs(null), []);
});
