"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const transfer = require("../docs/app/variable_transfer.js");
const snapshots = require("../docs/app/session_snapshot.js");
const packet = {kind:"vector", type:"number", values:[1.5, 2.5]};
const scalar = {kind:"scalar", type:"boolean", values:[true]};
function snapshot(variables = [{name:"value", value:packet}], language = "python") {
  return {format:snapshots.FORMAT, language, variables, omitted:0, truncated:false};
}
function control() {
  return {disabled:false, value:"", handlers:{}, addEventListener(name, fn){this.handlers[name]=fn;},
    click(){this.handlers.click?.();}};
}
function fixture(overrides={}) {
  const exportButton=control(), importButton=control(), fileInput=control();
  let busy=false, epoch=0, selected="python";
  const messages=[], downloads=[], imports=[], refreshes=[];
  const api=snapshots.create({exportButton,importButton,fileInput,
    language:()=>selected, generation:()=>epoch, isBusy:()=>busy,
    setBusy:value=>{busy=value;}, notice:value=>messages.push(value),
    inspect:async()=>({ok:true,variables:[{name:"value"}]}),
    exportValue:async()=>({ok:true,value:packet}),
    importValue:async(lang,name,value)=>{imports.push({lang,name,value});return {ok:true};},
    refresh:async lang=>refreshes.push(lang),
    download:(text,name)=>downloads.push({text,name}),
    confirmOverwrite:()=>true, ...overrides});
  return {api,exportButton,importButton,fileInput,messages,downloads,imports,refreshes,
    reset:()=>{epoch++;busy=false;}, select:value=>{selected=value;}, busy:()=>busy};
}
test("snapshot format rejects duplicate, prototype, invalid, oversized and malformed values",()=>{
  assert.deepEqual(snapshots.validate(snapshot()),snapshot()); // structural validation
  for(const bad of [
    {...snapshot(),format:"wrong"},
    {...snapshot(),extra:true},
    {...snapshot(),language:"flow"},
    {...snapshot(),omitted:-1},
    {...snapshot(),truncated:"false"},
    snapshot([{name:"value",value:packet},{name:"value",value:scalar}]),
    snapshot([{name:"__proto__",value:packet}]),
    snapshot([{name:"x;exec",value:packet}]),
    snapshot([{name:"x",value:{kind:"scalar",type:"number",values:[NaN]}}]),
    snapshot(Array.from({length:65},(_,i)=>({name:"v"+i,value:scalar}))),
    snapshot([{name:"x",value:{kind:"vector",type:"string",values:["x".repeat(513)]}}])
  ]) assert.throws(()=>snapshots.validate(bad));
  assert.throws(()=>snapshots.validate(snapshot([{name:"x",value:{...packet,values:[Infinity]}}])));
  assert.equal(transfer.validate(packet),packet);
});
test("capture exports real interpreter responses in sorted order and counts omitted values",async()=>{
  const seen=[];
  const result=await snapshots.capture({language:"r",generation:()=>1,
    inspect:async()=>({ok:true,truncated:true,variables:[
      {name:"z"},{name:"unsupported"},{name:"__proto__"},{name:"a"}]}),
    exportValue:async(_,name)=>{seen.push(name);return name==="unsupported"?
      {ok:false,output:"classed value"}:{ok:true,value:name==="a"?scalar:packet};}});
  assert.deepEqual(seen,["a","unsupported","z"]);
  assert.deepEqual(result.variables,[{name:"a",value:scalar},{name:"z",value:packet}]);
  assert.equal(result.omitted,2);
  assert.equal(result.truncated,true);
});
test("capture bounds variable count, validates transfer values and never claims completeness",async()=>{
  const result=await snapshots.capture({language:"python",generation:()=>0,
    inspect:async()=>({ok:true,variables:Array.from({length:70},(_,i)=>({name:"x"+String(i).padStart(2,"0")}))}),
    exportValue:async()=>({ok:true,value:scalar})});
  assert.equal(result.variables.length,64);
  assert.equal(result.omitted,6);
  assert.equal(result.truncated,false);
});
test("restore validates every packet before any mutation, and refuses cross-language files",async()=>{
  let calls=0;
  const importer=async()=>{calls++;return {ok:true};};
  const invalid=snapshot([{name:"ok",value:scalar},{name:"bad",value:{...packet,values:[NaN]}}]);
  await assert.rejects(snapshots.restore({snapshot:invalid,language:"python",
    importValue:importer,generation:()=>0}));
  await assert.rejects(snapshots.restore({snapshot:snapshot(),language:"r",
    importValue:importer,generation:()=>0}),/language/);
  assert.equal(calls,0);
});
test("restore stops on failed binding and reports partial state without false rollback",async()=>{
  const calls=[];
  const data=snapshot([{name:"a",value:scalar},{name:"b",value:packet},{name:"c",value:scalar}]);
  await assert.rejects(snapshots.restore({snapshot:data,language:"python",generation:()=>0,
    importValue:async(_,name)=>{calls.push(name);return name==="b"?{ok:false,output:"locked"}:{ok:true};}}),
    /Restored 1 of 3 values; b: locked/);
  assert.deepEqual(calls,["a","b"]);
});
test("generation change between inspect and export prevents any interpreter read",async()=>{
  let epoch=0, exported=0;
  await assert.rejects(snapshots.capture({language:"r",generation:()=>epoch,
    inspect:async()=>{epoch++;return {ok:true,variables:[{name:"x"}]};},
    exportValue:async()=>{exported++;return {ok:true,value:packet};}}),/cancelled/);
  assert.equal(exported,0);
});
test("generation change during restore stops before the next assignment",async()=>{
  let epoch=0, imported=0;
  await assert.rejects(snapshots.restore({snapshot:snapshot([
    {name:"a",value:scalar},{name:"b",value:packet}]),language:"python",
    generation:()=>epoch,importValue:async()=>{imported++;epoch++;return {ok:true};}}),/cancelled/);
  assert.equal(imported,1);
});
test("controller downloads a validated explicit snapshot and imports with confirmation",async()=>{
  const h=fixture();
  assert.equal(await h.api.exportCurrent(),true);
  assert.equal(h.downloads.length,1);
  assert.equal(h.downloads[0].name,"flowstudio-python-session.json");
  assert.equal(snapshots.validate(JSON.parse(h.downloads[0].text)).variables.length,1);
  assert.equal(await h.api.importFile({size:150,text:async()=>JSON.stringify(snapshot())}),true);
  assert.equal(h.imports.length,1);
  assert.deepEqual(h.refreshes,["python"]);
  assert.equal(h.busy(),false);
  assert.match(h.messages.at(-1),/Imported 1/);
});
test("controller rejects wrong-language, cancelled and oversized imports without mutation",async()=>{
  const h=fixture({confirmOverwrite:()=>false});
  assert.equal(await h.api.importFile({size:50,text:async()=>JSON.stringify(snapshot())}),false);
  assert.equal(h.imports.length,0);
  h.select("r");
  assert.equal(await h.api.importFile({size:50,text:async()=>JSON.stringify(snapshot())}),false);
  assert.equal(h.imports.length,0);
  assert.equal(await h.api.importFile({size:131073,text:async()=>{throw Error("must not read");}}),false);
  h.select("flow");
  assert.equal(await h.api.exportCurrent(),false);
  assert.equal(h.downloads.length,0);
});
test("controller detects reset while file read is pending",async()=>{
  const h=fixture();
  assert.equal(await h.api.importFile({size:50,text:async()=>{h.reset();return JSON.stringify(snapshot());}}),false);
  assert.equal(h.imports.length,0);
});
test("browser and native Flow router serve the snapshot UI without changing interpreter backend",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  const routes=fs.readFileSync(path.join(__dirname,"../src/data_routes.flow"),"utf8");
  for(const id of ["exportSession","importSession","sessionFile"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/FlowStudioSessionSnapshot\.create/);
  assert.match(html,/src="\.\/session_snapshot\.js"/);
  assert.match(routes,/url == "\/app\/session_snapshot\.js"/);
  const start=html.indexOf("<script>"),end=html.indexOf("</script>",start);
  assert.doesNotThrow(()=>new (require("node:vm").Script)(html.slice(start+8,end)));
});
