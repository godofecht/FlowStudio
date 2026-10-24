"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {validate, lineOffset, render} = require("../docs/app/python_trace_view.js");
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.textContent = ""; }
  setAttribute(k,v) { this[k] = v; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  addEventListener(k,fn) { this.events[k] = fn; }
}
const doc = {createElement: tag => new Node(tag)};
const sample = {ok:true, output:"printed", truncated:false, events:[
  {line:2,function:"f",elapsed_ms:0.2,locals:{x:{type:"int",value:"42"}}}
]};
test("real trace renders text-only table and navigates CRLF source", () => {
  const target = new Node("div");
  const source = {value:"x = 1\r\nprint(x)",focus(){this.focused=true;},setSelectionRange(a,b){this.selection=[a,b];}};
  assert.equal(render(target,source,sample,doc),1);
  const section = target.children[0];
  const table = section.children[2];
  const button = table.children[2].children[0].children[0];
  assert.equal(button.textContent,"2");
  button.events.click();
  assert.deepEqual(source.selection,[7,7]);
  assert.equal(table.children[2].children[3].textContent,"x: int = 42");
  source.value = "changed";
  button.events.click();
  assert.deepEqual(source.selection,[7,7]);
});
test("rejects malformed trace and bounds", () => {
  assert.throws(()=>validate({ok:true,output:"",events:new Array(257).fill(sample.events[0]),truncated:false}));
  assert.throws(()=>validate({...sample,events:[{...sample.events[0],line:0}]}));
  assert.equal(lineOffset("a\rb\nc",3),4);
});
