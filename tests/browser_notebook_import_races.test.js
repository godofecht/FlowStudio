"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const format = require("../docs/app/notebook_format.js");
const {parseCells} = require("../docs/app/source_cells.js");
const {create} = require("../docs/app/notebook_io.js");
const rMarkdown = require("../docs/app/notebook_rmarkdown_import.js");
require("../docs/app/notebook_rmarkdown.js");
const quarto = require("../docs/app/notebook_quarto.js");

function control() {
  const handlers = {};
  return {
    addEventListener(type, handler) { handlers[type] = handler; },
    click() { return handlers.click?.(); },
    change(files) { return handlers.change({target:{files, value:"old"}}); }
  };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
const tick = String.fromCharCode(96).repeat(3);
const documents = {
  ipynb: JSON.stringify({nbformat:4, nbformat_minor:4,
    metadata:{language_info:{name:"python"}},
    cells:[{cell_type:"code",source:"print(17)",metadata:{},outputs:[]}]}),
  fsnb: format.encodeBundle("# %% [python]\nprint(23)\n", "python", [], parseCells),
  rmd: tick + "{r}\ncat(31)\n" + tick + "\n",
  qmd: tick + "{python}\nprint(47)\n" + tick + "\n"
};
function fixture(onImportedOverride = null) {
  const controls = {
    openButton:control(), fileInput:control(), saveButton:control(),
    bundleOpenButton:control(), bundleFileInput:control(), bundleSaveButton:control(),
    rMarkdownOpenButton:control(), rMarkdownFileInput:control(),
    quartoOpenButton:control(), quartoFileInput:control()
  };
  const source = {value:"original source"}, language = {value:"r"};
  const documentIdentity = {value:"document-A"};
  const imports = [], notices = [];
  create({...controls, source, language, format, parseCells, rMarkdown, quarto,
    isBusy:() => false, canReplace:() => true,
    getDocumentIdentity:() => documentIdentity.value,
    onImported:async (imported, name) => {
      if (onImportedOverride) await onImportedOverride(imported, name);
      imports.push({imported, name});
      source.value = imported.source;
      language.value = imported.language;
    },
    onExport:() => {}, getResults:() => [], getFilename:() => "analysis.r",
    notice:message => notices.push(message)});
  return {...controls, source, language, documentIdentity, imports, notices};
}
function inputFor(f, type) {
  return {ipynb:f.fileInput, fsnb:f.bundleFileInput,
    rmd:f.rMarkdownFileInput, qmd:f.quartoFileInput}[type];
}
function file(text, name="analysis", size=new TextEncoder().encode(text).length) {
  return {name, size, text:async () => text};
}
for (const type of Object.keys(documents)) {
  test(type + " stale read cannot overwrite a newer imported notebook", async () => {
    const f = fixture(), pending = deferred();
    const oldFile = {name:"old." + type, size:documents[type].length,
      text:() => pending.promise};
    const first = inputFor(f, type).change([oldFile]);
    await f.fileInput.change([file(documents.ipynb, "new.ipynb")]);
    pending.resolve(documents[type]);
    await first;
    assert.deepEqual(f.imports.map(entry => entry.name), ["new.ipynb"]);
    assert.match(f.source.value, /print\(17\)/);
    assert.equal(f.language.value, "python");
  });
  test(type + " pending read cannot overwrite a switched document with identical source", async () => {
    const f = fixture(), pending = deferred();
    const first = inputFor(f, type).change([{
      name:"old." + type, size:new TextEncoder().encode(documents[type]).length,
      text:() => pending.promise
    }]);
    f.documentIdentity.value = "document-B";
    pending.resolve(documents[type]);
    await first;
    assert.equal(f.imports.length, 0);
    assert.equal(f.source.value, "original source");
    assert.equal(f.language.value, "r");
    assert.match(f.notices.join(" "), /active document changed during file read/);
    await inputFor(f, type).change([file(documents[type], "fresh." + type)]);
    assert.deepEqual(f.imports.map(entry => entry.name), ["fresh." + type]);
  });
  test(type + " pending read cannot overwrite intervening editor edits", async () => {
    const f = fixture(), pending = deferred();
    const first = inputFor(f, type).change([{
      name:"old." + type, size:documents[type].length, text:() => pending.promise
    }]);
    f.source.value = "edited while reading";
    pending.resolve(documents[type]);
    await first;
    assert.equal(f.imports.length, 0);
    assert.equal(f.source.value, "edited while reading");
    assert.match(f.notices.join(" "), /editor changed during file read/);
  });
}
test("file byte budget checks decoded UTF-8 rather than trusting file.size", async () => {
  const f = fixture();
  const oversized = "λ".repeat(2 * 1024 * 1024 + 1);
  await f.fileInput.change([file(oversized, "forged.ipynb", 1)]);
  await f.rMarkdownFileInput.change([file(oversized, "forged.Rmd", 1)]);
  assert.equal(f.imports.length, 0);
  assert.equal(f.source.value, "original source");
  assert.equal(f.notices.filter(message => /byte limit/.test(message)).length, 2);
  await f.fileInput.change([file(documents.ipynb, "valid.ipynb")]);
  assert.deepEqual(f.imports.map(entry => entry.name), ["valid.ipynb"]);
});
test("only one import can apply while an asynchronous editor update is pending", async () => {
  const gate = deferred(), started = deferred();
  const f = fixture(async () => { started.resolve(); await gate.promise; });
  const first = f.fileInput.change([file(documents.ipynb, "first.ipynb")]);
  await started.promise;
  await f.quartoFileInput.change([file(documents.qmd, "second.qmd")]);
  assert.equal(f.imports.length, 0);
  assert.match(f.notices.join(" "), /Wait for notebook import to finish/);
  gate.resolve();
  await first;
  assert.deepEqual(f.imports.map(entry => entry.name), ["first.ipynb"]);
});
