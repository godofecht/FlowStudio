"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const base = path.join(__dirname, "../docs/app");
const html = fs.readFileSync(path.join(base, "index.html"), "utf8");
const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/);
const consoleREPL = require("../docs/app/console_repl.js");
const selectionScript = fs.readFileSync(path.join(base, "source_selection.js"), "utf8");
function fixture() {
  const elements = new Map(), workers = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, value:"", textContent:"", disabled:false, selectionStart:0, selectionEnd:0,
      listeners:new Map(), addEventListener(type,fn){this.listeners.set(type,fn);},
      setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
      replaceChildren(){}, append(){}, scrollTop:0, scrollHeight:0
    });
    return elements.get(id);
  }
  class Worker {
    constructor(){this.messages=[];this.terminated=false;workers.push(this);}
    postMessage(message){this.messages.push(message);}
    terminate(){this.terminated=true;}
  }
  const ctx={TextEncoder,Worker,setTimeout,clearTimeout,
    document:{getElementById:element,createElement:()=>({setAttribute(){},append(){}})},
    FlowStudioConsoleREPL:consoleREPL,
    FlowStudioSourceCells:{cellAt:()=>({kind:"code",code:"print(1)"})},
    FlowStudioPlotHistory:{create:()=>({append(){},clear(){}})},
    FlowStudioData:require("../docs/app/data_viewer.js"),
    FlowStudioEnvironmentData:require("../docs/app/environment_data.js"),
    FlowStudioNotebookIO:require("../docs/app/notebook_io.js"),
    FlowStudioNotebookFormat:require("../docs/app/notebook_format.js"),
    FlowStudioPackages:{create:()=>({clear(){}})},
    FlowStudioDraftStorage:{create:()=>({queue(){},flush(){},clear(){},read(){return null;}})},
    FlowStudioProjectWorkspace:{create:()=>({dirty(){return false;},notifyExternalOpen(){}})},
    FlowStudioProject:{},FlowStudioFileSave:{},
    addEventListener(){},confirm:()=>true,prompt:()=>null,
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}}
  };
  ctx.window=ctx;
  vm.runInNewContext(selectionScript,ctx,{filename:"docs/app/source_selection.js"});
  vm.runInNewContext(inline[1],ctx,{filename:"docs/app/index.html"});
  function click(id){elements.get(id).listeners.get("click")({});}
  async function tick(){await new Promise(resolve=>setImmediate(resolve));}
  return {element,workers,click,tick};
}
test("browser console is wired to the same persistent Python worker", async () => {
  const f=fixture();
  f.element("consoleInput").value="x = 41\nprint(x + 1)";
  f.click("submitConsole");
  assert.equal(f.workers.length,1);
  assert.equal(f.workers[0].messages.length,1);
  assert.equal(f.workers[0].messages[0].op,"run");
  assert.equal(f.workers[0].messages[0].code,"x = 41\nprint(x + 1)");
  const id=f.workers[0].messages[0].id;
  f.workers[0].onmessage({data:{id,ok:true,output:"42",plots:[]}});
  await f.tick();
  assert.equal(f.workers[0].messages[1].op,"inspect");
  f.workers[0].onmessage({data:{id:f.workers[0].messages[1].id,ok:true,variables:[]}});
  await f.tick();
  assert.match(f.element("console").textContent,/python console\n42/);
  assert.equal(f.element("consoleInput").value,"");
  assert.equal(f.element("submitConsole").disabled,false);
});
test("busy editor execution cannot overwrite console input", async () => {
  const f=fixture();
  f.element("language").value="python";
  f.element("source").value="print('editor')";
  f.click("run");
  f.element("consoleInput").value="print('console')";
  f.click("submitConsole");
  await f.tick();
  assert.equal(f.workers[0].messages.length,1);
  assert.equal(f.element("consoleInput").value,"print('console')");
  assert.match(f.element("notice").textContent,/busy/);
});
test("reset during console submission preserves unsent input", async () => {
  const f=fixture();
  f.element("consoleInput").value="x = 3";
  f.click("submitConsole");
  f.click("reset");
  await f.tick();
  assert.equal(f.workers[0].terminated,true);
  assert.equal(f.workers.length,2);
  assert.equal(f.element("consoleInput").value,"x = 3");
  assert.equal(f.element("submitConsole").disabled,false);
});
test("browser console script is loaded before the workspace bootstrap", () => {
  assert.match(html,/<script src="\.\/console_repl\.js"><\/script>/);
  assert.ok(html.indexOf('src="./console_repl.js"') < html.indexOf("\n<script>"));
  assert.match(html,/id="consoleInput"/);
  assert.match(html,/id="submitConsole"/);
});
