"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const panel = require("../docs/app/python_debug_panel.js");
const native = require("../docs/app/native_flow.js");

function button() {
  return {disabled:false, listeners:{},
    addEventListener(event, fn) {this.listeners[event] = fn;}};
}
function controls(client) {
  const startButton=button(), stepButton=button(), nextButton=button(), finishButton=button(), continueButton=button(),
    stopButton=button(), statusButton=button(), target={textContent:""};
  const source={value:"x = 1\ny = x + 2\nprint(y)"};
  const language={value:"python"}, breakpoints={value:"2"};
  const ui=panel.create({native:client,source,language,breakpoints,
    startButton,stepButton,nextButton,finishButton,continueButton,stopButton,statusButton,target});
  return {ui,startButton,stepButton,nextButton,finishButton,continueButton,stopButton,statusButton,
    source,language,breakpoints,target};
}
const paused = {state:"paused",ok:true,stack:[{line:2,function:"<module>",
  locals:{x:{type:"int",value:"1"}}}],output:"",message:""};
const done = {state:"done",ok:true,stack:[{line:2,function:"<module>",
  locals:{x:{type:"int",value:"1"}}}],output:"3\n",message:""};

test("breakpoint parser rejects malformed and out-of-source line numbers", () => {
  assert.deepEqual(panel.parseBreakpoints("1, 3 5",5),[1,3,5]);
  assert.deepEqual(panel.parseBreakpoints("  ",5),[]);
  for (const value of ["0","-1","1.2","2,2","3","1;2","999999999999999999999"]) {
    assert.throws(()=>panel.parseBreakpoints(value,2));
  }
});
test("stack output is rendered as inert text, never HTML", () => {
  const output=panel.format({...paused,output:"<img src=x onerror=alert(1)>"});
  assert.match(output,/onerror/);
  assert.match(output,/Line 2 in <module>/);
  assert.throws(()=>panel.validate({...paused,stack:[{...paused.stack[0],line:0}]}));
});
test("native debugger can start, step and continue with a shared UI lock", async () => {
  const calls=[];
  const c=controls({available:()=>true,
    async debugPythonStart(source,lines){calls.push(["start",source,lines]);return paused;},
    async debugPythonCommand(action){calls.push(action);return action==="continue"?done:paused;}});
  assert.equal(c.stepButton.disabled,true);
  assert.equal(await c.ui.execute("start"),true);
  assert.equal(c.stepButton.disabled,false);
  assert.equal(c.nextButton.disabled,false);
  assert.equal(c.finishButton.disabled,false);
  assert.match(c.target.textContent,/x: int = 1/);
  assert.equal(await c.ui.execute("step"),true);
  assert.equal(await c.ui.execute("next"),true);
  assert.equal(await c.ui.execute("finish"),true);
  assert.equal(await c.ui.execute("continue"),true);
  assert.equal(c.stepButton.disabled,true);
  assert.equal(c.nextButton.disabled,true);
  assert.deepEqual(calls,[["start",c.source.value,[2]],"step","next","finish","continue"]);
});
test("hosted Pages disables all debugger commands", async () => {
  const c=controls({available:()=>false,
    debugPythonStart(){throw Error("network");},
    debugPythonCommand(){throw Error("network");}});
  assert.equal(await c.ui.execute("start"),false);
  assert.equal(c.startButton.disabled,true);
  assert.equal(c.statusButton.disabled,true);
  assert.match(c.target.textContent,/localhost/);
});
test("native debugger client uses intent-gated fixed routes and rejects invalid requests", async () => {
  const oldLocation=globalThis.location, oldFetch=globalThis.fetch;
  const calls=[];
  globalThis.location=new URL("http://127.0.0.1:8751/app/");
  globalThis.fetch=async (url,options)=>{
    calls.push([url,options.body,options.headers["X-FlowStudio-Intent"]]);
    return {ok:true,status:200,headers:{get:()=>null},
      text:async()=>JSON.stringify(paused)};
  };
  try {
    assert.deepEqual(await native.debugPythonStart("x = 1\nprint(x)",[2]),paused);
    assert.deepEqual(await native.debugPythonCommand("step"),paused);
    assert.deepEqual(await native.debugPythonCommand("next"),paused);
    assert.deepEqual(await native.debugPythonCommand("finish"),paused);
    assert.deepEqual(calls.map(c=>c[0]),["/api/debug/python/start","/api/debug/python/step","/api/debug/python/next","/api/debug/python/finish"]);
    assert.equal(calls[0][2],"run");
    assert.deepEqual(JSON.parse(calls[0][1]).breakpoints,[2]);
    await assert.rejects(native.debugPythonCommand("exec"),/Unknown/);
    await assert.rejects(native.debugPythonStart("x = 1",[2]),/breakpoint/);
    assert.equal(calls.length,4);
  } finally {
    if (oldLocation===undefined) delete globalThis.location;
    else globalThis.location=oldLocation;
    globalThis.fetch=oldFetch;
  }
});
