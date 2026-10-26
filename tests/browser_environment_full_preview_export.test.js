"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const viewer = require("../docs/app/environment_data.js");
const data = require("../docs/app/data_viewer.js");
const flush = () => new Promise(resolve => setImmediate(resolve));
function table(offset, count, total = 251, columns = ["n"]) {
  return {ok:true,table:{columns,
    rows:Array.from({length:count},(_,i)=>columns.map((_,j)=>j===0?String(offset+i+1):"=1+1")),
    totalRows:total,offset,nextOffset:offset+count<total?offset+count:null,
    truncated:offset+count<total}};
}
function node(tag) {
  return {tag,children:[],firstChild:null,listeners:{},style:{},value:"",
    textContent:"",disabled:false,setAttribute(){},
    addEventListener(event,fn){this.listeners[event]=fn;},
    append(...children){this.children.push(...children);this.firstChild=this.children[0]||null;},
    replaceChildren(...children){this.children=children;this.firstChild=this.children[0]||null;}};
}
test("native R preview CSV fetches every row from zero without repeated headers", async () => {
  const calls=[];
  const result=await viewer.collectRPreviewCSV("frame",async(name,offset)=>{
    calls.push([name,offset]);return table(offset,Math.min(200,251-offset),251,["n","formula"]);
  },data);
  assert.deepEqual(calls,[["frame",0],["frame",200]]);
  assert.equal(result.count,251);
  assert.equal(result.previewOnly,true);
  const parsed=data.parseDelimited(result.csv);
  assert.deepEqual(parsed.columns,["n","formula"]);
  assert.equal(parsed.rows.length,251);
  assert.deepEqual(parsed.rows[0],["1","'=1+1"]);
  assert.deepEqual(parsed.rows.at(-1),["251","'=1+1"]);
});
test("native R preview CSV rejects gaps, early endings, schema and row-count changes", async () => {
  const cases=[
    offset=>({...table(offset,51),table:{...table(offset,51).table,offset:offset+1}}),
    offset=>({...table(offset,51),table:{...table(offset,51).table,nextOffset:null}}),
    offset=>table(offset,51,251,["different"]),
    offset=>table(offset,51,252)
  ];
  for (const second of cases)
    await assert.rejects(viewer.collectRPreviewCSV("x",async(_name,offset)=>
      offset===0?table(0,200):second(offset),data),/row slice|final row|changed/);
});
test("native R preview CSV refuses empty continuation and oversized datasets", async () => {
  await assert.rejects(viewer.collectRPreviewCSV("x",async(_name,offset)=>
    offset===0?table(0,200):table(offset,0),data),/empty kernel page/);
  await assert.rejects(viewer.collectRPreviewCSV("x",async()=>table(0,1,25001),data),
    /25,000 rows/);
});
test("native R preview CSV enforces cumulative UTF-8 bytes", async () => {
  await assert.rejects(viewer.collectRPreviewCSV("x",async(_name,offset)=>
    table(offset,Math.min(2,5-offset),5),{...data,MAX_BYTES:40}),/8 MiB export bound/);
});
test("native R preview CSV cancels when view closes mid-fetch", async () => {
  let release, alive=true;
  const pending=viewer.collectRPreviewCSV("x",()=>new Promise(resolve=>{release=resolve;}),data,()=>alive);
  alive=false;release(table(0,200));
  await assert.rejects(pending,/cancelled/);
});
test("native R preview button downloads all rows without changing current page", async () => {
  const target=node("target"), calls=[], downloads=[];
  const api={...data,downloadCSV:(csv,name)=>downloads.push({csv,name})};
  const ui=viewer.create({target,document:{createElement:node},dataApi:api,
    fetchPage:async(name,offset)=>{calls.push(offset);return table(offset,Math.min(200,251-offset));}});
  ui.show("frame",table(200,51));
  const holder=target.firstChild;
  assert.equal(holder.children.length,11);
  holder.children[10].listeners.click();
  for(let i=0;i<4 && !downloads.length;i++)await flush();
  assert.deepEqual(calls,[0,200]);
  assert.equal(downloads.length,1);
  assert.equal(downloads[0].name,"frame-all-preview-rows");
  assert.equal(data.parseDelimited(downloads[0].csv).rows.length,251);
  assert.match(holder.children[2].textContent,/loaded rows 201-251/);
  assert.match(holder.children[7].textContent,/Not a raw dataset export/);
});
test("native R preview button never downloads partial data after kernel failure", async () => {
  const target=node("target"), downloads=[];
  const ui=viewer.create({target,document:{createElement:node},
    dataApi:{...data,downloadCSV:(...args)=>downloads.push(args)},
    fetchPage:async(_name,offset)=>offset===0?table(0,200):table(offset,0)});
  ui.show("frame",table(0,200));
  const holder=target.firstChild;
  holder.children[10].listeners.click();
  for(let i=0;i<4;i++)await flush();
  assert.equal(downloads.length,0);
  assert.match(holder.children[7].textContent,/failed/);
});
test("non-native snapshots do not offer kernel preview export", () => {
  const target=node("target");
  const ui=viewer.create({target,document:{createElement:node},dataApi:data});
  const first=table(0,2);
  delete first.table.offset;delete first.table.nextOffset;
  ui.show("frame",first);
  assert.equal(target.firstChild.children.length,8);
});
