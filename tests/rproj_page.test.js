"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {mount} = require("../web/rproj_page.js");
const parser = require("../web/rproj.js");
class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.value = "";
    this.disabled = false;
    this.textContent = "";
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  querySelectorAll(selector) {
    const result = [];
    const walk = node => {
      if (node instanceof Element) {
        if (node.tag === "select" || node.tag === "input") result.push(node);
        node.children.forEach(walk);
      }
    };
    this.children.forEach(walk);
    return result;
  }
}
function fixture() {
  const ids = Object.fromEntries(["openProject","fallbackProject","settings","fields","saveProject","resetChanges","fileName","status"].map(id => [id,new Element()]));
  const writes = [];
  const doc = {getElementById:id => ids[id],createElement:tag => new Element(tag)};
  const env = {FlowStudioRproj:parser,FlowStudioFileSave:{writeIfUnchanged:async (...args) => {writes.push(args);return args[2];}}};
  return {ids,doc,env,writes};
}
test("loads project, changes a setting and saves using conflict-aware baseline", async () => {
  const f = fixture();
  const page = mount(f.doc,f.env);
  const source = "Version: 1.0\nNumSpacesForTab: 2\n";
  const handle = {kind:"file"};
  await page.load({name:"analysis.Rproj",size:source.length,text:async()=>source},handle);
  assert.equal(f.ids.fileName.textContent,"analysis.Rproj (direct save)");
  const indent = f.ids.fields.querySelectorAll("input").find(x=>x.name==="NumSpacesForTab");
  indent.value = "4";
  await f.ids.settings.listeners.submit({preventDefault(){}});
  assert.equal(f.writes.length,1);
  assert.equal(f.writes[0][0],handle);
  assert.equal(f.writes[0][1],source);
  assert.equal(f.writes[0][2],"Version: 1.0\nNumSpacesForTab: 4\n");
  assert.equal(f.ids.status.textContent,"Saved project settings");
});
test("does not save invalid project files or silently overwrite", async () => {
  const f = fixture();
  const page = mount(f.doc,f.env);
  await assert.rejects(page.load({name:"other.txt",size:1,text:async()=>"x"}),/\.Rproj/);
  await assert.rejects(page.load({name:"bad.Rproj",size:20,text:async()=>"not a setting"}),/Malformed/);
  assert.equal(f.writes.length,0);
  assert.equal(f.ids.fileName.textContent, "");
});
test("refuses external modification during project settings save", async () => {
  const f = fixture();
  f.env.FlowStudioFileSave = require("../web/file_save.js");
  const page = mount(f.doc, f.env);
  let disk = "Version: 1.0\nNumSpacesForTab: 2\n";
  let writes = 0;
  const handle = {
    getFile: async () => ({name:"analysis.Rproj",size:Buffer.byteLength(disk),text:async()=>disk}),
    createWritable: async () => ({write:async next => {disk = next; writes++;},close:async()=>{}})
  };
  await page.load(await handle.getFile(), handle);
  f.ids.fields.querySelectorAll("input").find(x=>x.name==="NumSpacesForTab").value = "4";
  disk = "Version: 1.0\nNumSpacesForTab: 8\n";
  await f.ids.settings.listeners.submit({preventDefault(){}});
  assert.equal(writes,0);
  assert.match(f.ids.status.textContent,/changed on disk/);
  assert.equal(f.ids.status.dataset.error,"true");
});
