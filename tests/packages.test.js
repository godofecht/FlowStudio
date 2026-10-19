"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SOURCES, parseInventory, createInventory } = require("../web/packages.js");
class Element {
  constructor() { this.children=[]; this.listeners={}; this.value=""; this.textContent=""; this.disabled=false; }
  append(...items) { this.children.push(...items); }
  replaceChildren() { this.children=[]; }
  addEventListener(event, handler) { this.listeners[event]=handler; }
  fire(event) { return this.listeners[event](); }
}
function mount(request) {
  const doc={createElement:()=>new Element()};
  const language=new Element(), refresh=new Element(), search=new Element(), table=new Element(), status=new Element();
  language.value="python";
  const inventory=createInventory({request,doc,language,refresh,search,table,status});
  return {language,refresh,search,table,status,inventory};
}
test("fixed Python and R package queries are read-only", () => {
  assert.match(SOURCES.python,/importlib\.metadata/);
  assert.match(SOURCES.r,/installed\.packages/);
  assert.doesNotMatch(SOURCES.python + SOURCES.r,/pip install|install\.packages\s*\(/);
});
test("parses, sorts and de-duplicates installed packages", () => {
  assert.deepEqual(parseInventory("zeta\t2.0\nAlpha\t1.0\nalpha\t9.0\n", "python"), {
    packages:[{name:"Alpha",version:"1.0"},{name:"zeta",version:"2.0"}],invalidRows:0
  });
});
test("rejects unsupported runtime, oversized output and malformed rows", () => {
  assert.throws(()=>parseInventory("a\t1", "flow"),/Unsupported/);
  assert.throws(()=>parseInventory("x".repeat(1048577), "r"),/limit/);
  assert.equal(parseInventory("ok\t1\n<script>\t2\nname\tbad\t3\n", "r").invalidRows,2);
});
test("requests persistent kernel with required intent and renders as text", async () => {
  const calls=[];
  const ui=mount(async (url,options)=>{
    calls.push({url,options}); return {ok:true,status:200,text:async()=>"numpy\t2.0\n<script>\t1\n"};
  });
  await ui.refresh.fire("click");
  assert.equal(calls[0].url,"/api/run/python");
  assert.equal(calls[0].options.headers["X-FlowStudio-Intent"],"run");
  assert.equal(ui.table.children[1].children.length,1);
  assert.equal(ui.table.children[1].children[0].children[0].textContent,"numpy");
  ui.search.value="absent"; ui.search.fire("input");
  assert.equal(ui.table.children[1].children.length,0);
});
test("runtime switching discards stale responses", async () => {
  let release;
  const first=new Promise(resolve=>{release=resolve;});
  const ui=mount((url)=>url.endsWith("python")?first:Promise.resolve({ok:true,status:200,text:async()=>"stats\t4.4\n"}));
  const pending=ui.refresh.fire("click");
  ui.language.value="r";
  await ui.language.fire("change");
  release({ok:true,status:200,text:async()=>"old\t1\n"});
  await pending;
  assert.equal(ui.table.children[1].children[0].children[0].textContent,"stats");
  assert.equal(ui.refresh.disabled,false);
});
test("HTTP failures do not render package rows", async () => {
  const ui=mount(async()=>({ok:false,status:503,text:async()=>"R not installed"}));
  await ui.inventory.load();
  assert.match(ui.status.textContent,/HTTP 503/);
  assert.equal(ui.table.children.length,0);
});
test("Python inspection leaves the persistent interpreter namespace unchanged", () => {
  const { spawnSync } = require("node:child_process");
  const probe = "import contextlib, io, json\n" +
    "scope = {}\nbuf = io.StringIO()\n" +
    "with contextlib.redirect_stdout(buf):\n" +
    "    exec(" + JSON.stringify(SOURCES.python) + ", scope, scope)\n" +
    "print(json.dumps({'names': [k for k in scope if k != '__builtins__'], 'rows': len(buf.getvalue().splitlines()), 'sample': buf.getvalue()[:60]}))";
  const result = spawnSync("python3", ["-c", probe], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.deepEqual(data.names, []);
  assert.ok(data.rows > 0);
  assert.match(data.sample, /\t/);
});
test("changing runtimes aborts the previous inventory request", async () => {
  let oldSignal, resolveFirst;
  const pending = new Promise(resolve => { resolveFirst = resolve; });
  const ui = mount((url, options) => {
    if (url.endsWith("python")) { oldSignal = options.signal; return pending; }
    return Promise.resolve({ ok: true, status: 200, text: async () => "stats\t4.4\n" });
  });
  const first = ui.inventory.load();
  ui.language.value = "r";
  await ui.inventory.load();
  assert.equal(oldSignal.aborted, true);
  resolveFirst({ ok: true, status: 200, text: async () => "stale\t1\n" });
  await first;
  assert.equal(ui.table.children[1].children[0].children[0].textContent, "stats");
});
