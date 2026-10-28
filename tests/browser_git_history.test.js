"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const native = require("../docs/app/native_flow.js");
const panel = require("../docs/app/git_panel.js");

function button() {
  return {disabled:false, handlers:{}, addEventListener(event, fn) { this.handlers[event] = fn; }};
}
test("Git history uses a fixed native-only route with no client revision or shell arguments", async () => {
  const oldLocation = globalThis.location, oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.location = new URL("http://127.0.0.1:8751/app/");
  globalThis.fetch = async (url, options) => {
    calls.push({url, options});
    return {ok:true,status:200,headers:{get:()=>null},text:async()=> "abc123 2026-10-28 Add tests"};
  };
  try {
    const result = await native.gitHistory();
    assert.equal(result.ok, true);
    assert.match(result.output, /Add tests/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/git/history");
    assert.equal(calls[0].options.body, "");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.credentials, "omit");
    assert.equal(calls[0].options.redirect, "error");
    assert.equal(calls[0].options.headers["X-FlowStudio-Intent"], "run");
  } finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
    globalThis.fetch = oldFetch;
  }
});
test("hosted Pages cannot request Git history or contact native localhost", async () => {
  const oldLocation = globalThis.location, oldFetch = globalThis.fetch;
  globalThis.location = new URL("https://godofecht.github.io/FlowStudio/app/");
  globalThis.fetch = () => {throw Error("unexpected request");};
  try {
    await assert.rejects(native.gitHistory(), /native FlowStudio server/);
  } finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
    globalThis.fetch = oldFetch;
  }
});
test("history renders as inert text and shares the Git operation lock", async () => {
  const historyButton = button(), statusButton = button(), diffButton = button();
  const target = {textContent:""};
  let finish, calls = 0;
  const ui = panel.create({
    native:{available:()=>true, gitHistory() {
      calls++;
      return new Promise(resolve => {finish = resolve;});
    }},
    historyButton,statusButton,diffButton,target
  });
  const pending = ui.show("history");
  assert.equal(historyButton.disabled, true);
  assert.equal(statusButton.disabled, true);
  assert.equal(await ui.show("history"), false);
  assert.equal(calls, 1);
  finish({ok:true,status:200,output:"abcd 2026-10-28 <script>alert(1)</script>"});
  assert.equal(await pending, true);
  assert.match(target.textContent, /<script>alert\(1\)<\/script>/);
  assert.equal(historyButton.disabled, false);
  assert.equal(typeof historyButton.handlers.click, "function");
});
test("history recovers from native errors and is disabled on Pages", async () => {
  const historyButton = button(), target = {textContent:""};
  const ui = panel.create({
    native:{available:()=>true,async gitHistory() {return {ok:false,status:422,output:"no commits"};}},
    statusButton:button(),diffButton:button(),historyButton,target
  });
  assert.equal(await ui.show("history"), false);
  assert.match(target.textContent, /no commits/);
  assert.equal(historyButton.disabled, false);
  const hostedButton = button();
  const hosted = panel.create({native:{available:()=>false},statusButton:button(),
    diffButton:button(),historyButton:hostedButton,target:{textContent:""}});
  assert.equal(await hosted.show("history"), false);
  assert.equal(hostedButton.disabled, true);
});
test("actual Flow router and browser wiring include bounded history", () => {
  const flow = fs.readFileSync(require.resolve("../src/main.flow"), "utf8");
  const html = fs.readFileSync(require.resolve("../docs/app/index.html"), "utf8");
  assert.match(flow, /\/api\/git\/history/);
  assert.match(flow, /send_git_view\("history"\)/);
  assert.match(flow, /proc_arg\(command, "--max-count=30"\)/);
  assert.match(flow, /proc_arg\(command, "--format=%h %ad %s"\)/);
  assert.match(html, /id="gitHistory"/);
  assert.match(html, /historyButton:\$\("gitHistory"\)/);
});
