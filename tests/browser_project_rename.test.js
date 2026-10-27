"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Rename = require("../docs/app/project_rename.js");
const Save = {
  async readSnapshot(h) {return (await h.getFile()).text();},
  async writeIfUnchanged(h, old, next) {
    if (await this.readSnapshot(h) !== old) throw Error("Destination changed externally");
    const writer = await h.createWritable();
    await writer.write(next); await writer.close(); return next;
  }
};
const valid = name => /\.(flow|py|r)$/i.test(name) && !/[\\/]/.test(name);
function file(name, content) {
  return {kind:"file",name,content,
    async getFile() {return {text:async()=>this.content};},
    async isSameEntry(other) {return this===other;},
    async createWritable() {let staged; return {
      write:async text=>{staged=text;},close:async()=>{this.content=staged;},abort:async()=>{}};}
  };
}
function directory(items) {
  return {kind:"directory",files:new Map(items),
    async getFileHandle(name,options={}) {
      if (!this.files.has(name)) {
        if (!options.create) {const e=Error("Not found");e.name="NotFoundError";throw e;}
        this.files.set(name,file(name,""));
      }
      return this.files.get(name);
    },
    async removeEntry(name) {if (!this.files.delete(name)) throw Error("Missing file");}
  };
}
function fixture() {
  const source=file("main.flow","function main() -> i32 { return 0 }");
  const parent=directory([["main.flow",source]]);
  return {source,parent,args:{parent,handle:source,name:"main.flow",nextName:"new.flow",
    baseline:source.content,fileSaveApi:Save,validFilename:valid,confirmRename:()=>true}};
}
test("renames the exact source with its contents intact",async()=>{
  const f=fixture(), result=await Rename.rename(f.args);
  assert.equal(result.name,"new.flow");assert.equal(result.source,f.args.baseline);
  assert.equal(f.parent.files.has("main.flow"),false);
  assert.equal(f.parent.files.get("new.flow").content,f.args.baseline);
});
test("rejects a preexisting destination without writing",async()=>{
  const f=fixture();f.parent.files.set("new.flow",file("new.flow","valuable"));
  await assert.rejects(Rename.rename(f.args),/already exists/);
  assert.equal(f.parent.files.get("new.flow").content,"valuable");
  assert.equal(f.parent.files.get("main.flow"),f.source);
});
test("rejects source changed since editor baseline",async()=>{
  const f=fixture();f.source.content="external";
  await assert.rejects(Rename.rename(f.args),/changed on disk/);
  assert.equal(f.parent.files.size,1);
});
test("rejects source replaced by a different handle",async()=>{
  const f=fixture();f.parent.files.set("main.flow",file("main.flow",f.source.content));
  await assert.rejects(Rename.rename(f.args),/replaced externally/);
});
test("rejects invalid and identical filenames",async()=>{
  for(const nextName of ["../bad.flow","file.exe","main.flow"]) {
    const f=fixture();await assert.rejects(Rename.rename({...f.args,nextName}),/different supported/);
    assert.equal(f.parent.files.size,1);
  }
});
test("cancellation does not create destination",async()=>{
  const f=fixture();assert.equal(await Rename.rename({...f.args,confirmRename:()=>false}),null);
  assert.equal(f.parent.files.size,1);
});
test("rechecks source after confirmation",async()=>{
  const f=fixture();await assert.rejects(Rename.rename({...f.args,confirmRename:()=>{
    f.source.content="concurrent";return true;}}),/changed on disk/);
  assert.equal(f.parent.files.size,1);
});
test("detects destination appearing during confirmation",async()=>{
  const f=fixture();await assert.rejects(Rename.rename({...f.args,confirmRename:()=>{
    f.parent.files.set("new.flow",file("new.flow","other"));return true;}}),/appeared during rename/);
  assert.equal(f.parent.files.get("new.flow").content,"other");
});
test("write failure retains source and cleans empty destination",async()=>{
  const f=fixture();const original=f.parent.getFileHandle.bind(f.parent);
  f.parent.getFileHandle=async(name,opts)=>{
    const h=await original(name,opts);
    if(name==="new.flow")h.createWritable=async()=>{throw Error("permission denied");};
    return h;
  };
  await assert.rejects(Rename.rename(f.args),/permission denied/);
  assert.equal(f.parent.files.size,1);assert.equal(f.parent.files.get("main.flow"),f.source);
});
test("external source edit after copy retains both copies",async()=>{
  const f=fixture();const original=f.parent.getFileHandle.bind(f.parent);
  f.parent.getFileHandle=async(name,opts)=>{
    const h=await original(name,opts);
    if(name==="new.flow" && opts?.create){const writable=h.createWritable.bind(h);
      h.createWritable=async()=>{const w=await writable();const close=w.close;
        w.close=async()=>{await close();f.source.content="external";};return w;};}
    return h;
  };
  await assert.rejects(Rename.rename(f.args),/Rename incomplete/);
  assert.equal(f.parent.files.get("main.flow").content,"external");
  assert.equal(f.parent.files.get("new.flow").content,f.args.baseline);
});
test("remove failure retains copied destination and original",async()=>{
  const f=fixture();f.parent.removeEntry=async()=>{throw Error("cannot remove");};
  await assert.rejects(Rename.rename(f.args),/Rename incomplete/);
  assert.equal(f.parent.files.size,2);
});
test("destination alias to original is rejected",async()=>{
  const f=fixture();const original=f.parent.getFileHandle.bind(f.parent);
  f.parent.getFileHandle=async(name,opts)=>{
    if(name==="new.flow"&&opts?.create)return f.source;
    return original(name,opts);
  };
  await assert.rejects(Rename.rename(f.args),/resolves to the original/);
  assert.equal(f.source.content,f.args.baseline);
});
test("permission errors on destination lookup do not create files",async()=>{
  const f=fixture();const original=f.parent.getFileHandle.bind(f.parent);
  f.parent.getFileHandle=async(name,opts)=>{
    if(name==="new.flow") {const e=Error("denied");e.name="NotAllowedError";throw e;}
    return original(name,opts);
  };
  await assert.rejects(Rename.rename(f.args),/denied/);
  assert.equal(f.parent.files.size,1);
});

test("rename fails closed when source identity cannot be verified",async()=>{
  const f=fixture();
  delete f.source.isSameEntry;
  await assert.rejects(Rename.rename(f.args),/identity cannot be verified/);
  assert.equal(f.parent.files.size,1);
  assert.equal(f.parent.files.get("main.flow"),f.source);
});

test("rename refuses an unverifiable destination before writing any source bytes",async()=>{
  const f=fixture();
  const original=f.parent.getFileHandle.bind(f.parent);
  f.parent.getFileHandle=async(name,opts)=>{
    const handle=await original(name,opts);
    if(name==="new.flow" && opts?.create) {
      delete f.source.isSameEntry;
      delete handle.isSameEntry;
    }
    return handle;
  };
  await assert.rejects(Rename.rename(f.args),/Cannot verify that the destination differs/);
  assert.equal(f.parent.files.get("main.flow").content,f.args.baseline);
  assert.equal(f.parent.files.get("new.flow")?.content,"",
    "unverifiable empty destination is retained for manual inspection, not overwritten or deleted");
});
