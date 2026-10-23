"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {create} = require("../docs/app/project_workspace.js");
function setup() {
  const source={value:"start"}, filename={textContent:"untitled.py"}, language={value:"python"};
  const button=()=>({disabled:false,addEventListener(){}});
  const saveFileButton=button(), messages=[];
  let open, allow=false, failRead=false;
  const handle={text:"print(1)"};
  const projectApi={validFilename:()=>true,createProjectExplorer:opts=>{
    open=opts.openHandle;
    return {hasProject:()=>true,choose:async()=>true,create:async()=>open(handle,"p/main.py")};
  }};
  const fileSaveApi={readSnapshot:async()=>{if(failRead)throw Error("read failed");return handle.text;},
    writeIfUnchanged:async(_,baseline,text)=>{
      if(handle.text!==baseline)throw Error("conflict");handle.text=text;return text;
    }};
  const controller=create({projectApi,fileSaveApi,source,filename,language,tree:{},
    openFolderButton:button(),saveFileButton,newFileButton:button(),
    status:m=>messages.push(m),setFilename:(n,p)=>filename.textContent=p,
    onDraft:()=>{},picker:()=>{},confirmChange:()=>allow,promptName:()=>"main.py"});
  return {controller,source,filename,handle,messages,open:()=>open(handle,"p/main.py"),
    allow:()=>allow=true,failRead:()=>failRead=true,saveFileButton};
}
test("unsaved source cannot be replaced without confirmation",async()=>{
  const f=setup();await f.open();f.source.value="changed";
  assert.equal(await f.open(),false);assert.equal(f.source.value,"changed");
  f.allow();assert.equal(await f.open(),true);assert.equal(f.source.value,"print(1)");
});
test("disk conflict does not overwrite changed source",async()=>{
  const f=setup();await f.open();f.source.value="print(2)";f.handle.text="external";
  assert.equal(await f.controller.save(),false);assert.equal(f.handle.text,"external");
  assert.match(f.messages.at(-1),/conflict/);
});
test("failed file reads preserve editor and active handle",async()=>{
  const f=setup();await f.open();f.failRead();
  await assert.rejects(f.open(),/read failed/);
  assert.equal(f.source.value,"print(1)");assert.equal(f.controller.hasActiveFile(),true);
});
test("external file picker detaches writable project handle",async()=>{
  const f=setup();await f.open();f.source.value="external source";
  f.controller.notifyExternalOpen();
  assert.equal(f.controller.hasActiveFile(),false);
  assert.equal(f.saveFileButton.disabled,true);
});
