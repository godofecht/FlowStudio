"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const viewer = require("../docs/app/environment_data.js");
const data = require("../docs/app/data_viewer.js");
function node(tag) {
  return {
    tag, children:[], firstChild:null, listeners:{}, style:{}, value:"", textContent:"", disabled:false,
    setAttribute(){}, addEventListener(event, fn){this.listeners[event]=fn;},
    append(...children){this.children.push(...children);this.firstChild=this.children[0]||null;},
    replaceChildren(...children){this.children=children;this.firstChild=children[0]||null;}
  };
}
test("rejects oversized or malformed kernel responses", () => {
  for (const response of [null, {ok:false,output:"no"}, {ok:true,table:{columns:[],rows:[],totalRows:0,truncated:false}},
    {ok:true,table:{columns:["x"],rows:[["x","y"]],totalRows:1,truncated:false}},
    {ok:true,table:{columns:["x"],rows:[["x"]],totalRows:0,truncated:false}},
    {ok:true,table:{columns:["x"],rows:[["x".repeat(161)]],totalRows:1,truncated:false}}]) {
    assert.throws(() => viewer.validate(response));
  }
});
test("renders safe snapshot with sorting and filtering", () => {
  const target=node("target");
  const ui=viewer.create({target,document:{createElement:node},dataApi:data});
  assert.equal(ui.show("x",{ok:true,table:{columns:["value"],rows:[["2"],["1"]],totalRows:2,truncated:false}}),2);
  const holder=target.firstChild;
  assert.equal(holder.children[0].textContent,"Snapshot: x");
  const input=holder.children[1], grid=holder.children[3];
  assert.equal(grid.firstChild.children.length,3);
  input.value="1";input.listeners.input();
  assert.equal(grid.firstChild.children.length,2);
  ui.clear();assert.equal(target.firstChild,null);
});
