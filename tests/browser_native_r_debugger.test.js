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
    executed_line:null, failed_line:null, output:"", ...overrides};
}

test("native R expression debugger panel only enables real localhost Rscript controls", async () => {
  const source = control("a <- 41L\ncat(a + 1L)");
  const language = control("r"), runtime = control("browser");
  const startButton = control(), stepButton = control(), stopButton = control();
  const continueButton = control(), targetLine = control("2");
  const watchExpression = control("a + 1L"), evaluateButton = control();
  const statusButton = control(), target = control(), calls = [];
  const native = {
    available:() => true,
    async debugRStart(code) { calls.push(["start", code]); return snapshot("paused"); },
    async debugRCommand(action, line) {
      calls.push([action, line]);
      if (action === "evaluate") return snapshot("paused", {output:"42"});
      if (action === "continue" && (line === "2" || line === "2,3" || line === "2?counter>=3,3?counter<9"))
        return snapshot("paused", {index:2, next_line:2, executed_line:1});
      return action === "step" ? snapshot("done", {index:3, executed_line:2, output:"42"}) :
        snapshot("idle", {total:0});
    }
  };
  const p = panel.create({native, source, language, runtime, startButton, stepButton,
    continueButton, targetLine, watchExpression, evaluateButton,
    stopButton, statusButton, target});
  assert.equal(startButton.disabled, true);
  runtime.value = "native";
  runtime.emit("change");
  assert.equal(startButton.disabled, false);
  assert.equal(stepButton.disabled, true);
  assert.equal(continueButton.disabled, true);
  assert.equal(await p.execute("start"), true);
  assert.equal(stepButton.disabled, false);
  assert.match(target.textContent, /paused/);
  assert.equal(continueButton.disabled, false);
  assert.equal(evaluateButton.disabled, false);
  watchExpression.value = "";
  assert.equal(await p.execute("evaluate"), false);
  watchExpression.value = "a + 1L";
  assert.equal(await p.execute("evaluate"), true);
  assert.match(target.textContent, /Output:\n42/);
  assert.equal(stepButton.disabled, false);
  targetLine.value = "abc";
  assert.equal(await p.execute("continue"), false);
  targetLine.value = "2,,3";
  assert.equal(await p.execute("continue"), false);
  targetLine.value = "2,3";
  assert.equal(await p.execute("continue"), true);
  assert.match(target.textContent, /Next expression at line 2/);
  targetLine.value = "2?counter>=3,3?counter<9";
  assert.equal(await p.execute("continue"), true);
  targetLine.value = "2?counter>=NaN";
  assert.equal(await p.execute("continue"), false);
  targetLine.value = "2";
  assert.equal(await p.execute("continue"), true);
  assert.match(target.textContent, /Next expression at line 2/);
  assert.equal(await p.execute("step"), true);
  assert.match(target.textContent, /Output:\n42/);
  assert.equal(stepButton.disabled, true);
  assert.deepEqual(calls, [["start", source.value], ["evaluate", "a + 1L"],
    ["continue", "2,3"], ["continue", "2?counter>=3,3?counter<9"],
    ["continue", "2"], ["step", ""]]);
  assert.equal(await p.execute("stop"), true);
  assert.equal(startButton.disabled, false);
  language.value = "python";
  language.emit("change");
  assert.equal(startButton.disabled, true);
  assert.equal(await p.execute("start"), false);
});

test("native R debugger retains the failed line and permits postmortem workspace evaluation", async () => {
  const source = control("x <- 100L\nstop('failure')\ncat('unreachable')");
  const language = control("r"), runtime = control("native");
  const startButton = control(), stepButton = control(), stopButton = control();
  const continueButton = control(), targetLine = control("");
  const watchExpression = control("x + 1L"), evaluateButton = control();
  const statusButton = control(), target = control(), calls = [];
  const native = {
    available:() => true,
    async debugRStart() { calls.push("start"); return snapshot("paused", {total:3}); },
    async debugRCommand(action) {
      calls.push(action);
      if (action === "step" && calls.filter(item => item === "step").length === 1)
        return snapshot("paused", {index:2, total:3, next_line:2});
      if (action === "step")
        return snapshot("error", {ok:false, index:3, total:3,
          executed_line:2, failed_line:2, output:"Error: failure"});
      if (action === "evaluate")
        return snapshot("error", {index:3, total:3, failed_line:2, output:"[1] 101"});
      if (action === "status")
        return snapshot("error", {index:3, total:3, failed_line:2});
      return snapshot("idle", {total:0});
    }
  };
  const p = panel.create({native, source, language, runtime, startButton, stepButton,
    continueButton, targetLine, watchExpression, evaluateButton,
    stopButton, statusButton, target});
  assert.equal(await p.execute("start"), true);
  assert.equal(await p.execute("step"), true);
  assert.equal(await p.execute("step"), false);
  assert.match(target.textContent, /Failed expression at line 2/);
  assert.equal(stepButton.disabled, true);
  assert.equal(continueButton.disabled, true);
  assert.equal(evaluateButton.disabled, false);
  assert.equal(watchExpression.disabled, false);
  assert.equal(await p.execute("step"), false);
  assert.equal(await p.execute("evaluate"), true);
  assert.match(target.textContent, /Output:\n\[1\] 101/);
  assert.match(target.textContent, /Failed expression at line 2/);
  assert.equal(await p.execute("status"), true);
  assert.match(target.textContent, /Failed expression at line 2/);
  assert.equal(await p.execute("stop"), true);
  assert.equal(evaluateButton.disabled, true);
  assert.deepEqual(calls, ["start", "step", "step", "evaluate", "status", "stop"]);
});

test("Flow, C and R preserve distinct bounded debugger IPC operations", () => {
  const flow = read("src/main.flow"), c = read("src/r_session.c");
  const r = read("src/r_kernel.R"), html = read("docs/app/index.html");
  const routes = read("src/data_routes.flow"), smoke = read("tests/http_smoke.py");
  for (const [action, opcode] of [["start","B"],["step","S"],["continue","F"],["stop","D"],["status","Q"]]) {
    assert.match(flow, new RegExp('"/api/debug/r/' + action + '"'));
    assert.match(c, new RegExp("request_r\\('" + opcode + "'"));
    assert.match(smoke, new RegExp("/api/debug/r/" + action));
  }
  assert.match(r, /debug_step <- function\(\)/);
  assert.match(r, /debug_continue <- function\(target_line\)/);
  assert.match(r, /debug_evaluate <- function\(source\)/);
  assert.match(flow, /"\/api\/debug\/r\/evaluate"/);
  assert.match(c, /request_r\(\x27W\x27/);
  assert.match(smoke, /\/api\/debug\/r\/evaluate/);
  assert.match(html, /id="rDebugEvaluate"/);
  assert.match(html, /id="rDebugContinue"/);
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
    await assert.rejects(native.debugRCommand("invalid"), /Unknown native R debugger action/);
    await assert.rejects(native.debugRCommand("continue", 0), /positive source line/);
    await assert.rejects(native.debugRCommand("step", 3), /Only R continue/);
    await assert.rejects(native.debugRCommand("evaluate", ""), /requires 1 to 4096/);
    await native.debugRCommand("evaluate", "a + 1L");
    assert.equal(calls[1].url, "/api/debug/r/evaluate");
    assert.equal(calls[1].opts.body, "a + 1L");
    await native.debugRCommand("continue", 3);
    assert.equal(calls[2].url, "/api/debug/r/continue");
    assert.equal(calls[2].opts.body, "3");
    await native.debugRCommand("continue", "3,7,12");
    assert.equal(calls[3].opts.body, "3,7,12");
    await native.debugRCommand("continue", "2?counter>=3,4?counter==5");
    assert.equal(calls[4].opts.body, "2?counter>=3,4?counter==5");
    await assert.rejects(native.debugRCommand("continue", "2?counter>=NaN"), /numeric conditions/);
    await assert.rejects(native.debugRCommand("continue", "2?counter>=1;stop(1)"), /numeric conditions/);
    await assert.rejects(native.debugRCommand("continue", "3,,7"), /comma-separated/);
    await assert.rejects(native.debugRCommand("continue", "1,".repeat(64) + "2"), /comma-separated/);
    globalThis.fetch = async () => ({ok:true, status:200, headers:{get:()=>null},
      text:async () => '{"state":"paused","index":-1}'});
    await assert.rejects(native.debugRCommand("status"), /Invalid native R debugger response/);
    globalThis.fetch = async () => ({ok:true, status:200, headers:{get:()=>null},
      text:async () => JSON.stringify(snapshot("error", {failed_line:-1}))});
    await assert.rejects(native.debugRCommand("status"), /Invalid native R debugger response/);
    globalThis.location = {protocol:"https:", hostname:"example.org", port:"443"};
    await assert.rejects(native.debugRStart("cat(1)"), /requires the native FlowStudio server/);
  } finally {
    globalThis.location = previous.location;
    globalThis.fetch = previous.fetch;
  }
});
