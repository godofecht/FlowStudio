"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const panel = require("../docs/app/r_debug_panel.js");

function control(value = "") {
  const listeners = new Map();
  return {
    value, disabled:false, textContent:"",
    addEventListener(name, fn) { listeners.set(name, fn); },
    emit(name) { listeners.get(name)?.(); }
  };
}
function snapshot(state, overrides = {}) {
  return {state, ok:true, index:1, total:2, next_line:state === "paused" ? 1 : null,
    executed_line:null, output:"", ...overrides};
}

test("native R expression debugger panel only enables real localhost Rscript controls", async () => {
  const source = control("a <- 41L\ncat(a + 1L)");
  const language = control("r"), runtime = control("browser");
  const startButton = control(), stepButton = control(), stopButton = control();
  const statusButton = control(), target = control(), calls = [];
  const native = {
    available:() => true,
    async debugRStart(code) { calls.push(["start", code]); return snapshot("paused"); },
    async debugRCommand(action) {
      calls.push([action]);
      return action === "step" ? snapshot("done", {index:3, executed_line:2, output:"42"}) :
        snapshot("idle", {total:0});
    }
  };
  const p = panel.create({native, source, language, runtime, startButton, stepButton,
    stopButton, statusButton, target});
  assert.equal(startButton.disabled, true);
  runtime.value = "native";
  runtime.emit("change");
  assert.equal(startButton.disabled, false);
  assert.equal(stepButton.disabled, true);
  assert.equal(await p.execute("start"), true);
  assert.equal(stepButton.disabled, false);
  assert.match(target.textContent, /paused/);
  assert.equal(await p.execute("step"), true);
  assert.match(target.textContent, /Output:\n42/);
  assert.equal(stepButton.disabled, true);
  assert.deepEqual(calls, [["start", source.value], ["step"]]);
  assert.equal(await p.execute("stop"), true);
  assert.equal(startButton.disabled, false);
  language.value = "python";
  language.emit("change");
  assert.equal(startButton.disabled, true);
  assert.equal(await p.execute("start"), false);
});

test("Flow, C and R preserve distinct bounded debugger IPC operations", () => {
  const flow = read("src/main.flow"), c = read("src/r_session.c");
  const r = read("src/r_kernel.R"), html = read("docs/app/index.html");
  const routes = read("src/data_routes.flow"), smoke = read("tests/http_smoke.py");
  for (const [action, opcode] of [["start","B"],["step","S"],["stop","D"],["status","Q"]]) {
    assert.match(flow, new RegExp('"/api/debug/r/' + action + '"'));
    assert.match(c, new RegExp("request_r\\('" + opcode + "'"));
    assert.match(smoke, new RegExp("/api/debug/r/" + action));
  }
  assert.match(r, /debug_step <- function\(\)/);
  assert.match(r, /expressions_override = expression/);
  assert.match(r, /debugger is paused; finish or stop/);
  assert.match(html, /id="rDebugStep"/);
  assert.match(html, /r_debug_panel\.js/);
  assert.match(routes, /"\/app\/r_debug_panel\.js"/);
  assert.match(read("tests/r_session_harness.c"), /failure\(79, out\)/);
});

test("native R debugger client rejects malformed and non-local responses", async () => {
  const native = require("../docs/app/native_flow.js");
  const previous = {location:globalThis.location, fetch:globalThis.fetch};
  try {
    globalThis.location = {protocol:"http:", hostname:"127.0.0.1", port:"8751"};
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({url, opts});
      return {ok:true, status:200, headers:{get:()=>null},
        text:async () => JSON.stringify(snapshot("paused"))};
    };
    const result = await native.debugRStart("cat(42)");
    assert.equal(result.state, "paused");
    assert.equal(calls[0].url, "/api/debug/r/start");
    assert.equal(calls[0].opts.headers["X-FlowStudio-Intent"], "run");
    await assert.rejects(native.debugRCommand("continue"), /Unknown native R debugger action/);
    globalThis.fetch = async () => ({ok:true, status:200, headers:{get:()=>null},
      text:async () => '{"state":"paused","index":-1}'});
    await assert.rejects(native.debugRCommand("status"), /Invalid native R debugger response/);
    globalThis.location = {protocol:"https:", hostname:"example.org", port:"443"};
    await assert.rejects(native.debugRStart("cat(1)"), /requires the native FlowStudio server/);
  } finally {
    globalThis.location = previous.location;
    globalThis.fetch = previous.fetch;
  }
});
