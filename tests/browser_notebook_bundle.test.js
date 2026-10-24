"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const format = require("../docs/app/notebook_format.js");
const {parseCells} = require("../docs/app/source_cells.js");
const {create} = require("../docs/app/notebook_io.js");

const SOURCE = "# %% [python]\r\nx = 2\r\n# %% [r]\r\ncat(3)\r\n" +
  "# %% [flow]\r\nfunction main() -> i32 { return 0 }\r\n";
const RESULTS = [
  {index:0, kind:"code", language:"python", ok:true, output:"π = 2\n", truncated:false, plots:[]},
  {index:1, kind:"code", language:"r", ok:true, output:"3", truncated:false,
    plots:[{png:"iVBORw0KGgoAAAA="}]},
  {index:2, kind:"code", language:"flow", ok:false, output:"Compiler error", truncated:false, plots:[]}
];

test("portable bundle round-trips exact CRLF source, three runtimes and saved outputs", () => {
  const json = format.encodeBundle(SOURCE, "python", RESULTS, parseCells);
  const decoded = format.decodeBundle(json, parseCells);
  assert.equal(decoded.source, SOURCE);
  assert.equal(decoded.language, "python");
  assert.deepEqual(decoded.entries.map(e => [e.index, e.language, e.ok, e.output]),
    [[0,"python",true,"π = 2\n"],[1,"r",true,"3"],[2,"flow",false,"Compiler error"]]);
  assert.equal(decoded.entries[1].plots[0].png, "iVBORw0KGgoAAAA=");
  assert.ok(decoded.entries.every(e => e.kind === "code" && Array.isArray(e.images)));
  assert.equal(JSON.parse(json).format, "flowstudio-notebook");
  assert.equal(JSON.parse(json).version, 1);
});

test("bundles preserve markdown and unexecuted code without inventing results", () => {
  const source = "# %% [markdown]\n# Notes\n# %% [flow]\nfunction main() -> i32 { return 0 }\n";
  const json = format.encodeBundle(source, "r", [], parseCells);
  const result = format.decodeBundle(json, parseCells);
  assert.equal(result.source, source);
  assert.deepEqual(result.entries, []);
  assert.equal(parseCells(result.source)[0].kind, "markdown");
});

test("reject forged results, wrong language, duplicates and non-code cells", () => {
  const base = JSON.parse(format.encodeBundle(SOURCE, "python", RESULTS, parseCells));
  function invalid(mutator) {
    const object = structuredClone(base);
    mutator(object);
    assert.throws(() => format.decodeBundle(JSON.stringify(object), parseCells));
  }
  invalid(o => {o.results[1].language = "python";});
  invalid(o => {o.results[1].index = 0;});
  invalid(o => {o.results[0].index = 900;});
  invalid(o => {o.results[0].extra = "surprise";});
  invalid(o => {o.results[1].plots[0].src = "javascript:alert(1)";});
  invalid(o => {o.results[0].output = "x".repeat(131073);});
  invalid(o => {o.results[1].plots[0].png = "not-a-png";});
  invalid(o => {o.language = "javascript";});
  invalid(o => {o.version = 2;});
  invalid(o => {o.extra = true;});
  invalid(o => {o.source = "# %% [markdown]\nhello\n" + o.source;});
  assert.throws(() => format.decodeBundle("invalid", parseCells));
  assert.throws(() => format.decodeBundle("{}".repeat(2200000), parseCells));
});

test("encode refuses mismatched or oversized result snapshots instead of dropping data", () => {
  assert.throws(() => format.encodeBundle(SOURCE, "python",
    [{...RESULTS[0], language:"r"}], parseCells));
  assert.throws(() => format.encodeBundle(SOURCE, "python",
    [{...RESULTS[0], output:"x".repeat(131073)}], parseCells));
  assert.throws(() => format.encodeBundle(SOURCE, "python",
    [RESULTS[1], RESULTS[0]], parseCells));
  assert.throws(() => format.encodeBundle(SOURCE, "python",
    new Array(129).fill(RESULTS[0]), parseCells));
  assert.throws(() => format.encodeBundle(SOURCE, "javascript", [], parseCells));
});

function button() {
  const handlers = {};
  return {
    addEventListener(type, fn) {handlers[type] = fn;},
    click() {return handlers.click?.();},
    change(files) {const event = {target:{files, value:"old"}}; return handlers.change(event);}
  };
}
function fixture() {
  const controls = {
    openButton:button(), fileInput:button(), saveButton:button(),
    bundleOpenButton:button(), bundleFileInput:button(), bundleSaveButton:button()
  };
  const source = {value:SOURCE}, language = {value:"python"};
  const exports = [], imports = [], notices = [];
  let busy = false, allowed = true;
  create({...controls, source, language, format, parseCells,
    isBusy:()=>busy, canReplace:()=>allowed,
    onImported:async (data, name)=>{imports.push([data,name]);source.value=data.source;language.value=data.language;},
    onExport:(json,name)=>exports.push([json,name]),
    getResults:()=>RESULTS, getFilename:()=>"study.flow", notice:s=>notices.push(s)});
  return {...controls, source, language, exports, imports, notices,
    busy:value=>{busy=value;}, allow:value=>{allowed=value;}};
}
function file(text, name="study.fsnb") {
  return {name, size:new TextEncoder().encode(text).length, text:async()=>text};
}

test("browser controls export and import a portable bundle without executing cells", async () => {
  const f = fixture();
  f.bundleSaveButton.click();
  assert.equal(f.exports.length, 1);
  assert.equal(f.exports[0][1], "study.fsnb");
  const json = f.exports[0][0];
  f.source.value = "changed";
  await f.bundleFileInput.change([file(json)]);
  assert.equal(f.imports.length, 1);
  assert.equal(f.imports[0][1], "study.fsnb");
  assert.equal(f.source.value, SOURCE);
  assert.equal(f.imports[0][0].entries.length, 3);
  assert.match(f.notices.at(-1), /interpreter state was not restored/);
});

test("browser controls do not import when busy, oversized, invalid or declined", async () => {
  const f = fixture();
  const json = format.encodeBundle(SOURCE, "python", RESULTS, parseCells);
  f.busy(true);
  await f.bundleFileInput.change([file(json)]);
  f.bundleSaveButton.click();
  assert.equal(f.imports.length, 0);
  assert.equal(f.exports.length, 0);
  f.busy(false);
  f.allow(false);
  await f.bundleFileInput.change([file(json)]);
  assert.equal(f.imports.length, 0);
  f.allow(true);
  await f.bundleFileInput.change([{name:"huge.fsnb",size:format.MAX_JSON_BYTES+1,text:async()=>json}]);
  await f.bundleFileInput.change([file("{not json}")]);
  assert.equal(f.imports.length, 0);
  assert.match(f.notices.join(" "), /import failed/);
});

test("actual Pages and native /app/ document wire the bundle controls", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  const routes = fs.readFileSync(path.join(__dirname, "../src/data_routes.flow"), "utf8");
  for (const id of ["openFlowNotebook", "flowNotebookFile", "saveFlowNotebook"])
    assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /bundleOpenButton:\$\("openFlowNotebook"\)/);
  assert.match(html, /FlowStudioNotebookFormat/);
  assert.match(routes, /\/app\/notebook_format\.js/);
  assert.match(routes, /\/app\/notebook_io\.js/);
  const start = html.indexOf("<script>"), end = html.indexOf("</script>", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotThrow(() => new vm.Script(html.slice(start+8, end)));
});
