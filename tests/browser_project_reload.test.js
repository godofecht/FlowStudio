"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Workspace = require("../docs/app/project_workspace.js");
const Save = require("../docs/app/file_save.js");
const SaveAs = require("../docs/app/project_save_as.js");

function node(value = "") {
  const listeners = {};
  return {value, textContent:value, disabled:false,
    addEventListener(type, fn) { listeners[type] = fn; },
    click() { return listeners.click?.(); }};
}
function file(name, content) {
  return {kind:"file", name, content,
    async getFile() {
      const snapshot = this.content;
      return {size:Buffer.byteLength(snapshot), text:async()=>snapshot};
    },
    async isSameEntry(other) { return this === other; },
    async createWritable() {
      let staged;
      return {write:async value=>{staged=value;},
        close:async()=>{this.content=staged;},abort:async()=>{}};
    }};
}
function fixture({confirm=()=>true, picker=null}={}) {
  const original=file("analysis.flow","function main() -> i32 { return 0 }");
  const parent={kind:"directory",entry:original,
    async getFileHandle(name) {
      if (name !== "analysis.flow" || !this.entry) {
        const error=Error("Missing file"); error.name="NotFoundError"; throw error;
      }
      return this.entry;
    }};
  const source=node("scratch"), filename=node("untitled.flow"), language=node("flow");
  const reloadFileButton=node(), saveFileButton=node(), messages=[], names=[];
  let drafts=0;
  const controller=Workspace.create({
    projectApi:{validFilename:()=>true,
      createProjectExplorer:()=>({choose:async()=>true,hasProject:()=>true,refresh:async()=>{}})},
    fileSaveApi:Save,saveAsApi:SaveAs,
    source,filename,language,tree:node(),openFolderButton:node(),
    saveFileButton,reloadFileButton,saveAsButton:node(),newFileButton:node(),
    deleteFileButton:node(),renameFileButton:node(),
    status:message=>messages.push(message),
    setFilename:(name,display)=>{filename.textContent=display;names.push(name);},
    onDraft:()=>{drafts++;},picker:async()=>parent,
    saveAsPicker:picker,confirmChange:confirm,promptName:()=>null
  });
  return {controller,original,parent,source,filename,language,reloadFileButton,
    saveFileButton,messages,names,drafts:()=>drafts,
    open:()=>controller.openHandle(original,"project/analysis.flow",parent)};
}

test("reload takes external disk edits into the editor and updates the save baseline",async()=>{
  const f=fixture();
  assert.equal(f.reloadFileButton.disabled,true);
  await f.open();
  assert.equal(f.reloadFileButton.disabled,false);
  f.original.content="external edit";
  assert.equal(await f.controller.reloadFile(),true);
  assert.equal(f.source.value,"external edit");
  assert.equal(f.controller.dirty(),false);
  f.source.value="new edit";
  assert.equal(await f.controller.save(),true);
  assert.equal(f.original.content,"new edit");
  assert.match(f.messages.join(" "),/Reloaded project\/analysis.flow from disk/);
});
test("dirty source requires confirmation and cancellation preserves both baselines",async()=>{
  let prompts=0;
  const f=fixture({confirm:()=>{prompts++;return false;}});
  await f.open(); f.source.value="unsaved"; f.original.content="external";
  assert.equal(await f.controller.reloadFile(),false);
  assert.equal(prompts,1);
  assert.equal(f.source.value,"unsaved");
  assert.equal(f.controller.dirty(),true);
  assert.equal(await f.controller.save(),false);
  assert.equal(f.original.content,"external");
});
test("confirmed reload discards only the editor draft and retains the disk file",async()=>{
  const f=fixture(); await f.open();
  f.source.value="unsaved"; f.original.content="external";
  assert.equal(await f.controller.reloadFile(),true);
  assert.equal(f.source.value,"external");
  assert.equal(f.original.content,"external");
  assert.equal(f.controller.dirty(),false);
  assert.equal(f.names.length,2);
});
test("unchanged clean file is a no-op without notebook invalidation",async()=>{
  const f=fixture();await f.open();
  const drafts=f.drafts(), names=f.names.length;
  assert.equal(await f.controller.reloadFile(),true);
  assert.equal(f.drafts(),drafts);
  assert.equal(f.names.length,names);
  assert.match(f.messages.at(-1),/already matches disk/);
});
test("same-content external replacement is rejected by handle identity",async()=>{
  const f=fixture();await f.open();
  f.parent.entry=file("analysis.flow",f.original.content);
  assert.equal(await f.controller.reloadFile(),false);
  assert.equal(f.source.value,f.original.content);
  assert.match(f.messages.at(-1),/replaced or cannot be verified/);
});
test("missing or inaccessible project entry leaves editor untouched",async()=>{
  const f=fixture();await f.open();
  f.parent.entry=null; f.source.value="keep";
  assert.equal(await f.controller.reloadFile(),false);
  assert.equal(f.source.value,"keep");
  assert.match(f.messages.at(-1),/Missing file/);
});
test("source exceeding the existing 2 MiB read limit is not loaded",async()=>{
  const f=fixture();await f.open();
  f.original.content="x".repeat(Save.MAX_BYTES+1);
  assert.equal(await f.controller.reloadFile(),false);
  assert.equal(f.source.value,"function main() -> i32 { return 0 }");
  assert.match(f.messages.at(-1),/2 MiB/);
});
test("edits made while disk read is pending cannot be overwritten",async()=>{
  const f=fixture();await f.open();
  let release, started;
  const gate=new Promise(resolve=>{release=resolve;});
  const begun=new Promise(resolve=>{started=resolve;});
  const get=f.original.getFile.bind(f.original);
  f.original.getFile=async()=>{started();await gate;return get();};
  const pending=f.controller.reloadFile();
  await begun;
  f.source.value="typed during reload";
  release();
  assert.equal(await pending,false);
  assert.equal(f.source.value,"typed during reload");
  assert.match(f.messages.at(-1),/Editor changed during reload/);
});
test("reload serializes disk operations and project switching",async()=>{
  const f=fixture();await f.open();
  let release, started;
  const gate=new Promise(resolve=>{release=resolve;});
  const begun=new Promise(resolve=>{started=resolve;});
  const get=f.original.getFile.bind(f.original);
  f.original.getFile=async()=>{started();await gate;return get();};
  const pending=f.controller.reloadFile();
  await begun;
  assert.equal(await f.controller.save(),false);
  assert.equal(await f.controller.choose(),false);
  assert.match(f.messages.join(" "),/File operation already running/);
  release();
  assert.equal(await pending,true);
});
test("changing disk contents between two reads fails without advancing baseline",async()=>{
  const f=fixture();await f.open();
  let reads=0;
  const get=f.original.getFile.bind(f.original);
  f.original.getFile=async()=>{
    reads++;
    const snapshot=await get();
    if(reads===1) f.original.content="changed after first read";
    return snapshot;
  };
  assert.equal(await f.controller.reloadFile(),false);
  assert.match(f.messages.at(-1),/changed during reload/);
  assert.equal(f.source.value,"function main() -> i32 { return 0 }");
  assert.equal(f.controller.dirty(),false);
});
test("Save As file can reload through its selected handle without a project parent",async()=>{
  const selected=file("export.py","");
  const f=fixture({picker:async()=>selected});await f.open();
  assert.equal(await f.controller.saveAs(),true);
  assert.equal(f.reloadFileButton.disabled,false);
  selected.content="print('external')";
  assert.equal(await f.controller.reloadFile(),true);
  assert.equal(f.source.value,"print('external')");
  assert.equal(f.filename.textContent,"export.py");
});
test("detaching the editor disables disk reload",async()=>{
  const f=fixture();await f.open();
  f.controller.notifyExternalOpen();
  assert.equal(f.reloadFileButton.disabled,true);
  assert.equal(await f.controller.reloadFile(),false);
  assert.match(f.messages.at(-1),/Open a project file/);
});
test("browser page wires the actual reload button to the workspace",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html,/id="reloadProjectFile" type="button" disabled/);
  assert.match(html,/reloadFileButton: \$\("reloadProjectFile"\)/);
});
