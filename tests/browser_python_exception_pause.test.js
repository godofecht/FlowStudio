"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const panel = require("../docs/app/python_debug_panel.js");
const native = require("../docs/app/native_flow.js");

const paused = {
  state:"paused", ok:true, stack:[{line:2,function:"<module>",
    locals:{x:{type:"int",value:"1"}}}], output:"", message:"",
  exception:{type:"ValueError",line:2}
};
const done = {...paused,state:"done",exception:null,output:"finished\n"};

function button() {
  return {disabled:false,listeners:{},
    addEventListener(event, fn) {this.listeners[event] = fn;}};
}

test("native exception metadata is strictly bounded and rendered as text", () => {
  assert.equal(panel.validate(paused),paused);
  assert.match(panel.format(paused),/Exception: ValueError at line 2 \(raised; may be caught\)/);
  for (const exception of [
    {type:"ValueError",line:0}, {type:"X".repeat(81),line:2},
    {type:"ValueError",line:"2"}, {type:"ValueError",line:2,extra:"x"}, [],
  ]) {
    assert.throws(() => panel.validate({...paused,exception}),/exception metadata/);
  }
  assert.equal(panel.validate({...paused,exception:null}).exception,null);
});

test("browser sends opt-in exception pause through intent-gated localhost route", async () => {
  const oldLocation=globalThis.location, oldFetch=globalThis.fetch;
  const calls=[];
  globalThis.location=new URL("http://127.0.0.1:8751/app/");
  globalThis.fetch=async (url,options)=>{
    calls.push([url,JSON.parse(options.body),options.headers["X-FlowStudio-Intent"]]);
    return {ok:true,status:200,headers:{get:()=>null},
      text:async()=>JSON.stringify(paused)};
  };
  try {
    assert.deepEqual(await native.debugPythonStart("raise ValueError('bad')",[],true),paused);
    assert.equal(calls.length,1);
    assert.equal(calls[0][0],"/api/debug/python/start");
    assert.equal(calls[0][1].pause_on_exception,true);
    assert.deepEqual(calls[0][1].breakpoints,[]);
    assert.equal(calls[0][2],"run");
    await native.debugPythonStart("x=1",[1]);
    assert.equal(Object.hasOwn(calls[1][1],"pause_on_exception"),false);
    await assert.rejects(native.debugPythonStart("x=1",[],1),/boolean/);
    assert.equal(calls.length,2);
  } finally {
    if (oldLocation===undefined) delete globalThis.location;
    else globalThis.location=oldLocation;
    globalThis.fetch=oldFetch;
  }
});

test("debugger UI reads checked exception pause and allows normal continuation", async () => {
  const calls=[];
  const source={value:"x = 1\nraise ValueError('bad')"};
  const language={value:"python"}, breakpoints={value:""};
  const pauseOnException={checked:true};
  const startButton=button(), stepButton=button(), nextButton=button(),
    finishButton=button(), continueButton=button(), stopButton=button(),
    statusButton=button(), target={textContent:""};
  const ui=panel.create({
    native:{available:()=>true,
      async debugPythonStart(code,points,pause){calls.push([code,points,pause]);return paused;},
      async debugPythonCommand(action){calls.push(action);return done;}},
    source,language,breakpoints,pauseOnException,startButton,stepButton,nextButton,
    finishButton,continueButton,stopButton,statusButton,target
  });
  assert.equal(await ui.execute("start"),true);
  assert.deepEqual(calls[0],[source.value,[],true]);
  assert.match(target.textContent,/Exception: ValueError at line 2/);
  assert.equal(await ui.execute("continue"),true);
  assert.equal(continueButton.disabled,true);
  assert.equal(target.textContent.includes("Exception: ValueError"),false);
});
