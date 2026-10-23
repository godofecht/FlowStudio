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
test("rejects Flow, empty, oversized and too many cells before executing anything",async()=>{
  let calls=0;
  const f=fixture(async()=>{calls++;return {ok:true};});
  assert.match((await f.runner.run("x=1","flow")).error,/requires browser Python or R/);
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
