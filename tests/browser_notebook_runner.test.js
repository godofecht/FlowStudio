"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {create} = require("../docs/app/notebook_runner.js");
const {parseCells} = require("../docs/app/source_cells.js");
function fixture(execute = async code => ({ok:true, output:code})) {
  const entries=[], messages=[];
  const runner=create({parseCells,execute,onCell:entry=>entries.push(entry),notice:message=>messages.push(message)});
  return {runner,entries,messages};
}
test("runs code cells in source order on the same selected runtime, preserving exact code",async()=>{
  const calls=[];
  const f=fixture(async (code,language)=>{calls.push([code,language]);return {ok:true,output:String(calls.length)};});
  const result=await f.runner.run("a <- 1\n# %%\nb <- a + 1\n# %%\nb\n","r");
  assert.deepEqual(calls,[["a <- 1\n","r"],["b <- a + 1\n","r"],["b\n","r"]]);
  assert.deepEqual(result,{ok:true,executed:3});
  assert.equal(f.entries.length,3);
});
test("markdown and empty code cells are not executed",async()=>{
  const calls=[];
  const f=fixture(async code=>{calls.push(code);return {ok:true,output:"ok"};});
  const result=await f.runner.run("# %% [markdown]\n# Notebook title\n# %%\n\n# %%\nprint(1)\n","python");
  assert.equal(result.executed,1);
  assert.deepEqual(calls,["print(1)\n"]);
  assert.equal(f.entries[0].kind,"markdown");
  assert.match(f.entries[0].code,/Notebook title/);
});
test("stops on the first interpreter error without running subsequent cells",async()=>{
  const calls=[];
  const f=fixture(async code=>{calls.push(code);return {ok:!code.includes("stop"),output:"failure"};});
  const result=await f.runner.run("x=1\n# %%\nstop()\n# %%\nprint('unreachable')","python");
  assert.equal(result.ok,false);
  assert.equal(result.failedIndex,1);
  assert.equal(result.executed,2);
  assert.equal(calls.length,2);
  assert.equal(f.entries[1].output,"failure");
});
test("runtime exceptions become failed cells",async()=>{
  const f=fixture(async()=>{throw Error("kernel unavailable");});
  const result=await f.runner.run("print(1)","python");
  assert.equal(result.ok,false);
  assert.match(f.entries[0].output,/kernel unavailable/);
});
test("rejects Flow without native opt-in, empty, oversized and too many cells before executing anything",async()=>{
  let calls=0;
  const f=fixture(async()=>{calls++;return {ok:true};});
  assert.match((await f.runner.run("x=1","flow")).error,/explicitly enabled native Flow/);
  assert.match((await f.runner.run("# %% [markdown]\n# hello","r")).error,/No executable/);
  assert.match((await f.runner.run("λ".repeat(33000),"r")).error,/64 KiB/);
  const source=Array.from({length:129},(_,i)=>"# %%\nx="+i).join("\n");
  assert.match((await f.runner.run(source,"python")).error,/128 executable/);
  assert.equal(calls,0);
});
test("serializes concurrent notebook attempts and cancels in-flight output",async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const bitmap={closed:false,close(){this.closed=true;}};
  const f=fixture(async()=>{await gate;return {ok:true,output:"late",images:[bitmap]};});
  const pending=f.runner.run("x=1\n# %%\nx=2","r");
  assert.equal(f.runner.isRunning(),true);
  assert.match((await f.runner.run("x=3","r")).error,/already running/);
  f.runner.cancel();
  release();
  const result=await pending;
  assert.equal(result.cancelled,true);
  assert.equal(f.entries.length,0);
  assert.equal(bitmap.closed,true);
  assert.equal(f.runner.isRunning(),false);
});
test("bounds per-cell and aggregate output, stopping before later execution",async()=>{
  let calls=0;
  const f=fixture(async()=>{calls++;return {ok:true,output:"a".repeat(140000)};});
  const source=Array.from({length:12},()=>"# %%\nprint(1)").join("\n");
  const result=await f.runner.run(source,"python");
  assert.equal(result.ok,false);
  assert.match(result.error,/1 MiB/);
  assert.equal(calls,8);
  assert.equal(f.entries[0].output.length,131072);
});
test("closes excess bitmaps and preserves first eight for the UI",async()=>{
  const images=Array.from({length:10},()=>({closed:false,close(){this.closed=true;}}));
  const f=fixture(async()=>({ok:true,output:"",images}));
  assert.equal((await f.runner.run("plot(1)","r")).ok,true);
  assert.equal(f.entries[0].images.length,8);
  assert.equal(images[8].closed,true);
  assert.equal(images[9].closed,true);
  assert.equal(images[0].closed,false);
});
test("lexical parser ignores percent markers inside Python triple-quoted literals",async()=>{
  const f=fixture();
  const result=await f.runner.run("s = '''\n# %%\nnot a cell\n'''\n# %%\nprint(s)","python");
  assert.equal(result.executed,2);
});
test("UTF-8 output limits do not split multibyte characters",async()=>{
  const f=fixture(async()=>({ok:true,output:"λ".repeat(80000)}));
  assert.equal((await f.runner.run("print(1)","python")).ok,true);
  assert.equal(f.entries[0].output.length,65536);
  assert.equal(f.entries[0].truncated,true);
});
test("cancel invalidates results without admitting another notebook while kernel is still executing",async()=>{
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const f = fixture(async () => { calls++; await gate; return {ok:true, output:"late"}; });
  const first = f.runner.run("x <- 1", "r");
  f.runner.cancel();
  assert.equal(f.runner.isRunning(), true);
  const rejected = await f.runner.run("x <- 2", "r");
  assert.match(rejected.error, /already running/);
  assert.equal(calls, 1);
  release();
  assert.equal((await first).cancelled, true);
  assert.equal(f.runner.isRunning(), false);
  assert.equal(f.entries.length, 0);
  assert.equal((await f.runner.run("x <- 3", "r")).ok, true);
  assert.equal(calls, 2);
});
test("failed notebook renderer releases untransferred R bitmaps",async()=>{
  const bitmap = {closed:false, close(){this.closed = true;}};
  const runner = create({parseCells, execute:async()=>({ok:true,images:[bitmap]}),
    onCell:()=>{throw Error("DOM detached");}, notice:()=>{}});
  const result = await runner.run("plot(1)", "r");
  assert.equal(result.ok,false);
  assert.match(result.error,/Notebook rendering failed/);
  assert.equal(bitmap.closed,true);
  assert.equal(runner.isRunning(),false);
});

test("aggregate notebook media budgets release excess bitmaps and cap plot snapshots", async () => {
  const batches = Array.from({length:6}, (_, cell) =>
    Array.from({length:8}, (_, item) => ({
      cell, item, closed:false, close() { this.closed = true; }
    })));
  let next = 0;
  const f = fixture(async () => {
    const cell = next++;
    return {ok:true, output:"media-ok", images:batches[cell],
      plots:Array.from({length:8}, (_, index) => "plot-" + cell + "-" + index)};
  });
  const source = Array.from({length:6}, () => "# %% [r]\nplot(1)").join("\n");
  assert.deepEqual(await f.runner.run(source, "r"), {ok:true, executed:6});
  assert.deepEqual(f.entries.map(entry => entry.images.length), [8,8,8,8,0,0]);
  assert.deepEqual(f.entries.map(entry => entry.plots.length), [8,8,8,8,0,0]);
  assert.equal(batches.flat().filter(bitmap => bitmap.closed).length, 16);
  assert.ok(batches.slice(0,4).flat().every(bitmap => !bitmap.closed));
  assert.ok(batches.slice(4).flat().every(bitmap => bitmap.closed));
  assert.equal(f.runner.isRunning(), false);
});

test("exact 1 MiB aggregate UTF-8 output succeeds on final cell and renders trailing markdown", async () => {
  const f = fixture(async () => ({ok:true, output:"λ".repeat(65536)}));
  const source = Array.from({length:8}, () => "# %% [python]\nprint('λ')").join("\n") +
    "\n# %% [markdown]\n# Complete";
  const result = await f.runner.run(source, "python");
  assert.deepEqual(result, {ok:true, executed:8});
  assert.equal(f.entries.filter(entry => entry.kind === "code").length, 8);
  assert.equal(f.entries.at(-1).kind, "markdown");
  assert.equal(f.entries.some(entry => entry.truncated), false);
  assert.equal(f.entries.reduce((bytes, entry) =>
    bytes + (entry.kind === "code" ? new TextEncoder().encode(entry.output).length : 0), 0), 1048576);
  assert.equal(f.runner.isRunning(), false);
});

test("exhausted aggregate output rejects ninth executable cell without dispatching it", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return {ok:true, output:"x".repeat(131072)}; });
  const source = Array.from({length:9}, () => "# %% [r]\ncat(1)").join("\n");
  const result = await f.runner.run(source, "r");
  assert.deepEqual(result, {ok:false, executed:8, error:"Notebook output limit of 1 MiB reached."});
  assert.equal(calls, 8);
  assert.equal(f.entries.length, 8);
  assert.equal(f.runner.isRunning(), false);
});

test("final cell exceeding the aggregate budget still fails when its snapshot is truncated", async () => {
  const f = fixture(async () => ({ok:true, output:"z".repeat(131073)}));
  const source = Array.from({length:8}, () => "# %% [python]\nprint(1)").join("\n");
  const result = await f.runner.run(source, "python");
  assert.deepEqual(result, {ok:false, executed:8, error:"Notebook output limit of 1 MiB reached."});
  assert.equal(f.entries.at(-1).truncated, true);
});


test("aggregate PNG snapshots are bounded by eight MiB across a twelve-cell notebook", async () => {
  const png = "iVBORw0KGgo" + "A".repeat(1048576 - 12);
  const f = fixture(async () => ({ok:true, output:"computed", plots:[{number:17, png}]}));
  const source = Array.from({length:12}, (_, index) =>
    "# %% [python]\\nprint(" + index + ")").join("\\n").replaceAll("\\n", "\n");
  assert.deepEqual(await f.runner.run(source, "python"), {ok:true, executed:12});
  assert.deepEqual(f.entries.map(entry => entry.plots.length),
    [1,1,1,1,1,1,1,1,0,0,0,0]);
  assert.equal(f.entries.slice(0,8).every(entry => entry.plots[0].png === png), true);
  assert.equal(f.entries[0].plots[0].number, undefined);
  assert.equal(f.entries.length, 12);
  assert.equal(f.runner.isRunning(), false);
});

test("oversized and malformed plot payloads are dropped without blocking later valid plots", async () => {
  const small = "iVBORw0KGgo" + "A".repeat(1024);
  const large = "iVBORw0KGgo" + "A".repeat(1398105 - 12);
  const f = fixture(async () => ({ok:true, output:"ok", plots:[
    {png:large}, {png:"<script>bad</script>"}, {png:small, auxiliary:"x".repeat(2000000)}
  ]}));
  assert.deepEqual(await f.runner.run("print(1)", "python"), {ok:true, executed:1});
  assert.deepEqual(f.entries[0].plots, [{png:small}]);
  assert.equal(f.runner.isRunning(), false);
});

test("plot payload budget is independent of aggregate text and bitmap limits", async () => {
  const png = "iVBORw0KGgo" + "A".repeat(1048576 - 12);
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return {ok:true, output:"λ", plots:[{png}],
      images:[{close() { throw Error("unexpected bitmap close"); }}]};
  });
  const source = Array.from({length:10}, () => "# %% [python]\\nprint(1)").join("\\n")
    .replaceAll("\\n", "\n");
  assert.deepEqual(await f.runner.run(source, "python"), {ok:true, executed:10});
  assert.equal(calls, 10);
  assert.deepEqual(f.entries.map(entry => entry.plots.length), [1,1,1,1,1,1,1,1,0,0]);
  assert.equal(f.entries.reduce((total, entry) => total + entry.images.length, 0), 10);
  assert.equal(f.entries.map(entry => entry.output).join(""), "λ".repeat(10));
});
