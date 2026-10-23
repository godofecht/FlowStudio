"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Workspace = require("../docs/app/project_workspace.js");
const Rename = require("../docs/app/project_rename.js");
const Save = require("../docs/app/file_save.js");
const Project = require("../docs/app/project.js");
function node(value="") {
  const listeners={};
  return {value,textContent:value,disabled:false,
    addEventListener(event,fn){listeners[event]=fn;},
    click(){return listeners.click?.();}};
}
function file(name,content) {
  return {kind:"file",name,content,
    async getFile(){return {size:Buffer.byteLength(this.content),text:async()=>this.content};},
    async isSameEntry(other){return this===other;},
    async createWritable(){let staged;return {
      write:async value=>{staged=value;},close:async()=>{this.content=staged;},abort:async()=>{}};}
  };
}
function directory(entries) {
  return {kind:"directory",name:"project",files:new Map(entries),
    async getFileHandle(name,options={}) {
      if (!this.files.has(name)) {
        if (!options.create) {const e=Error("Not found");e.name="NotFoundError";throw e;}
        this.files.set(name,file(name,""));
      }
      return this.files.get(name);
    },
    async removeEntry(name){if (!this.files.delete(name))throw Error("Missing file");}
  };
}
function fixture({confirm=()=>true,prompt=()=>"renamed.flow"}={}) {
  const original=file("main.flow","function main() -> i32 { return 0 }");
  const parent=directory([["main.flow",original]]);
  const source=node(""),filename=node(""),language=node("flow"),messages=[];
  const saveFileButton=node(),deleteFileButton=node(),renameFileButton=node();
  const controller=Workspace.create({
    projectApi:{validFilename:Project.validFilename,
      createProjectExplorer:()=>({choose:async()=>true,hasProject:()=>true,
        refresh:async()=>{},create:async()=>false})},
    fileSaveApi:Save,projectRenameApi:Rename,
    source,filename,language,tree:node(),openFolderButton:node(),
    saveFileButton,deleteFileButton,renameFileButton,newFileButton:node(),
    status:message=>messages.push(message),
    setFilename:(name,display)=>{filename.textContent=display;},
    onDraft:()=>{},picker:async()=>parent,
    confirmChange:confirm,promptName:prompt
  });
  return {controller,original,parent,source,filename,language,messages,
    saveFileButton,deleteFileButton,renameFileButton,
    open:()=>controller.openHandle(original,"project/main.flow",parent)};
}
test("rename updates active file, project path and subsequent saves",async()=>{
  const f=fixture();await f.open();
  assert.equal(f.renameFileButton.disabled,false);
  assert.equal(await f.controller.renameFile(),true);
  assert.equal(f.parent.files.has("main.flow"),false);
  assert.equal(f.filename.textContent,"project/renamed.flow");
  assert.equal(f.renameFileButton.disabled,false);
  f.source.value="new source";
  assert.equal(await f.controller.save(),true);
  assert.equal(f.parent.files.get("renamed.flow").content,"new source");
});
test("dirty editor cannot rename project source",async()=>{
  const f=fixture();await f.open();f.source.value+="edited";
  assert.equal(await f.controller.renameFile(),false);
  assert.equal(f.parent.files.size,1);
  assert.match(f.messages.join(" "),/unsaved changes/);
});
test("cancelled rename retains file association",async()=>{
  const f=fixture({confirm:()=>false});await f.open();
  assert.equal(await f.controller.renameFile(),false);
  assert.equal(f.filename.textContent,"project/main.flow");
  assert.equal(f.controller.hasActiveFile(),true);
  assert.equal(f.parent.files.size,1);
});
test("rename failure keeps the old file writable",async()=>{
  const f=fixture();await f.open();
  f.parent.files.set("renamed.flow",file("renamed.flow","other"));
  assert.equal(await f.controller.renameFile(),false);
  assert.equal(f.filename.textContent,"project/main.flow");
  f.source.value="new source";
  assert.equal(await f.controller.save(),true);
  assert.equal(f.original.content,"new source");
  assert.equal(f.parent.files.get("renamed.flow").content,"other");
});
test("rename blocks concurrent file saves and project switches",async()=>{
  const f=fixture();await f.open();
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;});
  const begun=new Promise(resolve=>{started=resolve;});
  const originalGet=f.parent.getFileHandle.bind(f.parent);
  f.parent.getFileHandle=async(name,options)=>{
    const h=await originalGet(name,options);
    if(name==="renamed.flow"&&options?.create) {
      const writable=h.createWritable.bind(h);
      h.createWritable=async()=>{const stream=await writable();const write=stream.write;
        stream.write=async text=>{started();await gate;await write(text);};return stream;};
    }
    return h;
  };
  const pending=f.controller.renameFile();
  await begun;
  assert.equal(await f.controller.save(),false);
  assert.equal(await f.controller.deleteFile(),false);
  assert.equal(await f.controller.choose(),false);
  release();
  assert.equal(await pending,true);
});
test("browser UI includes the rename module, action and controller",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html,/id="renameProjectFile"/);
  assert.match(html,/src="\.\/project_rename\.js"/);
  assert.match(html,/projectRenameApi: .*FlowStudioProjectRename/);
  assert.match(html,/renameFileButton: \$\("renameProjectFile"\)/);
});
