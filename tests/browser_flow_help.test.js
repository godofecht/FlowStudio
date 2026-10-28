"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const flowHelp = require("../docs/app/flow_help.js");
const {create, validTopic} = require("../docs/app/help_panel.js");
function panel() {
  let busy = false, generation = 0, selected = "flow", status = "", calls = 0;
  const handlers = {};
  const input = {value:"function", addEventListener(event, cb) {handlers["input:" + event] = cb;}};
  const button = {addEventListener(event, cb) {handlers["button:" + event] = cb;}};
  const target = {children:[], replaceChildren(...children) {this.children = children;}};
  const document = {createElement(tag) {return {tag, textContent:"", attrs:{}, children:[],
    setAttribute(key, value) {this.attrs[key] = value;}, append(...items) {this.children.push(...items);}};}};
  const api = create({input, button, target, document, notice:text => {status = text;},
    language:() => selected, python:async()=>{calls++;throw Error("unexpected Python lookup");},
    r:async()=>{calls++;throw Error("unexpected R lookup");},
    isBusy:()=>busy, setBusy:value=>{busy=value;}, generation:()=>generation});
  return {api, input, target, handlers, get status() {return status;},
    get calls() {return calls;}, get busy() {return busy;}, setLanguage:value=>{selected=value;},
    reset:()=>{generation++;busy=false;}};
}
test("Flow help is a bounded offline reference with upstream spec provenance", () => {
  assert.ok(flowHelp.topics().length >= 20);
  for (const topic of flowHelp.topics()) {
    assert.equal(validTopic("flow", topic), true);
    const entry = flowHelp.lookup(topic);
    assert.equal(entry.ok, true);
    assert.ok(entry.doc.length > 10);
    assert.match(entry.url, /^https:\/\/github\.com\/flooooooooooow\/flow\/blob\/main\/docs\/LANGUAGE_SPEC\.md#[a-z0-9-]+$/);
  }
  for (const topic of ["__proto__", "constructor", "len", "os.system('id')", "function()", "flow run; rm -rf /", ""]) {
    assert.equal(validTopic("flow", topic), false);
    assert.equal(flowHelp.lookup(topic).ok, false);
  }
});
test("Flow help renders text and an upstream link without invoking a runtime", async () => {
  const f = panel();
  assert.equal(await f.api.lookup(), true);
  assert.equal(f.target.children.length, 1);
  const [title, body, link] = f.target.children[0].children;
  assert.equal(title.textContent, "flow help: function");
  assert.equal(body.tag, "pre");
  assert.match(body.textContent, /function add\(a: i32, b: i32\)/);
  assert.equal(link.tag, "a");
  assert.equal(link.attrs.rel, "noopener noreferrer");
  assert.equal(link.attrs.href, flowHelp.lookup("function").url);
  assert.equal(f.calls, 0);
  assert.equal(f.busy, false);
  assert.match(f.status, /bundled Flow language reference/);
});
test("Flow help refuses unknown topics without replacing existing documentation", async () => {
  const f = panel();
  assert.equal(await f.api.lookup(), true);
  const original = f.target.children[0];
  f.input.value = "foo()";
  assert.equal(await f.api.lookup(), false);
  assert.equal(f.target.children[0], original);
  assert.match(f.status, /Flow topics:/);
  assert.equal(f.calls, 0);
});
test("Flow help can be requested using Enter", async () => {
  const f = panel();
  f.input.value = "unit";
  let prevented = false;
  f.handlers["input:keydown"]({key:"Enter", preventDefault(){prevented=true;}});
  for (let i=0;i<10 && !f.target.children.length;i++) await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(prevented,true);
  assert.match(f.target.children[0].children[1].textContent, /unit Meter/);
});
test("browser help loads the Flow reference before the shared help controller", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.ok(html.indexOf('<script src="./flow_help.js"></script>') > 0);
  assert.ok(html.indexOf('<script src="./flow_help.js"></script>') <
    html.indexOf('<script src="./help_panel.js"></script>'));
  assert.match(html, /FlowStudioHelpPanel\.create/);
  assert.match(html, /placeholder="function \/ len \/ stats::lm"/);
});
