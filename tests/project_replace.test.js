"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const native = require("../web/project.js");
const pages = require("../docs/app/project.js");

function file(name, initial, {failWrite = false} = {}) {
  let contents = initial;
  return {
    kind: "file", name,
    get contents() { return contents; },
    set contents(value) { contents = value; },
    async getFile() {
      return { size: Buffer.byteLength(contents), async text() { return contents; } };
    },
    async createWritable() {
      if (failWrite) throw new Error("write denied");
      let pending = contents;
      return {
        async write(value) { pending = value; },
        async close() { contents = pending; },
        async abort() {}
      };
    }
  };
}
function directory(name, children) {
  return { kind: "directory", name, async *entries() { yield* children; } };
}
function corpus() {
  const r = file("analysis.R", "x <- 1\nx <- 2\n");
  const py = file("model.py", "x = 2\n");
  return { r, py, root: directory("work", [
    ["src", directory("src", [["analysis.R", r]])], ["model.py", py]
  ]) };
}

for (const [name, api] of [["native", native], ["Pages", pages]]) {
  test(name + " previews without writing, then applies verified literal replacements", async () => {
    const {root, r, py} = corpus();
    const plan = await api.planProjectReplace(root, "x", "alpha");
    assert.equal(plan.matches, 3);
    assert.equal(plan.files.length, 2);
    assert.equal(r.contents, "x <- 1\nx <- 2\n");
    assert.equal(py.contents, "x = 2\n");
    const result = await api.applyProjectReplacement(plan);
    assert.deepEqual(result, {files: 2, matches: 3});
    assert.equal(r.contents, "alpha <- 1\nalpha <- 2\n");
    assert.equal(py.contents, "alpha = 2\n");
  });
  test(name + " supports named regex captures, Unicode words and empty replacement", async () => {
    const r = file("analysis.R", "α <- 1\nαβ <- 2\nα <- 3\n");
    const root = directory("work", [["analysis.R", r]]);
    const plan = await api.planProjectReplace(root, String.raw`(?<name>α) <- (\d+)`,
      "$<name> = $2", {regex:true,wholeWord:true});
    assert.equal(plan.matches, 2);
    await api.applyProjectReplacement(plan);
    assert.equal(r.contents, "α = 1\nαβ <- 2\nα = 3\n");
    const deletePlan = await api.planProjectReplace(root, "α = ", "");
    await api.applyProjectReplacement(deletePlan);
    assert.equal(r.contents, "1\nαβ <- 2\n3\n");
  });
  test(name + " rejects stale previews before writing any files", async () => {
    const {root, r, py} = corpus();
    const plan = await api.planProjectReplace(root, "x", "z");
    py.contents = "external change";
    await assert.rejects(api.applyProjectReplacement(plan), /File changed since preview; no files replaced/);
    assert.equal(r.contents, "x <- 1\nx <- 2\n");
    assert.equal(py.contents, "external change");
  });
  test(name + " blocks editor-open handles before any writes", async () => {
    const {root, r, py} = corpus();
    const plan = await api.planProjectReplace(root, "x", "z");
    await assert.rejects(api.applyProjectReplacement(plan, {
      isBlocked: entry => entry.handle === py
    }), /Close the open editor tab/);
    assert.equal(r.contents, "x <- 1\nx <- 2\n");
  });
  test(name + " rejects incomplete search, oversized files and invalid regex", async () => {
    const many = file("many.R", "x ".repeat(201));
    await assert.rejects(api.planProjectReplace(directory("work", [["many.R", many]]),
      "x", "z"), /search was incomplete/);
    const large = file("huge.R", "x".repeat(140000));
    await assert.rejects(api.planProjectReplace(directory("work", [["huge.R", large]]),
      "x", "z", {regex:true}), /search was incomplete/);
    await assert.rejects(api.planProjectReplace(directory("work", [["many.R", many]]),
      "(", "z", {regex:true}), /Invalid regular expression/);
  });
  test(name + " rejects stale match coordinates during preview", async () => {
    const target = file("analysis.R", "x <- 1");
    const root = directory("work", [["analysis.R", target]]);
    const original = target.getFile.bind(target);
    let reads = 0;
    target.getFile = async () => {
      reads++;
      if (reads === 2) target.contents = "y <- 1";
      return original();
    };
    await assert.rejects(api.planProjectReplace(root, "x", "z"), /File changed since search/);
  });
  test(name + " reports partial writes without claiming atomic multi-file replacement", async () => {
    const a = file("a.R", "x <- 1");
    const b = file("b.R", "x <- 2", {failWrite:true});
    const plan = await api.planProjectReplace(directory("work", [["a.R", a], ["b.R", b]]),
      "x", "z");
    await assert.rejects(api.applyProjectReplacement(plan), /stopped after 1 files.*earlier writes remain/);
    assert.equal(a.contents, "z <- 1");
    assert.equal(b.contents, "x <- 2");
  });
  test(name + " honours abort before touching files", async () => {
    const {root, r} = corpus();
    const plan = await api.planProjectReplace(root, "x", "z");
    await assert.rejects(api.applyProjectReplacement(plan, {signal:{aborted:true}}),
      error => error.name === "AbortError");
    assert.equal(r.contents, "x <- 1\nx <- 2\n");
  });
  test(name + " preserves unchanged files without opening writers", async () => {
    const r = file("analysis.R", "x");
    r.createWritable = async () => { throw new Error("writer must not open"); };
    const plan = await api.planProjectReplace(directory("work", [["analysis.R", r]]), "x", "x");
    assert.equal(plan.matches, 1);
    assert.equal(plan.files.length, 0);
    assert.deepEqual(await api.applyProjectReplacement(plan), {files:0,matches:0});
  });
}

for (const [name, api] of [["native", native], ["Pages", pages]]) {
  function controller(root) {
    const previous = global.document;
    global.document = {createElement() {
      return {append() {}, addEventListener() {}, replaceChildren() {}};
    }};
    const explorer = api.createProjectExplorer({
      tree:{append() {}, replaceChildren() {}}, status() {},
      openHandle:async()=>true, picker:async()=>root
    });
    return {explorer, cleanup() {global.document=previous;}};
  }
  test(name + " restores the last verified project-wide replacement once", async () => {
    const {root,r,py}=corpus(), {explorer,cleanup}=controller(root);
    try {
      await explorer.choose();
      assert.deepEqual(await explorer.applyReplace(await explorer.previewReplace("x","z")),
        {files:2,matches:3});
      assert.equal(explorer.hasUndoReplace(),true);
      assert.deepEqual(await explorer.undoReplace(),{files:2,matches:3});
      assert.equal(r.contents,"x <- 1\nx <- 2\n");
      assert.equal(py.contents,"x = 2\n");
      assert.equal(explorer.hasUndoReplace(),false);
      await assert.rejects(explorer.undoReplace(),/No completed project replacement/);
    } finally {cleanup();}
  });
  test(name + " undo refuses changed files before writing any earlier files", async () => {
    const {root,r,py}=corpus(), {explorer,cleanup}=controller(root);
    try {
      await explorer.choose();
      await explorer.applyReplace(await explorer.previewReplace("x","z"));
      py.contents="external edit";
      await assert.rejects(explorer.undoReplace(),/File changed since preview; no files replaced/);
      assert.equal(r.contents,"z <- 1\nz <- 2\n");
      assert.equal(py.contents,"external edit");
      assert.equal(explorer.hasUndoReplace(),false);
    } finally {cleanup();}
  });
  test(name + " undo blocks open editor tabs", async () => {
    const {root,r}=corpus(), {explorer,cleanup}=controller(root);
    try {
      await explorer.choose();
      await explorer.applyReplace(await explorer.previewReplace("x","z"));
      await assert.rejects(explorer.undoReplace({isBlocked:entry=>entry.handle===r}),
        /Close the open editor tab/);
      assert.equal(r.contents,"z <- 1\nz <- 2\n");
      assert.equal(explorer.hasUndoReplace(),false);
    } finally {cleanup();}
  });
  test(name + " changing projects discards undo history", async () => {
    const {root}=corpus(), {explorer,cleanup}=controller(root);
    try {
      await explorer.choose();
      await explorer.applyReplace(await explorer.previewReplace("x","z"));
      assert.equal(explorer.hasUndoReplace(),true);
      await explorer.choose();
      assert.equal(explorer.hasUndoReplace(),false);
    } finally {cleanup();}
  });
  test(name + " failed multi-file replacement never enables undo", async () => {
    const a=file("a.R","x"),b=file("b.R","x",{failWrite:true});
    const {explorer,cleanup}=controller(directory("work",[["a.R",a],["b.R",b]]));
    try {
      await explorer.choose();
      await assert.rejects(explorer.applyReplace(await explorer.previewReplace("x","z")),
        /earlier writes remain/);
      assert.equal(explorer.hasUndoReplace(),false);
    } finally {cleanup();}
  });
}
