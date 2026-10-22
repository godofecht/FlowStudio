"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {create} = require("../docs/app/console_repl.js");
function fixture(submit = async () => true) {
  const listeners = new Map(), notices = [];
  const input = {value:"", disabled:false, selectionStart:0, selectionEnd:0,
    addEventListener:(type,fn)=>listeners.set("input:"+type,fn),
    setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}};
  const button = {disabled:false, addEventListener:(type,fn)=>listeners.set("button:"+type,fn)};
  const controller = create({input,button,submit,notice:msg=>notices.push(msg)});
  function key(key,options={}) {
    let prevented = false;
    listeners.get("input:keydown")({key,shiftKey:false,ctrlKey:false,metaKey:false,altKey:false,
      preventDefault(){prevented=true;},...options});
    return prevented;
  }
  return {input,button,controller,key,notices,listeners};
}
test("submits complete input, clears only after acceptance, retains history", async () => {
  const calls=[], f=fixture(async code=>{calls.push(code);return true;});
  f.input.value="x = 1\nprint(x)";
  assert.equal(await f.controller.execute(),true);
  assert.deepEqual(calls,["x = 1\nprint(x)"]);
  assert.equal(f.input.value,"");
  f.key("ArrowUp");
  assert.equal(f.input.value,"x = 1\nprint(x)");
});
test("does not discard source when execution is rejected", async () => {
  const f=fixture(async()=>false);
  f.input.value="print('again')";
  assert.equal(await f.controller.execute(),false);
  assert.equal(f.input.value,"print('again')");
});
test("serializes pending submission and restores controls", async () => {
  let finish;
  const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));
  f.input.value="42";
  const first=f.controller.execute();
  assert.equal(f.button.disabled,true);
  assert.equal(f.input.disabled,true);
  assert.equal(await f.controller.execute(),false);
  finish(true);
  assert.equal(await first,true);
  assert.equal(f.input.disabled,false);
});
test("keeps draft when browsing history forward", async () => {
  const f=fixture();
  f.input.value="a = 1";await f.controller.execute();
  f.input.value="b = 2";await f.controller.execute();
  f.input.value="unfinished";f.input.setSelectionRange(0,0);
  assert.equal(f.key("ArrowUp"),true);
  assert.equal(f.input.value,"b = 2");
  f.input.setSelectionRange(0,0);f.key("ArrowUp");
  assert.equal(f.input.value,"a = 1");
  f.input.setSelectionRange(f.input.value.length,f.input.value.length);f.key("ArrowDown");
  assert.equal(f.input.value,"b = 2");
  f.input.setSelectionRange(f.input.value.length,f.input.value.length);f.key("ArrowDown");
  assert.equal(f.input.value,"unfinished");
});
test("Enter submits, Shift+Enter preserves multiline editing", async () => {
  const f=fixture();
  f.input.value="print(1)";
  assert.equal(f.key("Enter",{shiftKey:true}),false);
  assert.equal(f.key("Enter"),true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.input.value,"");
});
test("rejects empty and oversized UTF-8 input", async () => {
  let count=0;
  const f=fixture(async()=>{count++;return true;});
  f.input.value=" \n ";
  assert.equal(await f.controller.execute(),false);
  f.input.value="é".repeat(32769);
  assert.equal(await f.controller.execute(),false);
  assert.equal(count,0);
  assert.match(f.notices.at(-1),/64 KiB/);
});
test("submission exception preserves input and re-enables controls", async () => {
  const f=fixture(async()=>{throw new Error("offline");});
  f.input.value="print(2)";
  assert.equal(await f.controller.execute(),false);
  assert.equal(f.input.value,"print(2)");
  assert.equal(f.input.disabled,false);
  assert.match(f.notices.at(-1),/offline/);
});
test("history bounded to 100 entries and suppresses adjacent duplicates", async () => {
  const f=fixture();
  for(let i=0;i<102;i++){f.input.value=String(i);await f.controller.execute();}
  f.input.value="101";await f.controller.execute();
  f.input.value="";f.input.setSelectionRange(0,0);
  for(let i=0;i<110;i++){f.input.setSelectionRange(0,0);f.key("ArrowUp");}
  assert.equal(f.input.value,"2");
});
