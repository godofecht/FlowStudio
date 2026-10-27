"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const viewer = require("../docs/app/environment_data.js");
const data = require("../docs/app/data_viewer.js");

function node(tag) {
  return {tag,children:[],firstChild:null,listeners:{},style:{},value:"",
    textContent:"",disabled:false,setAttribute(){},
    addEventListener(event,fn){this.listeners[event]=fn;},
    append(...children){this.children.push(...children);this.firstChild=this.children[0]||null;},
    replaceChildren(...children){this.children=children;this.firstChild=this.children[0]||null;}};
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function table(offset, count, total = 500) {
  return {ok:true,table:{columns:["n"],
    rows:Array.from({length:count},(_,i)=>[String(offset+i+1)]),
    totalRows:total,offset,nextOffset:offset+count<total?offset+count:null,
    truncated:offset+count<total}};
}
function setup(fetchPage, first = table(0,200)) {
  const target=node("target");
  const ui=viewer.create({target,document:{createElement:node},dataApi:data,fetchPage});
  ui.show("frame",first);
  return {ui,target,holder:target.firstChild};
}

test("native R jump navigates a loaded row without an extra kernel call", () => {
  const {holder}=setup(()=>{throw Error("Unexpected fetch");});
  assert.equal(holder.children.length,11);
  const input=holder.children[8], button=holder.children[9];
  input.value="151";
  button.listeners.click();
  assert.match(holder.children[2].textContent,/loaded rows 1-200 of 500, page 4\/4/);
  assert.equal(holder.children[3].firstChild.children[1].children[0].textContent,"151");
});

test("native R jump requests an exact remote offset and restores prior page", async () => {
  const calls=[];
  const {holder}=setup(async (name,offset)=>{
    calls.push([name,offset]);
    return table(offset,Math.min(200,500-offset));
  });
  holder.children[5].listeners.click();
  assert.match(holder.children[2].textContent,/page 2\/4/);
  holder.children[8].value="451";
  holder.children[9].listeners.click();
  await flush();
  assert.deepEqual(calls,[["frame",450]]);
  assert.match(holder.children[2].textContent,/loaded rows 451-500 of 500, page 1\/1/);
  holder.children[4].listeners.click();
  await flush();
  assert.deepEqual(calls,[["frame",450],["frame",0]]);
  assert.match(holder.children[2].textContent,/loaded rows 1-200 of 500, page 2\/4/);
});

test("native R jump rejects invalid and out-of-range rows before HTTP", () => {
  const {holder}=setup(()=>{throw Error("Unexpected fetch");});
  for (const raw of ["", "0", "-1", "1.5", "1e3", "0001", "501", "99999999999", "1;cat(1)"]) {
    holder.children[8].value=raw;
    holder.children[9].listeners.click();
    assert.match(holder.children[7].textContent,/Enter a whole row number/);
  }
  assert.match(holder.children[2].textContent,/loaded rows 1-200/);
});

test("native R jump rejects schema changes without replacing the current table", async () => {
  const {holder}=setup(async (_name,offset)=>({
    ...table(offset,20),table:{...table(offset,20).table,columns:["changed"]}
  }));
  holder.children[8].value="401";
  holder.children[9].listeners.click();
  await flush();
  assert.match(holder.children[7].textContent,/R table changed while paging/);
  assert.match(holder.children[2].textContent,/loaded rows 1-200/);
});

test("native R jump ignores late responses after the table is closed", async () => {
  let release;
  const {ui,target,holder}=setup(()=>new Promise(resolve=>{release=resolve;}));
  holder.children[8].value="301";
  holder.children[9].listeners.click();
  assert.equal(typeof release,"function");
  ui.clear();
  release(table(300,200));
  await flush();
  assert.equal(target.firstChild,null);
});

test("non-native snapshots never expose a jump-to-kernel control", () => {
  const target=node("target");
  const ui=viewer.create({target,document:{createElement:node},dataApi:data});
  const first=table(0,20);
  delete first.table.offset;
  delete first.table.nextOffset;
  ui.show("frame",first);
  assert.equal(target.firstChild.children.length,8);
});
