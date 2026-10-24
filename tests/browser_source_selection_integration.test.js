"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const base = path.join(__dirname, "../docs/app");
const html = fs.readFileSync(path.join(base, "index.html"), "utf8");
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const moduleSource = fs.readFileSync(path.join(base, "source_selection.js"), "utf8");
const cellSource = fs.readFileSync(path.join(base, "source_cells.js"), "utf8");
const consoleSource = fs.readFileSync(path.join(base, "console_repl.js"), "utf8");
const transferScript = fs.readFileSync(path.join(base, "variable_transfer.js"), "utf8");
const snapshotScript = fs.readFileSync(path.join(base, "session_snapshot.js"), "utf8");
const draftSource = fs.readFileSync(path.join(base, "draft_storage.js"), "utf8");
const recoverySource = fs.readFileSync(path.join(base, "notebook_recovery.js"), "utf8");
const projectSource = fs.readFileSync(path.join(base, "project.js"), "utf8");
const saveSource = fs.readFileSync(path.join(base, "file_save.js"), "utf8");
const projectWorkspaceSource = fs.readFileSync(path.join(base, "project_workspace.js"), "utf8");

function fixture(initialDraft = null) {
  const elements = new Map(), workers = [], storage = new Map(), windowListeners = new Map(), plotCalls = [];
  let acceptSwitch = true;
  if (initialDraft) storage.set("flowstudio.browser.draft.v1", JSON.stringify(initialDraft));
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, value:"", textContent:"", disabled:false, selectionStart:0, selectionEnd:0,
      listeners:new Map(), addEventListener(name, fn) { this.listeners.set(name, fn); },
      replaceChildren() {}, append() {}, scrollTop:0, scrollHeight:0
    });
    return elements.get(id);
  }
  class Worker {
    constructor() { this.messages=[]; this.terminated=false; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated=true; }
  }
  const context = {TextEncoder, Worker, setTimeout, clearTimeout,
    localStorage: {getItem:key=>storage.get(key) || null, setItem:(key,value)=>storage.set(key,value), removeItem:key=>storage.delete(key)},
    addEventListener:(name,fn)=>windowListeners.set(name,fn),
    confirm:()=>acceptSwitch, prompt:()=>null,
    document:{getElementById:element, createElement:()=>({setAttribute(){},append(){}})},
    FlowStudioPlotHistory:{create:()=>({append(plots){plotCalls.push(plots);},clear(){}})},
    FlowStudioData:require("../docs/app/data_viewer.js"),
    FlowStudioEnvironmentData:require("../docs/app/environment_data.js"),
    FlowStudioNotebookIO:require("../docs/app/notebook_io.js"),
    FlowStudioNotebookFormat:require("../docs/app/notebook_format.js"),
    FlowStudioCompletion:{create:()=>({clear(){}})},
    FlowStudioPackages:{create:()=>({clear(){}})}
  };
  context.window = context;
  vm.runInNewContext(moduleSource, context);
  vm.runInNewContext(cellSource, context);
  vm.runInNewContext(draftSource, context);
  vm.runInNewContext(recoverySource, context);
  vm.runInNewContext(projectSource, context);
  vm.runInNewContext(saveSource, context);
  vm.runInNewContext(projectWorkspaceSource, context);
  vm.runInNewContext(consoleSource, context);
  vm.runInNewContext(transferScript, context);
  vm.runInNewContext(snapshotScript, context, {filename:"docs/app/session_snapshot.js"});
  vm.runInNewContext(script, context);
  const recovered = {source:element("source").value, filename:element("filename").textContent, language:element("language").value};
  const source = element("source");
  source.value = "x = 1\nprint(x)\nx = 9\n";
  source.selectionStart = source.value.indexOf("print");
  source.selectionEnd = source.selectionStart + "print(x)".length;
  element("language").value = "python";
  function click(id) { return element(id).listeners.get("click")({}); }
  function keydown(props) { return source.listeners.get("keydown")({preventDefault(){},...props}); }
  return {element, workers, source, click, keydown, storage, windowListeners, plotCalls, recovered,
    setConfirm:value=>{acceptSwitch=value;}};
}
async function tick() { await new Promise(resolve=>setImmediate(resolve)); }

test("run selection posts only the selected Python code and inspects environment", async () => {
  const f=fixture();
  f.click("runSelection");
  assert.equal(f.workers[0].messages.length,1);
  assert.equal(f.workers[0].messages[0].op,"run");
  assert.equal(f.workers[0].messages[0].code,"print(x)");
  assert.equal(f.element("runSelection").disabled,true);
  const id=f.workers[0].messages[0].id;
  f.workers[0].onmessage({data:{id,ok:true,output:"1",plots:[]}});
  await tick();
  assert.equal(f.workers[0].messages[1].op,"inspect");
  f.workers[0].onmessage({data:{id:f.workers[0].messages[1].id,ok:true,variables:[]}});
  await tick();
  assert.equal(f.element("runSelection").disabled,false);
  assert.match(f.element("console").textContent,/run selection\n1/);
});

test("Ctrl+Enter executes entire buffer, Ctrl+Shift+Enter executes selection", () => {
  const f=fixture();
  f.keydown({key:"Enter",ctrlKey:true,shiftKey:true});
  assert.equal(f.workers[0].messages[0].code,"print(x)");
  const g=fixture();
  g.keydown({key:"Enter",metaKey:true,shiftKey:false});
  assert.equal(g.workers[0].messages[0].code,g.source.value);
});

test("missing selection and unsupported runtime never submit code", () => {
  const f=fixture();
  f.source.selectionEnd=f.source.selectionStart;
  f.click("runSelection");
  assert.equal(f.workers[0].messages.length,0);
  assert.match(f.element("notice").textContent,/Select source/);
  const g=fixture();
  g.element("language").value="flow";
  g.click("runSelection");
  assert.equal(g.workers[0].messages.length,0);
});

test("reset invalidates stale responses and restores execution controls", async () => {
  const f=fixture();
  f.click("runSelection");
  f.click("reset");
  assert.equal(f.workers[0].terminated,true);
  await tick();
  assert.equal(f.element("runSelection").disabled,false);
  assert.equal(f.workers[1].messages.length,0);
});


test("selection execution and browser draft recovery remain independent", async () => {
  const f=fixture();
  f.source.value = "x = 2\nprint(x)\n";
  f.source.selectionStart = 6;
  f.source.selectionEnd = 14;
  f.source.listeners.get("input")();
  f.click("runSelection");
  assert.equal(f.workers[0].messages[0].code,"print(x)");
  f.windowListeners.get("pagehide")();
  const stored = JSON.parse(f.storage.get("flowstudio.browser.draft.v1"));
  assert.equal(stored.source, f.source.value);
  assert.equal(stored.language, "python");
  f.click("forgetDraft");
  assert.equal(f.storage.has("flowstudio.browser.draft.v1"), false);
  assert.equal(f.source.value, "x = 2\nprint(x)\n");
  f.click("reset");
  await tick();
  assert.equal(f.workers[0].terminated,true);
});


test("Python exception still renders captured figures and refreshes mutated environment", async () => {
  const f=fixture();
  f.click("runSelection");
  const id=f.workers[0].messages[0].id;
  f.workers[0].onmessage({data:{id,ok:false,output:"ValueError: after plotting",plots:[{png:"AA=="}]}});
  await tick();
  assert.equal(f.workers[0].messages[1].op,"inspect");
  assert.equal(f.plotCalls.length,1);
  assert.equal(f.plotCalls[0][0].png,"AA==");
  f.workers[0].onmessage({data:{id:f.workers[0].messages[1].id,ok:true,variables:[]}});
  await tick();
  assert.match(f.element("console").textContent,/ValueError: after plotting/);
  assert.equal(f.element("runSelection").disabled,false);
  assert.equal(f.element("environment").textContent,"(No user variables)");
});


test("saved source, filename and runtime recover at browser startup", () => {
  const f=fixture({version:1,source:"print('recovered')",filename:"research.py",language:"python"});
  assert.equal(f.recovered.source,"print('recovered')");
  assert.equal(f.recovered.filename,"research.py");
  assert.equal(f.recovered.language,"python");
  assert.match(f.element("notice").textContent,/Recovered/);
  assert.equal(f.workers.length,1);
});

test("cancelled local file switch preserves project buffer and resets picker", async () => {
  const f=fixture();
  f.source.value="unsaved changes";
  f.setConfirm(false);
  const target={files:[{size:3,name:"test.py",text:async()=>"new"}],value:"test.py"};
  await f.element("file").listeners.get("change")({target});
  assert.equal(f.source.value,"unsaved changes");
  assert.equal(target.value,"");
});

test("Run Cell submits only the active Python cell and refreshes the environment", async () => {
  const f=fixture();
  f.source.value="x=1\n# %%\nprint(x)\n";
  f.source.selectionStart=f.source.value.indexOf("print");
  f.click("runCell");
  assert.equal(f.workers[0].messages.length,1);
  assert.equal(f.workers[0].messages[0].code,"print(x)\n");
  const id=f.workers[0].messages[0].id;
  f.workers[0].onmessage({data:{id,ok:true,output:"1",plots:[]}});
  await tick();
  assert.equal(f.workers[0].messages[1].op,"inspect");
  f.workers[0].onmessage({data:{id:f.workers[0].messages[1].id,ok:true,variables:[]}});
  await tick();
  assert.equal(f.element("runCell").disabled,false);
});
test("Run Cell rejects markdown and empty cells without posting code", () => {
  const f=fixture();
  f.source.value="# %% [markdown]\n# Heading\n# %%\n";
  f.source.selectionStart=5;
  f.click("runCell");
  assert.equal(f.workers[0].messages.length,0);
  assert.match(f.element("notice").textContent,/Markdown/);
  f.source.selectionStart=f.source.value.length;
  f.click("runCell");
  assert.equal(f.workers[0].messages.length,0);
});
