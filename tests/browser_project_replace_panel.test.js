"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Project = require("../docs/app/project.js");
const Workspace = require("../docs/app/project_workspace.js");
const Save = require("../docs/app/file_save.js");
const Panel = require("../docs/app/project_replace_panel.js");

function node(value = "") {
  const listeners = {};
  return {
    value, checked:false, disabled:false, textContent:"", children:[],
    addEventListener(event, fn) {
      (listeners[event] ||= []).push(fn);
    },
    emit(event) {
      for (const fn of listeners[event] || []) fn();
    },
    click() { this.emit("click"); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }
  };
}
function file(name, initial) {
  const state = {content:initial};
  function handle() {
    return {
      kind:"file", name, state,
      async getFile() {
        return {size:Buffer.byteLength(state.content), text:async()=>state.content};
      },
      async isSameEntry(other) { return other.state === state; },
      async createWritable() {
        let pending = state.content;
        return {
          write:async value=>{pending=value;},
          close:async()=>{state.content=pending;},
          abort:async()=>{}
        };
      }
    };
  }
  return {state, handle};
}
function directory(name, entries) {
  return {
    kind:"directory", name,
    async *entries() { yield* entries; }
  };
}
function fixture(confirmChange = () => true) {
  const previousDocument = global.document;
  global.document = {createElement:()=>node()};
  const first = file("a.R", "x <- 1\nx <- 2\n");
  const second = file("b.py", "x = 3\n");
  const root = directory("work", [
    ["a.R", first.handle()], ["b.py", second.handle()]
  ]);
  let selectedRoot = root;
  const source=node(""), filename=node(), language=node("r"), tree=node();
  source.value="start"; language.value="r";
  const messages=[];
  const workspace=Workspace.create({
    projectApi:Project, fileSaveApi:Save, source, filename, language, tree,
    openFolderButton:node(), saveFileButton:node(), newFileButton:node(),
    status:m=>messages.push(m), onDraft:()=>{},
    setFilename:(_,name)=>{filename.textContent=name;},
    picker:async()=>selectedRoot, confirmChange, promptName:()=>null
  });
  const query=node("x"), replacement=node("y");
  query.value="x"; replacement.value="y";
  const caseSensitive=node(), regex=node(), wholeWord=node();
  const previewButton=node(), applyButton=node(), output=node();
  const panel=Panel.create({
    project:workspace.project, isOpenHandle:workspace.isOpenHandle,
    query,replacement,caseSensitive,regex,wholeWord,previewButton,applyButton,
    output,notice:m=>messages.push(m),confirmChange
  });
  return {
    first,second,root,source,workspace,panel,query,replacement,regex,wholeWord,
    previewButton,applyButton,output,messages,
    selectRoot(next){selectedRoot=next;},
    cleanup(){global.document=previousDocument;}
  };
}
test("Pages previews real project file changes without writing, then applies after confirmation",async()=>{
  const f=fixture();
  try {
    assert.equal(await f.workspace.choose(),true);
    assert.equal(await f.panel.preview(),true);
    assert.match(f.output.textContent,/3 matches; 2 changed files/);
    assert.match(f.output.textContent,/a.R/);
    assert.match(f.output.textContent,/x <- 1/);
    assert.equal(f.first.state.content,"x <- 1\nx <- 2\n");
    assert.equal(f.applyButton.disabled,false);
    assert.equal(await f.panel.apply(),true);
    assert.equal(f.first.state.content,"y <- 1\ny <- 2\n");
    assert.equal(f.second.state.content,"y = 3\n");
    assert.equal(f.applyButton.disabled,true);
    assert.equal(await f.panel.apply(),false);
  } finally {f.cleanup();}
});
test("Pages rejects an open editor file even when search returned a different handle object",async()=>{
  const f=fixture();
  try {
    await f.workspace.choose();
    assert.equal(await f.workspace.openHandle(f.first.handle(),"work/a.R",f.root),true);
    assert.equal(await f.panel.preview(),true);
    assert.equal(await f.panel.apply(),false);
    assert.match(f.output.textContent,/Close the open editor tab/);
    assert.equal(f.first.state.content,"x <- 1\nx <- 2\n");
    assert.equal(f.second.state.content,"x = 3\n");
  } finally {f.cleanup();}
});
test("Pages refuses stale previews without modifying earlier files",async()=>{
  const f=fixture();
  try {
    await f.workspace.choose();
    await f.panel.preview();
    f.second.state.content="external change";
    assert.equal(await f.panel.apply(),false);
    assert.match(f.output.textContent,/File changed since preview/);
    assert.equal(f.first.state.content,"x <- 1\nx <- 2\n");
    assert.equal(f.second.state.content,"external change");
  } finally {f.cleanup();}
});
test("Pages cancellation and edited options invalidate pending replacement",async()=>{
  let confirms=0;
  const f=fixture(()=>{confirms++;return false;});
  try {
    await f.workspace.choose();
    await f.panel.preview();
    assert.equal(await f.panel.apply(),false);
    assert.equal(confirms,1);
    assert.equal(f.first.state.content,"x <- 1\nx <- 2\n");
    f.regex.checked=true;
    f.regex.emit("change");
    assert.equal(f.applyButton.disabled,true);
    assert.equal(await f.panel.apply(),false);
    f.query.value="(";
    assert.equal(await f.panel.preview(),false);
    assert.match(f.output.textContent,/Invalid regular expression/);
  } finally {f.cleanup();}
});
test("Pages rejects project switches after preview",async()=>{
  const f=fixture();
  try {
    await f.workspace.choose();
    await f.panel.preview();
    f.selectRoot(directory("other", []));
    await f.workspace.choose();
    assert.equal(await f.panel.apply(),false);
    assert.match(f.output.textContent,/Project changed since replacement preview/);
    assert.equal(f.first.state.content,"x <- 1\nx <- 2\n");
  } finally {f.cleanup();}
});
test("Pages wiring exposes real project replacement controls and module",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  for (const id of ["projectReplaceQuery","projectReplaceText","projectReplaceCase",
    "projectReplaceRegex","projectReplaceWholeWord","projectReplacePreview",
    "projectReplaceApply","projectReplaceOutput"])
    assert.ok(html.includes('id="'+id+'"'),"missing "+id);
  assert.match(html,/src="\.\/project_replace_panel\.js"/);
  assert.match(html,/FlowStudioProjectReplacePanel\.create\(/);
  assert.match(html,/isOpenHandle: projectWorkspace\.isOpenHandle/);
});
for (const [name, api] of [["Pages",Project],["native",require("../web/project.js")]]) {
  test(name+" awaits asynchronous editor-open guards before writing",async()=>{
    const first=file("a.R","x");
    const root=directory("work",[["a.R",first.handle()]]);
    const plan=await api.planProjectReplace(root,"x","z");
    let checked=false;
    await assert.rejects(api.applyProjectReplacement(plan,{
      isBlocked:async()=>{await Promise.resolve();checked=true;return true;}
    }),/Close the open editor tab/);
    assert.equal(checked,true);
    assert.equal(first.state.content,"x");
  });
}
