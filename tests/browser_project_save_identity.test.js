"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Workspace = require("../docs/app/project_workspace.js");

const element = (value = "") => ({value, textContent:value, disabled:false, addEventListener() {}});
const file = content => ({content, async isSameEntry(other) {return this === other;}});
function fixture({projectFile = true} = {}) {
  const original = file("function main() -> i32 { return 0 }");
  const parent = {entry:original, async getFileHandle(name) {
    assert.equal(name, "main.flow");
    return this.entry;
  }};
  const source = element("scratch"), filename = element("untitled.flow"), messages = [];
  let writes = 0;
  const saveApi = {
    async readSnapshot(handle) {return handle.content;},
    async writeIfUnchanged(handle, baseline, next) {
      writes++;
      if (handle.content !== baseline) throw Error("Disk conflict");
      handle.content = next;
      return next;
    }
  };
  const controller = Workspace.create({
    projectApi:{validFilename:()=>true,
      createProjectExplorer:()=>({choose:async()=>true,hasProject:()=>true,refresh:async()=>{}})},
    fileSaveApi:saveApi, source, filename, language:element("flow"),
    tree:element(), openFolderButton:element(), saveFileButton:element(), newFileButton:element(),
    status:message=>messages.push(message),
    setFilename:(name,path)=>{filename.textContent=path;},
    onDraft:()=>{},picker:async()=>parent,confirmChange:()=>true,promptName:()=>null
  });
  return {original,parent,source,messages,saveApi,controller,writes:()=>writes,
    open:()=>controller.openHandle(original,"src/main.flow",projectFile ? parent : null)};
}
test("project save checks identity and verifies committed bytes",async()=>{
  const f=fixture();await f.open();f.source.value="new source";
  assert.equal(await f.controller.save(),true);
  assert.equal(f.original.content,"new source");
  assert.equal(f.controller.dirty(),false);
  assert.equal(f.writes(),1);
  assert.match(f.messages.at(-1),/^Saved src\/main.flow to disk/);
});
test("same-content replacement at project path refuses to write",async()=>{
  const f=fixture();await f.open();f.source.value="edit";
  f.parent.entry=file(f.original.content);
  assert.equal(await f.controller.save(),false);
  assert.equal(f.writes(),0);
  assert.equal(f.controller.dirty(),true);
  assert.match(f.messages.at(-1),/replaced or cannot be verified/);
});
test("unverifiable project file identity fails closed",async()=>{
  const f=fixture();await f.open();f.source.value="edit";
  f.parent.entry={content:f.original.content};
  assert.equal(await f.controller.save(),false);
  assert.equal(f.writes(),0);
});
test("replacement during write is reported, not accepted",async()=>{
  const f=fixture();await f.open();f.source.value="edit";
  const write=f.saveApi.writeIfUnchanged.bind(f.saveApi);
  f.saveApi.writeIfUnchanged=async(...args)=>{
    const saved=await write(...args);
    f.parent.entry=file("external replacement");
    return saved;
  };
  assert.equal(await f.controller.save(),false);
  assert.equal(f.original.content,"edit");
  assert.equal(f.parent.entry.content,"external replacement");
  assert.equal(f.controller.dirty(),true);
});
test("external modification after write retains old conflict baseline",async()=>{
  const f=fixture();await f.open();f.source.value="edit";
  const write=f.saveApi.writeIfUnchanged.bind(f.saveApi);
  f.saveApi.writeIfUnchanged=async(...args)=>{
    const saved=await write(...args);f.original.content="external";return saved;
  };
  assert.equal(await f.controller.save(),false);
  assert.equal(f.controller.dirty(),true);
  assert.match(f.messages.at(-1),/File changed during save/);
  assert.equal(await f.controller.save(),false);
  assert.match(f.messages.at(-1),/Disk conflict/);
});
test("typing during an awaited write preserves newer unsaved edits",async()=>{
  const f=fixture();await f.open();f.source.value="snapshot";
  const write=f.saveApi.writeIfUnchanged.bind(f.saveApi);
  f.saveApi.writeIfUnchanged=async(...args)=>{
    const saved=await write(...args);f.source.value="typed later";return saved;
  };
  assert.equal(await f.controller.save(),true);
  assert.equal(f.original.content,"snapshot");
  assert.equal(f.source.value,"typed later");
  assert.equal(f.controller.dirty(),true);
  assert.match(f.messages.at(-1),/newer editor changes remain unsaved/);
});
test("Save As-associated files outside project remain writable",async()=>{
  const f=fixture({projectFile:false});await f.open();f.source.value="standalone";
  assert.equal(await f.controller.save(),true);
  assert.equal(f.original.content,"standalone");
});
test("post-write readback failure cannot be reported as a successful save",async()=>{
  const f=fixture();await f.open();f.source.value="snapshot";
  f.saveApi.readSnapshot=async()=>{throw Error("Readback permission denied");};
  assert.equal(await f.controller.save(),false);
  assert.equal(f.original.content,"snapshot");
  assert.equal(f.controller.dirty(),true);
  assert.match(f.messages.at(-1),/Readback permission denied/);
});
