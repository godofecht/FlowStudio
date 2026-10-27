"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {create} = require("../docs/app/console_repl.js");

function fixture(submit = async () => true) {
  const listeners = new Map(), calls = [], notices = [];
  const input = {value:"",disabled:false,selectionStart:0,selectionEnd:0,
    addEventListener(type,fn){listeners.set("input:"+type,fn);},
    setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
    setAttribute(name,value){this[name]=value;}};
  const button = {disabled:false,addEventListener(type,fn){listeners.set("button:"+type,fn);}};
  const languageSelect = {value:"python",disabled:false,addEventListener(type,fn){listeners.set("language:"+type,fn);}};
  const controller = create({input,button,languageSelect,
    submit:async (code,language)=>{calls.push([code,language]);return submit(code,language);},
    notice:message=>notices.push(message)});
  function switchTo(language) {languageSelect.value=language;listeners.get("language:change")();}
  function key(key) {
    let prevented=false;
    listeners.get("input:keydown")({key,shiftKey:false,ctrlKey:false,metaKey:false,altKey:false,
      preventDefault(){prevented=true;}});
    return prevented;
  }
  return {input,button,languageSelect,controller,calls,notices,switchTo,key};
}

test("console routes Python, R and Flow independently of the source editor", async () => {
  const f=fixture();
  f.input.value="x = 41";assert.equal(await f.controller.execute(),true);
  f.switchTo("r");assert.match(f.input.placeholder,/R expression/);
  f.input.value="x <- 42";assert.equal(await f.controller.execute(),true);
  f.switchTo("flow");f.input.value="function main() -> i32 { return 0 }";
  assert.equal(await f.controller.execute(),true);
  assert.deepEqual(f.calls.map(call=>call[1]),["python","r","flow"]);
  assert.equal(f.input["aria-label"],"flow console input");
  f.switchTo("python");f.input.setSelectionRange(0,0);f.key("ArrowUp");
  assert.equal(f.input.value,"x = 41");
  f.switchTo("r");f.input.setSelectionRange(0,0);f.key("ArrowUp");
  assert.equal(f.input.value,"x <- 42");
});

test("switching language preserves unsent drafts and separate history positions", async () => {
  const f=fixture();
  f.input.value="print(1)";await f.controller.execute();
  f.input.value="python unfinished";f.switchTo("r");
  f.input.value="r unfinished";f.switchTo("python");
  assert.equal(f.input.value,"python unfinished");
  f.input.setSelectionRange(0,0);f.key("ArrowUp");
  assert.equal(f.input.value,"print(1)");
  f.input.setSelectionRange(f.input.value.length,f.input.value.length);f.key("ArrowDown");
  assert.equal(f.input.value,"python unfinished");
  f.switchTo("r");assert.equal(f.input.value,"r unfinished");
});

test("rejected execution preserves source, language and history", async () => {
  const f=fixture(async()=>false);
  f.switchTo("r");f.input.value="stop('error')";
  assert.equal(await f.controller.execute(),false);
  assert.equal(f.input.value,"stop('error')");
  f.input.setSelectionRange(0,0);
  assert.equal(f.key("ArrowUp"),false);
  assert.equal(f.controller.getLanguage(),"r");
});

test("pending execution locks language selector and cannot lose input", async () => {
  let finish;
  const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));
  f.input.value="print(2)";
  const pending=f.controller.execute();
  assert.equal(f.languageSelect.disabled,true);
  f.switchTo("r");
  assert.equal(f.languageSelect.value,"python");
  assert.equal(f.controller.getLanguage(),"python");
  finish(true);
  assert.equal(await pending,true);
  assert.equal(f.languageSelect.disabled,false);
  assert.deepEqual(f.calls,[["print(2)","python"]]);
});

test("invalid console language is rejected without discarding input", () => {
  const f=fixture();
  f.input.value="unfinished";
  f.switchTo("shell");
  assert.equal(f.languageSelect.value,"python");
  assert.equal(f.input.value,"unfinished");
});
