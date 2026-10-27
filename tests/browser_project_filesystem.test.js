"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Project = require("../docs/app/project.js");
const Save = require("../docs/app/file_save.js");
const Workspace = require("../docs/app/project_workspace.js");
function node() {
  const listeners = {};
  return {children:[], disabled:false, textContent:"", value:"", open:false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children=children; },
    addEventListener(name,fn) {listeners[name]=fn;},
    click() { return listeners.click(); }};
}
function file(name, content) {
  return {kind:"file", name, content,
    async getFile() {return {size:Buffer.byteLength(this.content),text:async()=>this.content};},
    async createWritable() {
      let staged = "";
      return {write:async v=>{staged=v;},close:async()=>{this.content=staged;},abort:async()=>{}};
    }};
}
function fixture() {
  const previous = global.document;
  global.document={createElement:()=>node()};
  const source=node(), filename=node(), language=node(), tree=node();
  source.value="initial"; language.value="python";
  const root={kind:"directory",name:"research",files:new Map([
    ["main.flow",file("main.flow","function main() -> i32 { return 0 }")],
    ["analysis.py",file("analysis.py","x = 3")]]),
    async *entries(){for(const pair of this.files) yield pair;},
    async getFileHandle(name,{create}={}){
      if (!this.files.has(name) && create) this.files.set(name,file(name,""));
      if (!this.files.has(name)) { const error = Error("missing file"); error.name = "NotFoundError"; throw error; }
      return this.files.get(name);
    }};
  const openFolderButton=node(),saveFileButton=node(),newFileButton=node();
  const messages=[];
  const controller=Workspace.create({projectApi:Project,fileSaveApi:Save,
    source,filename,language,tree,openFolderButton,saveFileButton,newFileButton,
    status:message=>messages.push(message),onDraft:()=>{},
    setFilename:(name,path)=>{filename.textContent=path;},
    picker:async()=>root,confirmChange:()=>true,promptName:()=>"new.flow"});
  return {source,filename,language,tree,root,controller,messages,cleanup:()=>{global.document=previous;}};
}
test("real project explorer opens Flow source and saves via writable handle",async()=>{
  const f=fixture();
  try {
    assert.equal(await f.controller.choose(),true);
    assert.equal(f.tree.children.length,3);
    const flowButton=f.tree.children.find(x=>x.textContent==="File: main.flow");
    assert.ok(flowButton);
    await flowButton.click();
    assert.equal(f.language.value,"flow");
    assert.match(f.source.value,/function main/);
    f.source.value="function main() -> i32 { return 42 }";
    assert.equal(await f.controller.save(),true);
    assert.equal(f.root.files.get("main.flow").content,f.source.value);
    f.root.files.get("main.flow").content="external";
    f.source.value="unsaved";
    assert.equal(await f.controller.save(),false);
    assert.equal(f.root.files.get("main.flow").content,"external");
  } finally {f.cleanup();}
});
test("real project explorer creates a source file and opens it",async()=>{
  const f=fixture();
  try {
    await f.controller.choose();
    assert.equal(await f.controller.createFile(),true);
    assert.equal(f.root.files.get("new.flow").content,"");
    assert.equal(f.filename.textContent,"research/new.flow");
    assert.equal(f.language.value,"flow");
    assert.equal(f.source.value,"");
  } finally {f.cleanup();}
});
