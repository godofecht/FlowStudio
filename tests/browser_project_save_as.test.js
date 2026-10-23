"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const SaveAs = require("../docs/app/project_save_as.js");
const Save = require("../docs/app/file_save.js");
const Project = require("../docs/app/project.js");
function file(name, content) {
  return {kind:"file", name, content,
    async getFile() {return {size:Buffer.byteLength(this.content), text:async()=>this.content};},
    async isSameEntry(other) {return this===other;},
    async createWritable() {
      let staged;
      return {write:async text=>{staged=text;}, close:async()=>{this.content=staged;}, abort:async()=>{}};
    }};
}
function options(handle, extras={}) {
  return {picker:async()=>handle, fileSaveApi:Save, validFilename:Project.validFilename,
    filename:"analysis.flow", source:()=>"new source", activeHandle:null, activeBaseline:null,
    confirmOverwrite:()=>true, ...extras};
}
test("Save As writes selected browser handle without touching another file",async()=>{
  const original=file("analysis.flow","original"), selected=file("copy.flow","");
  const result=await SaveAs.save(options(selected,{activeHandle:original,activeBaseline:"original"}));
  assert.equal(selected.content,"new source"); assert.equal(original.content,"original");
  assert.equal(result.name,"copy.flow"); assert.equal(result.source,"new source");
});
test("Save As refuses overwrite when user declines",async()=>{
  const selected=file("existing.py","valuable");
  assert.equal(await SaveAs.save(options(selected,{confirmOverwrite:()=>false})),null);
  assert.equal(selected.content,"valuable");
});
test("Save As rejects external edits after the file-picker baseline",async()=>{
  const selected=file("existing.py","original");
  await assert.rejects(()=>SaveAs.save(options(selected,{confirmOverwrite:()=>{selected.content="external";return true;}})),Save.FileConflictError);
  assert.equal(selected.content,"external");
});
test("Save As on active file reuses original baseline",async()=>{
  const selected=file("analysis.flow","external");
  await assert.rejects(()=>SaveAs.save(options(selected,{activeHandle:selected,activeBaseline:"old"})),Save.FileConflictError);
  assert.equal(selected.content,"external");
});
test("Save As detects the same underlying file through isSameEntry",async()=>{
  const original=file("analysis.flow","before"), selected=file("analysis.flow","external");
  selected.isSameEntry=async()=>true;
  await assert.rejects(()=>SaveAs.save(options(selected,{activeHandle:original,activeBaseline:"before"})),Save.FileConflictError);
});
test("Save As refuses invalid names and directory handles",async()=>{
  for(const handle of [file("../bad.py",""),file("bad.exe",""),{kind:"directory",name:"dir"}])
    await assert.rejects(()=>SaveAs.save(options(handle)),/supported source filename/);
});
test("Save As rejects missing browser picker",async()=>{
  await assert.rejects(()=>SaveAs.save(options(null,{picker:null})),/File System Access API/);
});
test("Save As samples current source after user confirms",async()=>{
  const selected=file("analysis.py",""); let source="before";
  await SaveAs.save(options(selected,{source:()=>source,confirmOverwrite:()=>{source="after";return true;}}));
  assert.equal(selected.content,"after");
});
test("Save As does not attach to a failed write",async()=>{
  const selected=file("analysis.py","old");
  selected.createWritable=async()=>({write:async()=>{throw Error("disk full");},abort:async()=>{}});
  await assert.rejects(()=>SaveAs.save(options(selected)),/disk full/);
  assert.equal(selected.content,"old");
});
