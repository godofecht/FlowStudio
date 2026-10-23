"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {create} = require("../docs/app/notebook_io.js");
const format = require("../docs/app/notebook_format.js");
const {parseCells} = require("../docs/app/source_cells.js");
function button() {const handlers={};return {addEventListener(t,fn){handlers[t]=fn;},click(){return handlers.click?.();},change(files){return handlers.change({target:{files,value:"old"}});}};}
function fixture() {
  const openButton=button(),fileInput=button(),saveButton=button(),source={value:""},language={value:"python"};
  const messages=[], imported=[], exported=[];
  let busy=false,allow=true;
  create({openButton,fileInput,saveButton,source,language,format,parseCells,
    isBusy:()=>busy,canReplace:()=>allow,
    onImported:async(item,name)=>{imported.push([item,name]);source.value=item.source;language.value=item.language;},
    onExport:(json,name)=>exported.push([JSON.parse(json),name]),
    getResults:()=>[],getFilename:()=>"study.py",notice:message=>messages.push(message)});
  return {openButton,fileInput,saveButton,source,language,messages,imported,exported,
    busy(value){busy=value;},allow(value){allow=value;}};
}
function file(text,name="study.ipynb") {return {name,size:new TextEncoder().encode(text).length,text:async()=>text};}
const notebook=JSON.stringify({nbformat:4,nbformat_minor:4,metadata:{language_info:{name:"r"}},cells:[{cell_type:"code",source:"x <- 1",metadata:{},outputs:[]}]});
test("imports an actual nbformat document and exports from the editor",async()=>{
  const f=fixture();
  await f.fileInput.change([file(notebook)]);
  assert.equal(f.imported.length,1);
  assert.equal(f.language.value,"r");
  assert.match(f.source.value,/x <- 1/);
  f.saveButton.click();
  assert.equal(f.exported[0][1],"study.ipynb");
  assert.equal(f.exported[0][0].cells[0].source,"x <- 1");
});
test("refuses to overwrite dirty editor when confirmation declined",async()=>{
  const f=fixture();f.allow(false);
  await f.fileInput.change([file(notebook)]);
  assert.equal(f.imported.length,0);
});
test("refuses file import or export while notebook is running",async()=>{
  const f=fixture();f.busy(true);
  await f.fileInput.change([file(notebook)]);f.saveButton.click();
  assert.equal(f.imported.length,0);assert.equal(f.exported.length,0);
  assert.match(f.messages.join(" "),/Wait for notebook execution/);
});
test("rejects oversized and invalid notebook data without changing editor",async()=>{
  const f=fixture();f.source.value="keep";
  await f.fileInput.change([{name:"huge.ipynb",size:format.MAX_JSON_BYTES+1,text:async()=>""}]);
  await f.fileInput.change([file("not JSON")]);
  assert.equal(f.imported.length,0);assert.equal(f.source.value,"keep");
  assert.match(f.messages.join(" "),/import failed/);
});
