"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Project = require("../docs/app/project.js");
const Save = require("../docs/app/file_save.js");
const Workspace = require("../docs/app/project_workspace.js");

function node() {
  const listeners = {};
  return {
    children: [], disabled: false, textContent: "", value: "", open: false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, callback) { listeners[name] = callback; },
    click() { return listeners.click?.(); }
  };
}
function file(name, content) {
  return {
    kind: "file", name, content,
    async getFile() {
      return {size: Buffer.byteLength(this.content), text: async () => this.content};
    },
    async isSameEntry(other) { return this === other; },
    async createWritable() {
      let staged = "";
      return {
        write: async text => { staged = text; },
        close: async () => { this.content = staged; },
        abort: async () => {}
      };
    }
  };
}
function directory(name, files) {
  return {
    kind: "directory", name, files: new Map(files),
    async *entries() { yield* this.files; },
    async getFileHandle(filename, {create} = {}) {
      if (create && !this.files.has(filename)) this.files.set(filename, file(filename, ""));
      const entry = this.files.get(filename);
      if (!entry || entry.kind !== "file") throw Error("File not found");
      return entry;
    },
    async removeEntry(filename) {
      if (!this.files.delete(filename)) throw Error("File not found");
    }
  };
}
function fixture(confirmChange = () => true) {
  const previousDocument = global.document;
  global.document = {createElement: () => node()};
  const source = node(), filename = node(), language = node(), tree = node();
  source.value = "initial"; language.value = "python";
  const nested = directory("sub", [["nested.py", file("nested.py", "print(17)") ]]);
  const root = directory("research", [
    ["main.flow", file("main.flow", "function main() -> i32 { return 0 }")],
    ["sub", nested]
  ]);
  const buttons = {
    openFolderButton: node(), saveFileButton: node(),
    newFileButton: node(), deleteFileButton: node()
  };
  const messages = [], names = [];
  const controller = Workspace.create({
    projectApi: Project, fileSaveApi: Save, source, filename, language, tree,
    ...buttons, status: message => messages.push(message),
    onDraft: () => {}, setFilename: (name, display) => {
      filename.textContent = display;
      names.push(name);
    },
    picker: async () => root, confirmChange, promptName: () => "created.flow"
  });
  return {
    source, filename, language, tree, root, nested, buttons, messages, names, controller,
    async open(name = "main.flow") {
      const entry = tree.children.find(item => item.textContent === "File: " + name);
      assert.ok(entry, "project explorer must expose " + name);
      await entry.click();
    },
    cleanup() { global.document = previousDocument; }
  };
}

test("confirmed deletion removes only the open file and retains its editor source", async () => {
  const f = fixture();
  try {
    assert.equal(await f.controller.choose(), true);
    await f.open();
    assert.equal(f.buttons.deleteFileButton.disabled, false);
    const original = f.source.value;
    assert.equal(await f.controller.deleteFile(), true);
    assert.equal(f.root.files.has("main.flow"), false);
    assert.equal(f.root.files.has("sub"), true);
    assert.equal(f.source.value, original);
    assert.equal(f.filename.textContent, "untitled.flow");
    assert.equal(f.controller.hasActiveFile(), false);
    assert.equal(f.buttons.deleteFileButton.disabled, true);
    assert.equal(f.buttons.saveFileButton.disabled, true);
    assert.match(f.messages.join(" "), /retained as an unsaved copy/);
  } finally { f.cleanup(); }
});
test("dirty editor refuses deletion without prompting", async () => {
  let confirms = 0;
  const f = fixture(() => { confirms++; return true; });
  try {
    await f.controller.choose();
    await f.open();
    f.source.value += "\nunsaved";
    assert.equal(await f.controller.deleteFile(), false);
    assert.equal(confirms, 0);
    assert.equal(f.root.files.has("main.flow"), true);
    assert.match(f.messages.join(" "), /unsaved changes/);
  } finally { f.cleanup(); }
});
test("externally modified file refuses deletion and preserves the active handle", async () => {
  const f = fixture();
  try {
    await f.controller.choose(); await f.open();
    f.root.files.get("main.flow").content = "external";
    assert.equal(await f.controller.deleteFile(), false);
    assert.equal(f.controller.hasActiveFile(), true);
    assert.equal(f.root.files.has("main.flow"), true);
    assert.match(f.messages.join(" "), /changed on disk/);
  } finally { f.cleanup(); }
});
test("replaced file handle is not deleted even when text matches", async () => {
  const f = fixture();
  try {
    await f.controller.choose(); await f.open();
    const original = f.root.files.get("main.flow");
    f.root.files.set("main.flow", file("main.flow", original.content));
    assert.equal(await f.controller.deleteFile(), false);
    assert.equal(f.root.files.has("main.flow"), true);
    assert.match(f.messages.join(" "), /replaced or cannot be verified/);
  } finally { f.cleanup(); }
});
test("cancelling confirmation leaves project and editor unchanged", async () => {
  const f = fixture(() => false);
  try {
    await f.controller.choose(); await f.open();
    assert.equal(await f.controller.deleteFile(), false);
    assert.equal(f.controller.hasActiveFile(), true);
    assert.equal(f.root.files.has("main.flow"), true);
  } finally { f.cleanup(); }
});
test("filesystem permission failure does not detach the editor", async () => {
  const f = fixture();
  try {
    await f.controller.choose(); await f.open();
    f.root.removeEntry = async () => { throw Error("Permission denied"); };
    assert.equal(await f.controller.deleteFile(), false);
    assert.equal(f.controller.hasActiveFile(), true);
    assert.equal(f.root.files.has("main.flow"), true);
    assert.match(f.messages.join(" "), /Permission denied/);
  } finally { f.cleanup(); }
});
test("delete cannot race an in-flight save", async () => {
  const f = fixture();
  try {
    await f.controller.choose(); await f.open();
    const handle = f.root.files.get("main.flow");
    let release, started;
    const startedPromise = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    handle.createWritable = async () => ({
      write: async () => { started(); await gate; },
      close: async () => { handle.content = f.source.value; },
      abort: async () => {}
    });
    f.source.value = "modified";
    const saving = f.controller.save();
    await startedPromise;
    assert.equal(await f.controller.deleteFile(), false);
    assert.equal(f.root.files.has("main.flow"), true);
    release();
    assert.equal(await saving, true);
    assert.equal(f.root.files.get("main.flow").content, "modified");
  } finally { f.cleanup(); }
});
test("nested source deletion is scoped to its parent directory", async () => {
  const f = fixture();
  try {
    await f.controller.choose();
    assert.equal(await f.controller.openHandle(
      f.nested.files.get("nested.py"), "research/sub/nested.py", f.nested), true);
    assert.equal(await f.controller.deleteFile(), true);
    assert.equal(f.nested.files.has("nested.py"), false);
    assert.equal(f.root.files.has("sub"), true);
    assert.equal(f.root.files.has("main.flow"), true);
  } finally { f.cleanup(); }
});
test("changing project detaches the old active file handle", async () => {
  const f = fixture();
  try {
    await f.controller.choose(); await f.open();
    assert.equal(await f.controller.choose(), true);
    assert.equal(f.controller.hasActiveFile(), false);
    assert.equal(f.buttons.deleteFileButton.disabled, true);
    assert.equal(await f.controller.deleteFile(), false);
    assert.equal(f.root.files.has("main.flow"), true);
  } finally { f.cleanup(); }
});
test("browser workspace exposes the deletion control without changing CI", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(html, /id="deleteProjectFile"/);
  assert.match(html, /deleteFileButton: \$\("deleteProjectFile"\)/);
});

test("deletion fails closed when the browser cannot verify file identity", async () => {
  const f = fixture();
  try {
    await f.controller.choose(); await f.open();
    delete f.root.files.get("main.flow").isSameEntry;
    assert.equal(await f.controller.deleteFile(), false);
    assert.equal(f.root.files.has("main.flow"), true);
    assert.equal(f.controller.hasActiveFile(), true);
    assert.match(f.messages.at(-1), /cannot be verified/);
  } finally { f.cleanup(); }
});

test("edits typed during the final deletion read cannot be discarded", async () => {
  const f = fixture();
  try {
    await f.controller.choose(); await f.open();
    const handle = f.root.files.get("main.flow");
    const read = handle.getFile.bind(handle);
    let reads = 0, entered, release;
    const enteredFinalRead = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    handle.getFile = async () => {
      if (++reads === 2) { entered(); await gate; }
      return read();
    };
    const pending = f.controller.deleteFile();
    await enteredFinalRead;
    f.source.value += "\nnew unsaved change";
    release();
    assert.equal(await pending, false);
    assert.equal(f.root.files.has("main.flow"), true);
    assert.equal(f.controller.hasActiveFile(), true);
    assert.match(f.messages.at(-1), /Editor changed during deletion/);
  } finally { f.cleanup(); }
});
