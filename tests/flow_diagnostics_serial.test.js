"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const {mount} = require('../web/flow_diagnostics.js');
function fixture(checkSyntax) {
  const events = {};
  let source = 'function main() -> i32 { return 0 }', version = 1, documentId = 'a';
  const timers = new Map(); let nextTimer = 0;
  const scheduler = {
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    tick() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
    count() { return timers.size; }
  };
  const model = {getValue:()=>source, getVersionId:()=>version,
    getLineCount:()=>source.split('\n').length,
    getLineMaxColumn:line=>source.split('\n')[line-1].length+1};
  const editor = {getModel:()=>model,
    createDecorationsCollection:()=>({set(){},clear(){}}),
    onDidChangeModelContent:fn=>events.content=fn,
    onDidChangeModel:fn=>events.model=fn,
    setPosition(point){this.position=point},
    revealPositionInCenterIfOutsideViewport() {}};
  const button = {disabled:false, addEventListener(){}};
  const language = {value:'flow', addEventListener(name, fn){events.language=fn;}};
  const autoCheck = {checked:false, addEventListener(name, fn){events.auto=fn;}};
  const output = {hidden:true,textContent:''}, status={textContent:'',dataset:{}};
  const controller = mount({editor, native:{available:()=>true,checkSyntax},
    app:{documents:{active:()=>({id:documentId})}}, language,button,output,status,autoCheck,scheduler});
  return {controller,events,button,output,scheduler,autoCheck,
    edit(text){source=text;version++;events.content();},
    switchDoc(id){documentId=id;events.model();},
    enable(){autoCheck.checked=true;events.auto();}};
}
const reply = (output='ok') => ({ok:true,output,diagnostics:[]});
const settle = async () => {for(let i=0;i<12;i++) await Promise.resolve();};

test('manual check after invalidation waits for old process and returns fresh result',async()=>{
  const resolves=[],calls=[];
  const f=fixture(source=>{calls.push(source);return new Promise(resolve=>resolves.push(resolve));});
  const first=f.controller.check();
  f.edit('new source');
  const second=f.controller.check();
  assert.equal(calls.length,1);
  assert.equal(f.button.disabled,true);
  resolves[0](reply('old'));
  assert.equal(await first,false);
  await settle();
  assert.deepEqual(calls,['function main() -> i32 { return 0 }','new source']);
  resolves[1](reply('fresh'));
  assert.equal(await second,true);
  assert.equal(f.output.textContent,'fresh');
  assert.equal(f.button.disabled,false);
});

test('queued manual request is invalidated by a subsequent edit',async()=>{
  const resolves=[],calls=[];
  const f=fixture(source=>{calls.push(source);return new Promise(resolve=>resolves.push(resolve));});
  const first=f.controller.check();
  f.edit('revision 2');
  const second=f.controller.check();
  f.edit('revision 3');
  resolves[0](reply('old'));
  assert.equal(await first,false);
  assert.equal(await second,false);
  await settle();
  assert.equal(calls.length,1);
  assert.equal(f.button.disabled,false);
  assert.equal(f.output.hidden,true);
  const third=f.controller.check();
  assert.equal(calls.length,2);
  resolves[1](reply('latest'));
  assert.equal(await third,true);
});

test('queued manual request refuses to execute after document switch',async()=>{
  const resolves=[],calls=[];
  const f=fixture(source=>{calls.push(source);return new Promise(resolve=>resolves.push(resolve));});
  const first=f.controller.check();
  f.edit('revision 2');
  const second=f.controller.check();
  f.switchDoc('b');
  resolves[0](reply('old'));
  await first;
  assert.equal(await second,false);
  assert.equal(calls.length,1);
});

test('idle checks coalesce while an invalidated compiler is still running',async()=>{
  const resolves=[],calls=[];
  const f=fixture(source=>{calls.push(source);return new Promise(resolve=>resolves.push(resolve));});
  f.enable();
  f.scheduler.tick();
  assert.equal(calls.length,1);
  f.edit('revision 2');
  f.scheduler.tick();
  assert.equal(calls.length,1);
  resolves[0](reply('old'));
  await settle();
  assert.equal(f.scheduler.count(),1);
  f.scheduler.tick();
  assert.deepEqual(calls,['function main() -> i32 { return 0 }','revision 2']);
  resolves[1](reply('new'));
  await settle();
  assert.equal(f.output.textContent,'new');
});

test('failed compiler transport releases the gate for the next check',async()=>{
  const resolves=[],calls=[];
  const f=fixture(source=>{calls.push(source);return new Promise((resolve,reject)=>resolves.push({resolve,reject}));});
  const first=f.controller.check();
  f.edit('new revision');
  const second=f.controller.check();
  resolves[0].reject(new Error('compiler unavailable'));
  assert.equal(await first,false);
  await settle();
  assert.equal(calls.length,2);
  resolves[1].resolve(reply('recovered'));
  assert.equal(await second,true);
  assert.equal(f.output.textContent,'recovered');
});

test('repeated manual clicks cannot queue duplicate compiler invocations',async()=>{
  const resolves=[],calls=[];
  const f=fixture(source=>{calls.push(source);return new Promise(resolve=>resolves.push(resolve));});
  const first=f.controller.check();
  f.edit('new revision');
  const second=f.controller.check();
  const duplicate=f.controller.check();
  assert.equal(await duplicate,false);
  assert.equal(calls.length,1);
  resolves[0](reply('old'));
  await first;
  await settle();
  assert.equal(calls.length,2);
  resolves[1](reply('new'));
  assert.equal(await second,true);
});
