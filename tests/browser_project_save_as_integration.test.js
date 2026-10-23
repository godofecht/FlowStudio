"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Workspace = require("../docs/app/project_workspace.js");
const Project = require("../docs/app/project.js");
const Save = require("../docs/app/file_save.js");
const SaveAs = require("../docs/app/project_save_as.js");
function node(value="") {
  const listeners = {};
  return {value, textContent:value, disabled:false,
    addEventListener(event, fn) {listeners[event]=fn;},
    click() {return listeners.click?.();}};
}
function file(name, content) {
  return {kind:"file", name, content,
    async getFile() {return {size:Buffer.byteLength(this.content),text:async()=>this.content};},
    async isSameEntry(other) {return this===other;},
    async createWritable() {
      let staged;
      return {write:async text=>{staged=text;},close:async()=>{this.content=staged;},abort:async()=>{}};
    }};
}
function fixture({picker, confirm=()=>true}={}) {
  const source=node("source contents"), filename=node("untitled.py"), language=node("python");
  const saveFileButton=node(), saveAsButton=node(), deleteFileButton=node();
  const messages=[];
  const controller=Workspace.create({
    projectApi:{validFilename:Project.validFilename,
      createProjectExplorer:()=>({choose:async()=>true,hasProject:()=>true,refresh:async()=>{}})},
    fileSaveApi:Save, saveAsApi:SaveAs,
    source,filename,language,tree:node(),openFolderButton:node(),
    saveFileButton,saveAsButton,newFileButton:node(),deleteFileButton,
    status:message=>messages.push(message),setFilename:(name,display)=>{filename.textContent=display;},
    onDraft:()=>{},picker:async()=>({kind:"directory",name:"project"}),
    saveAsPicker:picker,confirmChange:confirm,promptName:()=>null
  });
  return {controller,source,filename,language,saveFileButton,saveAsButton,deleteFileButton,messages};
}
test("Save As attaches a newly selected file for subsequent saves",async()=>{
  const selected=file("copy.flow","");
  const f=fixture({picker:async()=>selected});
  assert.equal(await f.controller.saveAs(),true);
  assert.equal(selected.content,"source contents");
  assert.equal(f.filename.textContent,"copy.flow");
  assert.equal(f.language.value,"flow");
  assert.equal(f.saveFileButton.disabled,false);
  assert.equal(f.deleteFileButton.disabled,true);
  assert.equal(f.controller.dirty(),false);
  f.source.value="changed";
  assert.equal(await f.controller.save(),true);
  assert.equal(selected.content,"changed");
});
test("Save As preserves the original project file and detaches project deletion",async()=>{
  const original=file("main.py","original"), copy=file("copy.py","");
  const f=fixture({picker:async()=>copy});
  assert.equal(await f.controller.openHandle(original,"project/main.py",{kind:"directory"}),true);
  f.source.value="modified";
  assert.equal(await f.controller.saveAs(),true);
  assert.equal(original.content,"original");
  assert.equal(copy.content,"modified");
  assert.equal(f.deleteFileButton.disabled,true);
  assert.equal(f.controller.hasActiveFile(),true);
});
test("Cancelled Save As leaves existing editor association unchanged",async()=>{
  const original=file("main.py","original"), copy=file("copy.py","keep");
  const f=fixture({picker:async()=>copy,confirm:()=>false});
  await f.controller.openHandle(original,"project/main.py",{kind:"directory"});
  f.source.value="edited";
  assert.equal(await f.controller.saveAs(),false);
  assert.equal(copy.content,"keep");
  assert.equal(f.controller.dirty(),true);
  assert.equal(f.deleteFileButton.disabled,false);
  assert.equal(f.filename.textContent,"project/main.py");
});
test("Failed Save As retains the original active file and its baseline",async()=>{
  const original=file("main.py","original"), copy=file("copy.py","initial");
  const f=fixture({picker:async()=>copy,confirm:()=>{copy.content="external";return true;}});
  await f.controller.openHandle(original,"project/main.py",{kind:"directory"});
  f.source.value="edited";
  assert.equal(await f.controller.saveAs(),false);
  assert.equal(original.content,"original");
  assert.equal(copy.content,"external");
  assert.equal(f.deleteFileButton.disabled,false);
  assert.match(f.messages.join(" "),/Save As failed/);
});
test("Save As blocks concurrent saves, deletion, and project switching",async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const selected=file("new.py","");
  const f=fixture({picker:async()=>{await gate;return selected;}});
  const original=file("main.py","original");
  await f.controller.openHandle(original,"project/main.py",{kind:"directory"});
  const saving=f.controller.saveAs();
  assert.equal(await f.controller.save(),false);
  assert.equal(await f.controller.deleteFile(),false);
  assert.equal(await f.controller.choose(),false);
  release();
  assert.equal(await saving,true);
});
test("Source edits during Save As write remain unsaved in the editor",async()=>{
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;});
  const writing=new Promise(resolve=>{started=resolve;});
  const selected=file("new.py","");
  selected.createWritable=async()=>({
    write:async()=>{started();await gate;},
    close:async()=>{selected.content="source contents";},
    abort:async()=>{}
  });
  const f=fixture({picker:async()=>selected});
  const pending=f.controller.saveAs();
  await writing;
  f.source.value="newer editor change";
  release();
  assert.equal(await pending,true);
  assert.equal(selected.content,"source contents");
  assert.equal(f.controller.dirty(),true);
});
test("Browser page wires native Save As picker and module",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html,/id="saveAsProjectFile"/);
  assert.match(html,/src="\.\/project_save_as\.js"/);
  assert.match(html,/saveAsApi: .*FlowStudioProjectSaveAs/);
  assert.match(html,/saveAsButton: \$\("saveAsProjectFile"\)/);
  assert.match(html,/window\.showSaveFilePicker/);
});
