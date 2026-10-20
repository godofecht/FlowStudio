"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
function mount(reply = {ok:true,status:200,text:async () => "ok"}) {
  const elements = new Map();
  for (const id of ["consoleInput","console","consoleExecute","language",
    "resultStatus","run","runCell"]) {
    elements.set(id, {id,value:"",textContent:"",disabled:false,dataset:{},listeners:{},
      selectionStart:0,selectionEnd:0,scrollTop:0,scrollHeight:120,
      setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},
      addEventListener(name,fn){this.listeners[name]=fn;},
      fire(name,event={}){return this.listeners[name]?.(event);}});
  }
  elements.get("language").value = "python";
  const doc = {getElementById:id=>elements.get(id)};
  const requests = [];
  const context = vm.createContext({TextEncoder,console});
  vm.runInContext(fs.readFileSync(path.join(root,"web/console.js"),"utf8"),context);
  vm.runInContext(fs.readFileSync(path.join(root,"web/workspace_console.js"),"utf8"),context);
  const controller = context.FlowStudioWorkspaceConsole.mount(doc,async (url,options)=>{
    requests.push({url,options});return reply;
  });
  return {controller,el:id=>elements.get(id),requests};
}
test("workspace exposes console controls and loads allowlisted modules",()=>{
  assert.match(html, /id="console"/);
  const server = fs.readFileSync(path.join(root, "src/main.flow"), "utf8");
  assert.doesNotMatch(server, /\bs_replace\s*\(/);
  assert.match(html, /<script src="\/workspace_console\.js"><\/script>/);
  const routes = fs.readFileSync(path.join(root, "src/data_routes.flow"), "utf8");
  assert.match(routes, /workspace_console\.js/);
});
test("interactive console submits exact code and shares output",async()=>{
  const app=mount();app.el("consoleInput").value="print('hello')";
  assert.equal(await app.controller.run(app.el("consoleInput")),true);
  assert.equal(app.requests.length,1);
  assert.equal(app.requests[0].url,"/api/run/python");
  assert.equal(app.requests[0].options.body,"print('hello')");
  assert.equal(app.requests[0].options.headers["X-FlowStudio-Intent"],"run");
  assert.match(app.el("console").textContent,/ok/);
  assert.equal(app.el("consoleInput").value,"");
  assert.equal(app.el("resultStatus").dataset.state,"ok");
});
test("runtime error preserves history and status",async()=>{
  const app=mount({ok:false,status:422,text:async()=>"SyntaxError"});
  app.el("consoleInput").value="bad(";
  assert.equal(await app.controller.run(app.el("consoleInput")),true);
  assert.deepEqual(Array.from(app.controller.history("python")),["bad("]);
  assert.match(app.el("console").textContent,/SyntaxError/);
  assert.equal(app.el("resultStatus").dataset.state,"error");
});
test("language switch preserves drafts and separates history",async()=>{
  const app=mount();app.el("consoleInput").value="python draft";
  app.el("language").value="r";app.el("language").fire("change");
  assert.equal(app.el("consoleInput").value,"");
  app.el("consoleInput").value="x <- 1";
  assert.equal(await app.controller.run(app.el("consoleInput")),true);
  app.el("language").value="python";app.el("language").fire("change");
  assert.equal(app.el("consoleInput").value,"python draft");
  assert.deepEqual(Array.from(app.controller.history("r")),["x <- 1"]);
});
test("editor execution blocks console without consuming command",async()=>{
  const app=mount();app.el("run").disabled=true;
  app.el("consoleInput").value="keep me";
  assert.equal(await app.controller.run(app.el("consoleInput")),false);
  assert.equal(app.requests.length,0);
  assert.equal(app.el("consoleInput").value,"keep me");
  assert.equal(app.el("run").disabled,true);
});
test("console execution blocks editor until request settles",async()=>{
  let resolve;
  const app=mount({ok:true,status:200,text:()=>new Promise(r=>{resolve=r;})});
  app.el("consoleInput").value="x";
  const pending=app.controller.run(app.el("consoleInput"));
  await Promise.resolve();
  assert.equal(app.el("run").disabled,true);
  assert.equal(app.el("runCell").disabled,true);
  assert.equal(app.el("consoleExecute").disabled,true);
  await new Promise(r=>setImmediate(r));
  resolve("done");await pending;
  assert.equal(app.el("run").disabled,false);
  assert.equal(app.el("runCell").disabled,false);
});
test("keyboard prevents editor shortcut propagation and supports multiline",async()=>{
  const app=mount();let prevented=false,stopped=false;
  app.el("consoleInput").value="one";
  app.el("consoleInput").fire("keydown",{key:"Enter",ctrlKey:true,
    preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(prevented,true);assert.equal(stopped,true);
  assert.equal(app.requests.length,1);
  assert.equal(app.el("consoleInput").value,"");
  prevented=false;
  app.el("consoleInput").fire("keydown",{key:"Enter",shiftKey:true,preventDefault(){prevented=true;}});
  assert.equal(prevented,false);
});
test("network failures do not consume history and release locks",async()=>{
  const app=mount({text:async()=>{throw Error("disconnected");}});
  app.el("consoleInput").value="retry";
  assert.equal(await app.controller.run(app.el("consoleInput")),false);
  assert.deepEqual(Array.from(app.controller.history("python")),[]);
  assert.equal(app.el("consoleInput").value,"retry");
  assert.equal(app.el("run").disabled,false);
  assert.equal(app.el("resultStatus").dataset.state,"error");
});
test("mount creates accessible console controls inside existing editor panel", async () => {
  const elements = new Map();
  const panel = {style:{},append(...nodes){
    const register = node => {
      if (node.id) elements.set(node.id,node);
      for (const child of node.children || []) register(child);
    };
    nodes.forEach(register);
  }};
  function element(id) {
    return {id,value:"",textContent:"",style:{},dataset:{},listeners:{},children:[],
      disabled:false,selectionStart:0,selectionEnd:0,scrollTop:0,scrollHeight:100,
      addEventListener(name,fn){this.listeners[name]=fn;},
      setAttribute(name,value){this[name]=value;},
      setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},
      append(...nodes){this.children.push(...nodes);}};
  }
  for (const id of ["console","language","resultStatus","run","runCell"])
    elements.set(id,element(id));
  elements.get("console").parentElement = panel;
  elements.get("language").value = "flow";
  const doc = {getElementById:id=>elements.get(id) || null,createElement:tag=>element("")};
  const context = vm.createContext({TextEncoder,console});
  vm.runInContext(fs.readFileSync(path.join(root,"web/console.js"),"utf8"),context);
  vm.runInContext(fs.readFileSync(path.join(root,"web/workspace_console.js"),"utf8"),context);
  const calls=[];
  const controller=context.FlowStudioWorkspaceConsole.mount(doc,async (url,opts)=>{
    calls.push([url,opts.body]);return {ok:true,status:200,text:async()=>"ok"};
  });
  assert.equal(elements.get("consoleInput")["aria-label"],"Interactive console command");
  assert.equal(elements.get("consoleExecute").textContent,"Execute");
  assert.equal(panel.style.flexDirection,"column");
  elements.get("consoleInput").value="println(1)";
  assert.equal(await controller.run(elements.get("consoleInput")),true);
  assert.deepEqual(calls,[["/api/run/flow","println(1)"]]);
});

test("integrated console Ctrl+R searches per-runtime history without execution", async () => {
  const app = mount();
  for (const code of ["print('one')", "print('two')"]) {
    app.el("consoleInput").value = code;
    await app.controller.run(app.el("consoleInput"));
  }
  app.el("consoleInput").value = "print";
  let prevented = false, stopped = false;
  app.el("consoleInput").fire("keydown", {key:"r",ctrlKey:true,
    preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.equal(prevented,true);
  assert.equal(stopped,true);
  assert.equal(app.el("consoleInput").value,"print('two')");
  app.el("consoleInput").fire("keydown", {key:"r",ctrlKey:true,
    preventDefault(){},stopPropagation(){}});
  assert.equal(app.el("consoleInput").value,"print('one')");
  assert.equal(app.requests.length,2);
});
