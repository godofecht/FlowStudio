"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {create} = require("../docs/app/notebook_io.js");
const format = require("../docs/app/notebook_format.js");
const {parseCells} = require("../docs/app/source_cells.js");
const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");

function button() {
  const handlers = {};
  return {
    addEventListener(type, callback) { handlers[type] = callback; },
    click() { return handlers.click?.(); },
    change(files) { return handlers.change({target:{files, value:"previous"}}); }
  };
}
function notebook(source = "print(42)") {
  return JSON.stringify({nbformat:4, nbformat_minor:4,
    metadata:{language_info:{name:"python"}},
    cells:[{cell_type:"code", source, metadata:{}, outputs:[]}]});
}
test("workspace wires actual notebook modules, controls and syntactically valid bootstrap", () => {
  for (const id of ["openNotebook", "notebookFile", "saveNotebook"])
    assert.match(html, new RegExp('id="' + id + '"'));
  for (const file of ["notebook_runner.js", "notebook_format.js", "notebook_io.js"])
    assert.match(html, new RegExp('src="\\./' + file.replace(".", "\\.") + '"'));
  assert.ok(html.indexOf('src="./notebook_format.js"') < html.indexOf('src="./notebook_io.js"'));
  assert.match(html, /FlowStudioNotebookIO\\.create\\(/);
  assert.match(html, /getResults:\\(currentSource, selectedLanguage\\)/);
  assert.match(html, /projectWorkspace\\.notifyExternalOpen\\(\\)/);
  const script = html.match(/<script>\\s*([\\s\\S]*?)<\\/script>/);
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script[1]));
});
test("delayed notebook read cannot overwrite editor once execution starts", async () => {
  const openButton = button(), fileInput = button(), saveButton = button();
  let busy = false, imports = 0, confirms = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const messages = [];
  create({openButton, fileInput, saveButton,
    source:{value:"keep"}, language:{value:"python"}, format, parseCells,
    isBusy:() => busy, canReplace:() => { confirms++; return true; },
    onImported:async () => { imports++; }, onExport:() => {},
    getResults:() => [], getFilename:() => "study.py",
    notice:message => messages.push(message)});
  const json = notebook();
  const reading = fileInput.change([{name:"study.ipynb", size:json.length,
    text:async () => { await gate; return json; }}]);
  busy = true;
  release();
  await reading;
  assert.equal(imports, 0);
  assert.equal(confirms, 0);
  assert.match(messages.join(" "), /Wait for notebook execution/);
});
test("successful notebook import uses decoded source and export produces nbformat 4", async () => {
  const openButton = button(), fileInput = button(), saveButton = button();
  const source = {value:""}, language = {value:"r"}, exported = [];
  create({openButton, fileInput, saveButton, source, language, format, parseCells,
    isBusy:() => false, canReplace:() => true,
    onImported:async value => { source.value = value.source; language.value = value.language; },
    onExport:(json, filename) => exported.push({json:JSON.parse(json), filename}),
    getResults:() => [], getFilename:() => "study.py", notice:() => {}});
  const json = notebook("value = 17");
  await fileInput.change([{name:"study.ipynb", size:json.length, text:async () => json}]);
  assert.equal(language.value, "python");
  assert.match(source.value, /value = 17/);
  saveButton.click();
  assert.equal(exported.length, 1);
  assert.equal(exported[0].filename, "study.ipynb");
  assert.equal(exported[0].json.nbformat, 4);
  assert.equal(exported[0].json.cells[0].source, "value = 17");
});
test("invalid notebook data leaves editor unchanged", async () => {
  const openButton = button(), fileInput = button(), saveButton = button();
  const source = {value:"preserve"}, messages = [];
  create({openButton, fileInput, saveButton, source, language:{value:"python"},
    format, parseCells, isBusy:() => false, canReplace:() => true,
    onImported:async value => { source.value = value.source; }, onExport:() => {},
    getResults:() => [], getFilename:() => "study.py",
    notice:message => messages.push(message)});
  await fileInput.change([{name:"invalid.ipynb", size:5, text:async () => "nope"}]);
  assert.equal(source.value, "preserve");
  assert.match(messages.join(" "), /Notebook import failed/);
});
