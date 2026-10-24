"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {parseCells, cellAt} = require("../docs/app/source_cells.js");
const nativeParser = require("../web/source_cells.js");
const {create} = require("../docs/app/notebook_runner.js");
const format = require("../docs/app/notebook_format.js");

const source = "# %% [python]\nx = 40\n# %% [r]\nx <- 2\n# %%\nprint(x + 2)\n";

test("source parser preserves explicit cell language, offsets, and native parser parity", () => {
  const cells = parseCells(source);
  assert.deepEqual(cells.map(cell => cell.language), ["python", "r", null]);
  assert.deepEqual(nativeParser.parseCells(source), cells);
  assert.equal(cellAt(source, source.indexOf("x <-")).language, "r");
  assert.equal(cells[0].code, "x = 40\n");
  assert.equal(cells[1].code, "x <- 2\n");
  assert.equal(cells[2].code, "print(x + 2)\n");
  assert.equal(parseCells("# %% [R]\ncat(1)")[0].language, "r");
  assert.equal(parseCells("# %% [markdown]\n# %% [r]\nTitle")[0].kind, "markdown");
});

test("quoted percent markers never create executable language boundaries", () => {
  const py = 's = """\n# %% [r]\nnot a boundary\n"""\n# %% [python]\nprint(s)';
  const r = 's <- "# %% [python]\nnot a boundary"\n# %% [r]\ncat(s)';
  assert.deepEqual(parseCells(py).map(cell => cell.language), [null, "python"]);
  assert.deepEqual(parseCells(r).map(cell => cell.language), [null, "r"]);
});

test("runs mixed Python/R cells sequentially in their independent persistent runtimes", async () => {
  const state = {python:0, r:0}, calls = [], entries = [], notices = [];
  const runner = create({parseCells,
    execute:async (code, language) => {
      calls.push(language);
      if (language === "python") state.python++;
      else if (language === "r") state.r++;
      return {ok:true, output:language + ":" + (language === "r" ? state.r : state.python)};
    },
    onCell:entry=>entries.push(entry), notice:message=>notices.push(message)});
  assert.deepEqual(await runner.run(source, "python"), {ok:true, executed:3});
  assert.deepEqual(calls, ["python", "r", "python"]);
  assert.deepEqual(entries.map(entry => entry.language), ["python", "r", "python"]);
  assert.deepEqual(entries.map(entry => entry.output), ["python:1", "r:1", "python:2"]);
  assert.ok(notices.some(message => message.includes("Running r notebook cell")));
});

test("explicit Flow cell refuses hosted execution before any interpreter side effects", async () => {
  let count = 0;
  const runner = create({parseCells, execute:async()=>{count++;return {ok:true};},
    onCell:()=>{}, notice:()=>{}});
  const result = await runner.run("# %% [python]\nprint(1)\n# %% [flow]\nfunction main() -> i32 { return 0 }", "python");
  assert.equal(result.ok, false);
  assert.match(result.error, /native Flow server/);
  assert.equal(count, 0);
});

test("native Flow opt-in dispatches tagged Flow cells without changing Python/R namespaces", async () => {
  const calls = [];
  const runner = create({parseCells, execute:async (code, language)=>{
    calls.push([language, code]);return {ok:true, output:"ok"};
  },onCell:()=>{},notice:()=>{},allowNativeFlow:true});
  const input = "# %% [python]\nprint(1)\n# %% [flow]\nfunction main() -> i32 { return 0 }\n# %% [r]\ncat(2)";
  assert.deepEqual(await runner.run(input,"python"), {ok:true,executed:3});
  assert.deepEqual(calls.map(item=>item[0]), ["python","flow","r"]);
});

test("Flow default may be overridden by explicit Python/R tags without native Flow", async () => {
  const calls = [];
  const runner = create({parseCells,execute:async (_,language)=>{calls.push(language);return {ok:true,output:"ok"};},
    onCell:()=>{},notice:()=>{}});
  const input = "# %% [python]\nprint(1)\n# %% [r]\ncat(1)";
  assert.equal((await runner.run(input,"flow")).ok,true);
  assert.deepEqual(calls, ["python","r"]);
});

test("mixed-language failures stop later cells and report the correct language", async () => {
  const calls = [], entries = [];
  const runner = create({parseCells,execute:async (_,language)=>{
    calls.push(language);return {ok:language !== "r",output:"R error"};
  },onCell:entry=>entries.push(entry),notice:()=>{}});
  const result = await runner.run(source,"python");
  assert.deepEqual(result,{ok:false,executed:2,failedIndex:1,error:"Cell execution failed."});
  assert.deepEqual(calls,["python","r"]);
  assert.equal(entries[1].language,"r");
});

test("single-kernel Jupyter export rejects incompatible mixed-language cells", () => {
  assert.throws(()=>format.encode(source,"python",[],parseCells),/Mixed-language cells/);
  assert.throws(()=>format.encode(source,"r",[],parseCells),/Mixed-language cells/);
  const single = "# %% [python]\nx = 1\n# %%\nprint(x)";
  const exported = JSON.parse(format.encode(single,"python",[],parseCells));
  assert.equal(exported.cells.length,2);
  assert.equal(exported.metadata.language_info.name,"python");
});

test("real browser workspace wires per-cell execution, flow gating and language-aware output", () => {
  const html = fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html,/language = cell\.language \|\| language/);
  assert.match(html,/allowNativeFlow: globalThis\.FlowStudioNativeFlow\?\.available\?\.\(\) === true/);
  assert.match(html,/lastLanguage === "python" \|\| lastLanguage === "r"/);
  assert.match(html,/entry\.language \? " \("/);
  const start=html.indexOf("<script>"), end=html.indexOf("</script>",start);
  assert.doesNotThrow(()=>new vm.Script(html.slice(start+8,end)));
});
