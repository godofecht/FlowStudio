"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "web/console.html"), "utf8");
const scripts = ["console.js", "console_page.js"].map(name =>
  fs.readFileSync(path.join(root, "web", name), "utf8"));

function mount(reply = {ok:true,status:200,text:async () => "ok"}, storage = null) {
  const elements = new Map();
  for (const id of ["consoleInput","consoleOutput","consoleLanguage","consoleRun",
      "consoleClear","consoleStatus"]) {
    elements.set(id, {value:"",textContent:"",disabled:false,dataset:{},listeners:{},
      scrollTop:0,scrollHeight:100,selectionStart:0,selectionEnd:0,
      setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
      addEventListener(name,fn){this.listeners[name]=fn;},
      fire(name,event={}){return this.listeners[name]?.(event);}
    });
  }
  elements.get("consoleLanguage").value = "python";
  function register(node) {
    if (!node || typeof node !== "object") return;
    if (node.id) elements.set(node.id, node);
    for (const child of node.children || []) register(child);
  }
  elements.get("consoleRun").parentElement = {append(...nodes) { nodes.forEach(register); }};
  function createElement() {
    return {listeners:{},children:[],addEventListener(name,fn){this.listeners[name]=fn;},
      fire(name){this.listeners[name]?.();},append(...nodes){this.children.push(...nodes);}};
  }
  const document = {getElementById:id=>elements.get(id),createElement};
  const requests = [];
  const context = vm.createContext({document,TextEncoder,console,localStorage:storage});
  for (const source of scripts) vm.runInContext(source, context);
  const controller = context.FlowStudioConsolePage.mount(document,async (url,options) => {
    requests.push({url,options});
    return reply;
  });
  return {controller,el:id=>elements.get(id),requests};
}
test("console page serves external scripts and semantic input", () => {
  assert.match(html, /src="console.js"/);
  assert.match(html, /src="console_page.js"/);
  assert.match(html, /id="consoleInput"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Ctrl\/⌘\+R: search older commands/);
  assert.match(html, /R and Python use persistent local interpreter sessions/);
});
test("console page submits exact code via Flow-owned HTTP endpoint", async () => {
  const app = mount();
  app.el("consoleInput").value = "print('ok')";
  assert.equal(await app.controller.run(app.el("consoleInput")),true);
  assert.equal(app.requests[0].url,"/api/run/python");
  assert.equal(app.requests[0].options.body,"print('ok')");
  assert.equal(app.requests[0].options.headers["X-FlowStudio-Intent"],"run");
  assert.match(app.el("consoleOutput").textContent,/ok/);
  assert.equal(app.el("consoleInput").value,"");
});
test("runtime errors retain submission history and report status", async () => {
  const app = mount({ok:false,status:422,text:async () => "SyntaxError"});
  app.el("consoleInput").value = "bad(";
  assert.equal(await app.controller.run(app.el("consoleInput")),true);
  assert.equal(app.el("consoleStatus").dataset.state,"error");
  assert.match(app.el("consoleOutput").textContent,/SyntaxError/);
  assert.equal(app.controller.history("python").length,1);
});
test("switching languages preserves unfinished drafts", () => {
  const app = mount();
  app.el("consoleInput").value = "python draft";
  app.el("consoleLanguage").value = "r";
  app.el("consoleLanguage").fire("change");
  assert.equal(app.el("consoleInput").value,"");
  app.el("consoleInput").value = "R draft";
  app.el("consoleLanguage").value = "python";
  app.el("consoleLanguage").fire("change");
  assert.equal(app.el("consoleInput").value,"python draft");
});

test("standalone console opt-in persists commands and disabling erases them", async () => {
  const data = new Map();
  const storage = {getItem:k=>data.get(k)??null,
    setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
  const a = mount(undefined, storage);
  assert.equal(a.controller.isPersisting(), false);
  a.el("consoleRememberHistory").checked = true;
  a.el("consoleRememberHistory").fire("change");
  a.el("consoleInput").value = "x = 12";
  assert.equal(await a.controller.run(a.el("consoleInput")), true);
  const b = mount(undefined, storage);
  assert.equal(b.controller.isPersisting(), true);
  assert.deepEqual(Array.from(b.controller.history("python")), ["x = 12"]);
  b.el("consoleRememberHistory").checked = false;
  b.el("consoleRememberHistory").fire("change");
  assert.equal(data.size, 0);
});
