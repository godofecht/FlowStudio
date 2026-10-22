"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
function fixture() {
  const elements = new Map(), workers = [], rCalls = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, value:"", textContent:"", disabled:false, selectionStart:0, selectionEnd:0,
      scrollTop:0, scrollHeight:0, handlers:{},
      addEventListener(type, fn) { this.handlers[type] = fn; },
      replaceChildren(...nodes) { this.children = nodes; },
      append(node) { (this.children ||= []).push(node); },
      setAttribute() {}, click() { this.handlers.click?.({}); }
    });
    return elements.get(id);
  }
  class Worker {
    constructor() { this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  }
  const rSession = {
    async run(code) { rCalls.push(["run",code]); return {ok:true,output:"[1] 42",images:[]}; },
    async inspect() { rCalls.push(["inspect"]); return {ok:true,variables:[{name:"x",type:"numeric",shape:null,preview:"42"}]}; },
    reset() { rCalls.push(["reset"]); }
  };
  const ctx = {
    document:{getElementById:element,createElement:()=>({style:{},setAttribute(){},append(){}})},
    Worker,TextEncoder,setTimeout,clearTimeout,
    addEventListener(){},confirm:()=>true,prompt:()=>null,
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    FlowStudioRSession:{create:()=>rSession,renderImages:()=>{rCalls.push(["plots"]);}},
    FlowStudioPlotHistory:{create:()=>({append(){},clear(){}})},
    FlowStudioPackages:{create:()=>({clear(){}})},
    FlowStudioDraftStorage:{create:()=>({queue(){},flush(){},clear(){},read(){return null;}})},
    FlowStudioSourceSelection:{prepare:source=>({ok:true,code:source.value})},
    FlowStudioSourceCells:{cellAt:()=>({kind:"code",code:"x <- 42"})},
    FlowStudioConsoleREPL:{create:()=>({})},
    FlowStudioProjectWorkspace:{create:()=>({dirty:()=>false,notifyExternalOpen(){}})},
    FlowStudioProject:{},FlowStudioFileSave:{}
  };
  ctx.window = ctx;
  vm.runInNewContext(inline, ctx, {filename:"docs/app/index.html"});
  const tick = async () => { for (let i=0;i<6;i++) await Promise.resolve(); };
  return {element,workers,rCalls,tick};
}
test("R editor executes through persistent webR, not Python worker", async()=>{
  const f=fixture();
  f.element("language").value="r";
  f.element("source").value="x <- 42";
  f.element("run").click();
  await f.tick();
  assert.deepEqual(f.rCalls,[["run","x <- 42"],["plots"],["inspect"]]);
  assert.equal(f.workers[0].messages.length,0);
  assert.match(f.element("console").textContent,/\[1\] 42/);
  assert.match(f.element("notice").textContent,/r execution complete/);
});
test("R percent-cell execution submits only the active code cell",async()=>{
  const f=fixture();
  f.element("language").value="r";
  f.element("source").value="unrelated <- 1\n# %%\nx <- 42";
  f.element("runCell").click();
  await f.tick();
  assert.deepEqual(f.rCalls[0],["run","x <- 42"]);
});
test("R reset is isolated from Python worker and Flow remains unavailable",async()=>{
  const f=fixture();
  f.element("language").value="r";
  f.element("source").value="x <- 42";
  f.element("run").click();
  await f.tick();
  f.element("reset").click();
  assert.ok(f.rCalls.some(x=>x[0]==="reset"));
  assert.equal(f.workers.length,1);
  assert.equal(f.workers[0].terminated,undefined);
  f.element("language").value="flow";
  f.element("run").click();
  assert.equal(f.workers[0].messages.length,0);
  assert.match(f.element("notice").textContent,/future WebAssembly runtime/);
});
