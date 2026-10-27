"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Create = require("../docs/app/project_create.js");
const validFile = name => /\.(?:flow|py|r)$/i.test(name) && !/[\\/]/.test(name);
function error(name) { const e = new Error(name); e.name = name; return e; }
function file(name, content = "") {
  return {kind:"file", name, content, async getFile() {
    return {size:Buffer.byteLength(this.content), text:async()=>this.content};
  }};
}
function dir(name, entries = []) {
  return {kind:"directory", name, files:new Map(entries),
    async *entries() {yield* this.files;},
    async getFileHandle(name, options = {}) {
      const existing = this.files.get(name);
      if (existing && existing.kind !== "file") throw error("TypeMismatchError");
      if (existing) return existing;
      if (!options.create) throw error("NotFoundError");
      const created = file(name); this.files.set(name, created); return created;
    },
    async getDirectoryHandle(name, options = {}) {
      const existing = this.files.get(name);
      if (existing && existing.kind !== "directory") throw error("TypeMismatchError");
      if (existing) return existing;
      if (!options.create) throw error("NotFoundError");
      const created = dir(name); this.files.set(name, created); return created;
    }
  };
}
test("create nested Flow source only inside an existing project subfolder", async () => {
  const src = dir("src"), root = dir("research", [["src", src]]);
  const result = await Create.createFile(root, "src/main.flow", validFile);
  assert.equal(result.parent, src);
  assert.equal(result.path, "src/main.flow");
  assert.equal(result.handle, src.files.get("main.flow"));
  assert.equal(result.handle.content, "");
  assert.equal(root.files.has("main.flow"), false);
  await assert.rejects(Create.createFile(root, "missing/main.flow", validFile), /NotFoundError/);
  assert.equal(root.files.has("missing"), false);
});
test("folder creation and nested source creation work through granted handles", async () => {
  const root = dir("research");
  const created = await Create.createDirectory(root, "analysis");
  assert.equal(created.path, "analysis");
  assert.equal(root.files.get("analysis"), created.handle);
  const fileResult = await Create.createFile(root, "analysis/model.r", validFile);
  assert.equal(fileResult.parent, created.handle);
  await assert.rejects(Create.createDirectory(root, "analysis"), /already exists/);
});
test("existing files and directories are never silently reopened or overwritten", async () => {
  const existing = file("main.flow", "important code");
  const root = dir("research", [["main.flow", existing], ["src", dir("src")]]);
  await assert.rejects(Create.createFile(root, "main.flow", validFile), /already exists/);
  await assert.rejects(Create.createFile(root, "src", validFile), /Invalid source filename/);
  await assert.rejects(Create.createDirectory(root, "main.flow"), /already exists/);
  assert.equal(existing.content, "important code");
});
test("relative path validation rejects traversal, absolute paths, hidden races and reserved names", async () => {
  const root = dir("research");
  for (const path of ["../main.flow", "src/../main.flow", "./main.flow", "/main.flow",
    "src//main.flow", "src/", "src\\main.flow", "src/CON/main.flow",
    "src/a?.flow", "src/hello /main.flow", "a/".repeat(12) + "main.flow"])
    assert.equal(Create.validSourcePath(path, validFile), false, path);
  for (const path of ["..", "a/../b", "COM1", "NUL.txt", "folder/", "a\\b", "/a"])
    assert.equal(Create.validFolderPath(path), false, path);
  assert.equal(Create.validFolderPath("data/plots"), true);
  assert.equal(Create.validSourcePath("src/analysis.flow", validFile), true);
  await assert.rejects(Create.createDirectory(root, "../escape"), /invalid|relative/i);
  assert.equal(root.files.size, 0);
});
test("permission failures propagate and do not create a fallback file", async () => {
  const root = dir("research");
  root.getFileHandle = async () => { throw error("NotAllowedError"); };
  await assert.rejects(Create.createFile(root, "main.flow", validFile), /NotAllowedError/);
  assert.equal(root.files.size, 0);
});
test("raced nonempty file is refused instead of being attached as new", async () => {
  const root = dir("research");
  let lookups = 0;
  root.getFileHandle = async (name, options = {}) => {
    if (!options.create) {lookups++; throw error("NotFoundError");}
    const raced = file(name, "external data"); root.files.set(name, raced); return raced;
  };
  await assert.rejects(Create.createFile(root, "main.flow", validFile), /not empty/);
  assert.equal(lookups, 1);
  assert.equal(root.files.get("main.flow").content, "external data");
});
function element() {
  const listeners = {};
  return {children:[], textContent:"", className:"", type:"", title:"", open:false,
    append(...items) {this.children.push(...items);},
    replaceChildren(...items) {this.children = items;},
    addEventListener(event, listener) {listeners[event] = listener;},
    click() {return listeners.click?.();}
  };
}
test("project explorer integrates nested creation and refresh without opening existing files", async () => {
  const Project = require("../docs/app/project.js");
  const previous = global.document;
  global.document = {createElement:()=>element()};
  const root = dir("research");
  const tree = element(), opened = [], messages = [];
  try {
    const project = Project.createProjectExplorer({tree,
      status:message=>messages.push(message), picker:async()=>root,
      openHandle:async (handle, path, parent)=>{opened.push({handle,path,parent});return true;}});
    assert.equal(await project.choose(), true);
    assert.equal(await project.createFolder("src"), true);
    assert.equal(root.files.get("src").kind, "directory");
    assert.equal(await project.create("src/model.flow"), true);
    assert.equal(opened.length, 1);
    assert.equal(opened[0].path, "research/src/model.flow");
    assert.equal(opened[0].parent, root.files.get("src"));
    await assert.rejects(project.create("src/model.flow"), /already exists/);
    assert.equal(opened.length, 1);
    assert.ok(tree.children.some(item=>item.textContent === "Project: research"));
  } finally {global.document = previous;}
});
test("browser app wires the folder action and loads its helper before project controller", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(html, /id="newProjectFolder"/);
  assert.match(html, /newFolderButton:\s*\$\("newProjectFolder"\)/);
  assert.ok(html.indexOf('src="./project_create.js"') < html.indexOf('src="./project.js"'));
  const workspace = fs.readFileSync(path.join(__dirname, "../docs/app/project_workspace.js"), "utf8");
  assert.match(workspace, /newFolderButton\.addEventListener\("click"/);
  assert.match(workspace, /async function createFolder\(/);
});
