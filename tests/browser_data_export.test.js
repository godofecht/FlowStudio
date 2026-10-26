"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const data = require("../docs/app/data_viewer.js");
const viewer = require("../docs/app/environment_data.js");
test("CSV exports all filtered/sorted rows across pages", () => {
  const rows = Array.from({length:121}, (_,i) => [String(i),i%2?"keep":"drop"]);
  const result = data.exportCSV({columns:["n","tag"],rows},
    {filter:"keep",sortColumn:0,descending:true});
  const parsed = data.parseDelimited(result.csv);
  assert.equal(result.count,60);
  assert.equal(parsed.rows.length,60);
  assert.deepEqual(parsed.rows[0],["119","keep"]);
  assert.deepEqual(parsed.rows.at(-1),["1","keep"]);
});
test("RFC quoting, UTF-8 and spreadsheet formula escaping", () => {
  const result = data.exportCSV({columns:["label","=HYPERLINK(1)"],
    rows:[['said "hi",\nagain',"=2+2"],["line\rbreak","  -SUM(A1:A2)"],
      ["positive","+42"],["negative","-1.5e2"],["mention","@cmd"],["unicode","π"]]});
  const parsed = data.parseDelimited(result.csv);
  assert.deepEqual(parsed.rows,[
    ['said "hi",\nagain',"'=2+2"],["line\rbreak","'  -SUM(A1:A2)"],
    ["positive","+42"],["negative","-1.5e2"],["mention","'@cmd"],["unicode","π"]]);
  assert.equal(parsed.columns[1],"'=HYPERLINK(1)");
  assert.match(result.csv,/\r\n/);
});
test("reject malformed, NUL, oversized fields and oversized exports", () => {
  assert.throws(()=>data.exportCSV({columns:["x"],rows:[["ok","extra"]]}),/inconsistent/);
  assert.throws(()=>data.exportCSV({columns:["x"],rows:[[null]]}),/invalid field/);
  assert.throws(()=>data.exportCSV({columns:["x"],rows:[["bad\0"]]}),/invalid field/);
  assert.throws(()=>data.exportCSV({columns:["x"],rows:[["x".repeat(65537)]]}),/invalid field/);
  assert.throws(()=>data.exportCSV({columns:["x"],rows:Array.from({length:140},
    ()=>["x".repeat(65000)])}),/8 MiB/);
});
test("sampled native/browser kernel table does not claim unseen rows", () => {
  const result = data.exportCSV({columns:["x"],rows:[["1"],["2"]],
    totalRows:500,truncated:true});
  assert.equal(result.sampled,true);
  assert.equal(result.count,2);
  assert.deepEqual(data.parseDelimited(result.csv).rows,[["1"],["2"]]);
});
function node(tag) {
  return {tag,children:[],firstChild:null,listeners:{},style:{},value:"",
    textContent:"",disabled:false,setAttribute(){},
    addEventListener(event,fn){this.listeners[event]=fn;},
    append(...children){this.children.push(...children);this.firstChild=this.children[0]||null;},
    replaceChildren(...children){this.children=children;this.firstChild=children[0]||null;}};
}
test("environment export respects current filter and never calls kernel", () => {
  const downloads=[], api={...data,downloadCSV:(csv,name)=>downloads.push({csv,name})};
  const target=node("target");
  const ui=viewer.create({target,document:{createElement:node},dataApi:api});
  ui.show("sample",{ok:true,table:{columns:["x","y"],rows:[["2","omit"],["1","keep"]],
    totalRows:2000,truncated:true}});
  const holder=target.firstChild;
  holder.children[1].value="keep";
  holder.children[1].listeners.input();
  const button=holder.children[6];
  assert.equal(button.textContent,"Export sampled CSV");
  button.listeners.click();
  assert.equal(downloads.length,1);
  assert.equal(downloads[0].name,"sample-sampled");
  assert.deepEqual(data.parseDelimited(downloads[0].csv).rows,[["1","keep"]]);
  assert.match(holder.children[7].textContent,/not a full kernel dataset/);
});
test("native and Pages assets match; export buttons and controllers wired", () => {
  const read=p=>fs.readFileSync(path.join(root,p),"utf8");
  for (const name of ["data_viewer.js","data_page.js","data.html"])
    assert.equal(read("docs/app/"+name),read("web/"+name));
  assert.match(read("docs/app/data.html"),/id="exportCSV"[^>]*disabled/);
  assert.match(read("docs/app/data_page.js"),/FlowStudioData\.exportCSV/);
  assert.match(read("docs/app/environment_data.js"),/dataApi\.exportCSV/);
  new vm.Script(read("docs/app/data_page.js"));
  new vm.Script(read("docs/app/environment_data.js"));
});
