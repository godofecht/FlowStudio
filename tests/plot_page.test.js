"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
require("../web/plot_history.js");
const {mount} = require("../web/plot_page.js");
class Element {
  constructor() { this.children=[]; this.handlers={}; this.value=""; this.hidden=false; this.style={}; this.attributes={}; this.textContent=""; this.files=[]; }
  append(node) { this.children.push(node); }
  replaceChildren(...children) { this.children=children; }
  addEventListener(name, fn) { this.handlers[name]=fn; }
  fire(name) { return this.handlers[name](); }
  setAttribute(name,value) { this.attributes[name]=value; }
  removeAttribute(name) { delete this.attributes[name]; }
}
function setup() {
  const elements = new Map();
  for(const id of ["plotFiles","plotHistory","plotImage","plotEmpty","plotZoom","plotSave","plotClear","plotStatus"]) elements.set(id,new Element());
  elements.get("plotZoom").value="100";
  const released=[];
  const doc={getElementById:id=>elements.get(id),createElement:()=>new Element()};
  const urls={createObjectURL:file=>"blob:"+file.name,revokeObjectURL:url=>released.push(url)};
  const history=mount(doc,urls);
  return {history,released,el:id=>elements.get(id)};
}
test("importing, selecting, zooming, saving and clearing local plots", () => {
  const a=setup();
  a.el("plotFiles").files=[{name:"one.png",size:32,type:"image/png"},{name:"two.png",size:48,type:"image/png"}];
  a.el("plotFiles").fire("change");
  assert.equal(a.el("plotHistory").children.length,2);
  assert.equal(a.el("plotImage").src,"blob:two.png");
  assert.equal(a.el("plotSave").download,"two.png");
  a.el("plotHistory").children[0].fire("click");
  assert.equal(a.el("plotImage").src,"blob:one.png");
  a.el("plotZoom").value="200";
  a.el("plotZoom").fire("input");
  assert.equal(a.el("plotImage").style.width,"200%");
  a.el("plotClear").fire("click");
  assert.equal(a.el("plotImage").hidden,true);
  assert.equal(a.el("plotSave").hidden,true);
  assert.deepEqual(a.released,["blob:one.png","blob:two.png"]);
});
test("rejects non-PNG without adding a history item", () => {
  const a=setup();a.el("plotFiles").files=[{name:"malicious.svg",size:123,type:"image/svg+xml"}];
  a.el("plotFiles").fire("change");
  assert.equal(a.history.entries().length,0);
  assert.match(a.el("plotStatus").textContent,/1 file\(s\) rejected/);
});
