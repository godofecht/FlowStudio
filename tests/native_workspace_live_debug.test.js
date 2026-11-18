"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const native = require("../docs/app/native_flow.js");
const panel = require("../docs/app/python_debug_panel.js");

function button() {
  return {disabled: false, listeners: {},
    addEventListener(event, callback) { this.listeners[event] = callback; }};
}
function fixture() {
  const controls = {
    source: {value: "counter = 2\ncounter += 1\nprint(counter)\n"},
    language: {value: "python"},
    breakpoints: {value: "2?counter>=2"},
    pauseOnException: {checked: true},
    target: {textContent: ""},
    startButton: button(), stepButton: button(), nextButton: button(),
    finishButton: button(), continueButton: button(), stopButton: button(),
    statusButton: button()
  };
  return controls;
}
const paused = {state:"paused", ok:true, stack:[{
  line:2, function:"<module>", locals:{counter:{type:"int",value:"2"}}
}], output:"", message:"", exception:null};
const done = {state:"done", ok:true, stack:[], output:"3\n", message:"", exception:null};

test("native workspace debugger uses the real Flow-owned debug routes for Flow, Python and R", () => {
  const routes = read("src/data_routes.flow");
  const html = read("web/index.html");
  const debuggerSource = read("web/ide_debugger.js");
  assert.ok(routes.includes('if url == "/ide_debugger.js"'));
  assert.equal(html.split('<script src="/ide_debugger.js"></script>').length - 1, 1);
  assert.match(html, /id="view-debug"/);
  for (const route of ["/api/debug/flow/", "/api/debug/python/", "/api/debug/r/"])
    assert.ok(debuggerSource.includes('route: "' + route + '"'), route);
  const main = read("src/main.flow");
  assert.match(main, /send_python_debug\("start", fs_body\(\)\)/);
  assert.match(main, /send_python_debug\("next", ""\)/);
  assert.match(main, /send_python_debug\("run-to-line", fs_body\(\)\)/);
  for (const op of ["start", "step", "next", "finish", "continue", "pause", "stop", "status", "evaluate"])
    assert.match(main, new RegExp('eq\\(path, "/api/debug/flow/' + op + '"\\)'), op);
});

test("live debugger executes actual HTTP start, step and continue with bounded conditions", async () => {
  const originalLocation = global.location;
  const originalFetch = global.fetch;
  const requests = [];
  const responses = [paused, paused, done];
  global.location = {protocol:"http:",hostname:"127.0.0.1",port:"8751"};
  global.fetch = async (url, init) => {
    requests.push({url, init});
    return {ok:true,status:200,headers:{get:()=>null},
      text:async()=>JSON.stringify(responses.shift())};
  };
  try {
    const controls = fixture();
    const ui = panel.create({native, ...controls});
    assert.equal(ui.supported, true);
    assert.equal(controls.stepButton.disabled, true);
    assert.equal(await ui.execute("start"), true);
    assert.equal(controls.startButton.disabled, true);
    assert.equal(controls.stepButton.disabled, false);
    assert.match(controls.target.textContent, /counter: int = 2/);
    assert.equal(await ui.execute("step"), true);
    assert.equal(await ui.execute("continue"), true);
    assert.equal(controls.startButton.disabled, false);
    assert.equal(controls.stepButton.disabled, true);
    assert.match(controls.target.textContent, /Output:\n3/);
    assert.deepEqual(requests.map(x=>x.url), [
      "/api/debug/python/start", "/api/debug/python/step",
      "/api/debug/python/continue"
    ]);
    const payload = JSON.parse(requests[0].init.body);
    assert.equal(payload.source, controls.source.value);
    assert.deepEqual(payload.breakpoints, [{line:2,condition:"counter>=2"}]);
    assert.equal(payload.pause_on_exception, true);
    assert.equal(requests[0].init.headers["X-FlowStudio-Intent"], "run");
    assert.equal(requests[0].init.credentials, "omit");
  } finally {
    if (originalLocation === undefined) delete global.location;
    else global.location = originalLocation;
    global.fetch = originalFetch;
  }
});

test("live debugger refuses unsupported hosts and invalid breakpoint expressions", async () => {
  const originalLocation = global.location;
  global.location = {protocol:"https:",hostname:"example.com",port:"443"};
  try {
    const controls = fixture();
    const ui = panel.create({native, ...controls});
    assert.equal(ui.supported, false);
    assert.equal(controls.startButton.disabled, true);
    assert.equal(await ui.execute("start"), false);
  } finally {
    if (originalLocation === undefined) delete global.location;
    else global.location = originalLocation;
  }
  assert.throws(() => panel.parseBreakpoints("2?counter.__class__==3", 3), /line|number/);
  assert.throws(() => panel.parseBreakpoints("2,2", 3), /Duplicate/);
});
