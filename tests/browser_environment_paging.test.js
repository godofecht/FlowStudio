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
function table(offset, count, total = 53) {
  return {ok:true,table:{columns:["n"],
    rows:Array.from({length:count}, (_,i)=>[String(offset+i+1)]),
    totalRows:total, offset, nextOffset:offset+count<total?offset+count:null,
    truncated:total>count}};
}
test("real R table pages advance beyond 50-row local UI pages and return", async () => {
  const calls=[], target=node("target");
  const ui=viewer.create({target,document:{createElement:node},dataApi:data,
    fetchPage:async (name, offset) => {
      calls.push([name,offset]);
      return table(offset,3);
    }});
  assert.equal(ui.show("measurements",table(0,50)),50);
  const holder=target.firstChild, summary=holder.children[2];
  const prev=holder.children[4], next=holder.children[5];
  assert.match(summary.textContent,/loaded rows 1-50 of 53/);
  assert.equal(prev.disabled,true);
  assert.equal(next.disabled,false);
  next.listeners.click();
  await flush();
  assert.deepEqual(calls,[["measurements",50]]);
  assert.match(summary.textContent,/loaded rows 51-53 of 53/);
  assert.equal(next.disabled,true);
  assert.equal(prev.disabled,false);
  prev.listeners.click();
  await flush();
  assert.deepEqual(calls,[["measurements",50],["measurements",0]]);
  assert.match(summary.textContent,/loaded rows 1-3 of 53/);
});

test("local filtering and CSV export never pretend to query unseen R rows", async () => {
  const target=node("target"), downloads=[];
  const ui=viewer.create({target,document:{createElement:node},
    dataApi:{...data,downloadCSV:(csv,name)=>downloads.push([csv,name])},
    fetchPage:async (_name,offset)=>table(offset,2,4)});
  ui.show("frame",table(0,2,4));
  const holder=target.firstChild;
  const input=holder.children[1], next=holder.children[5], exportButton=holder.children[6];
  input.value="1";input.listeners.input();
  assert.match(holder.children[2].textContent,/filter\/sort apply only to the loaded slice/);
  exportButton.listeners.click();
  assert.deepEqual(data.parseDelimited(downloads[0][0]).rows,[["1"]]);
  assert.equal(downloads[0][1],"frame-loaded-slice");
  next.listeners.click();
  await flush();
  assert.equal(input.value,"");
  assert.match(holder.children[2].textContent,/loaded rows 3-4 of 4/);
});

test("R table paging rejects changed schemas and ignores stale responses", async () => {
  let release;
  const target=node("target");
  const ui=viewer.create({target,document:{createElement:node},dataApi:data,
    fetchPage:()=>new Promise(resolve=>{release=resolve;})});
  ui.show("x",table(0,2,4));
  const holder=target.firstChild;
  holder.children[5].listeners.click();
  assert.equal(typeof release,"function");
  ui.clear();
  release({ok:true,table:{columns:["unexpected"],rows:[["3"],["4"]],
    totalRows:4,offset:2,nextOffset:null,truncated:true}});
  await flush();
  assert.equal(target.firstChild,null);
  const bad=viewer.validate({ok:true,table:table(0,2,4).table});
  assert.equal(bad.nextOffset,2);
  assert.throws(()=>viewer.validate({ok:true,table:{...bad,nextOffset:1}}),/Invalid table slice/);
});
