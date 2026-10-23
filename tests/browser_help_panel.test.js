"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {create, validTopic} = require("../docs/app/help_panel.js");
const {create: createRSession} = require("../docs/app/r_session.js");
const workerSource = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");

function panel({python = async topic => ({ok:true,name:topic,doc:"doc"}), r = async topic => ({ok:true,name:topic,doc:"R doc"})} = {}) {
  let busy = false, epoch = 0, lang = "python", status = "";
  const listeners = {};
  const input = {value:"len", addEventListener(type, fn) {listeners[type] = fn;}};
  const button = {addEventListener(type, fn) {listeners["button:" + type] = fn;}};
  const target = {children:[], replaceChildren(...children) {this.children = children;}};
  const document = {createElement(tag) {return {tag, textContent:"", children:[],
    setAttribute(){}, append(...children){this.children.push(...children);}};}};
  const api = create({input, button, target, document, notice:text=>{status=text;},
    language:()=>lang, python, r, isBusy:()=>busy, setBusy:value=>{busy=value;},
    generation:()=>epoch});
  return {api,input,target,listeners, status:()=>status, busy:()=>busy,
    setLanguage:value=>{lang=value;}, reset:()=>{epoch++;busy=false;}};
}
test("help topics are bounded identifiers, never expressions or URLs", () => {
  assert.equal(validTopic("python","pandas.DataFrame.head"),true);
  assert.equal(validTopic("python","__import__('os')"),false);
  assert.equal(validTopic("python","a.b.c.d.e"),false);
  assert.equal(validTopic("r","stats::lm"),true);
  assert.equal(validTopic("r","system('id')"),false);
  assert.equal(validTopic("r","stats:::lm"),false);
  assert.equal(validTopic("flow","len"),false);
});
test("help pane renders documentation only through textContent", async () => {
  const f=panel({python:async()=>({ok:true,name:"len",doc:"<img src=x onerror=alert(1)>"})});
  assert.equal(await f.api.lookup(),true);
  assert.equal(f.target.children[0].children[1].textContent,"<img src=x onerror=alert(1)>");
  assert.equal(f.target.children[0].children[1].tag,"pre");
  assert.equal(f.busy(),false);
});
test("invalid topic does not invoke interpreter", async () => {
  let calls=0;const f=panel({python:async()=>{calls++;return {ok:true,name:"x",doc:"x"};}});
  f.input.value="x();";assert.equal(await f.api.lookup(),false);assert.equal(calls,0);
});
test("reset and language change discard stale documentation", async () => {
  let release;const wait=new Promise(resolve=>{release=resolve;});
  const f=panel({python:async()=>{await wait;return {ok:true,name:"len",doc:"stale"};}});
  const result=f.api.lookup();f.reset();release();
  assert.equal(await result,false);assert.equal(f.target.children.length,0);
});
test("R help can be requested and missing docs do not overwrite the pane", async () => {
  const f=panel({r:async()=>({ok:false,output:"Not found"})});
  f.setLanguage("r");f.input.value="stats::lm";
  assert.equal(await f.api.lookup(),false);
  assert.match(f.status(),/Not found/);
});
test("Python worker resolves help by static attribute lookup without eval", async () => {
  const calls=[], replies=[];
  const py={async runPythonAsync(source){calls.push(source);return JSON.stringify({ok:true,name:"len",doc:"length"});}};
  const self={postMessage:reply=>replies.push(reply)};
  vm.runInNewContext(workerSource,{self,TextEncoder,importScripts:()=>{},
    loadPyodide:async()=>py,fetch:async()=>({ok:true,text:async()=>""})});
  self.onmessage({data:{id:1,op:"help",code:"len"}});
  for(let i=0;i<50&&!replies.length;i++) await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(replies[0].ok,true);assert.equal(replies[0].doc,"length");
  assert.match(calls[0],/getattr_static/);
  assert.doesNotMatch(calls[0],/eval\(/);
  self.onmessage({data:{id:2,op:"help",code:"os.system('id')"}});
  for(let i=0;i<50&&replies.length<2;i++) await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(replies[1].ok,false);assert.equal(calls.length,1);
});
test("R help uses installed documentation without evaluating user expressions", async () => {
  const calls=[];
  class WebR {
    async init(){}
    async evalRRaw(code,type){calls.push({code,type});return ["ok",encodeURIComponent("Linear models")];}
    close(){}
  }
  const session=createRSession({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})});
  const result=await session.help("stats::lm");
  assert.equal(result.ok,true);assert.equal(result.doc,"Linear models");
  assert.match(calls[0].code,/Rd2txt/);
  assert.match(calls[0].code,/utils::help/);
  assert.equal(calls[0].type,"string[]");
  assert.equal((await session.help("system('id')")).ok,false);
  assert.equal(calls.length,1);
});
test("browser workspace loads help panel and wires both interpreters", () => {
  assert.match(html,/src="\.\/help_panel\.js"/);
  assert.match(html,/id="helpQuery"/);
  assert.match(html,/id="lookupHelp"/);
  assert.match(html,/FlowStudioHelpPanel\.create/);
  assert.match(html,/request\("help", topic\)/);
  assert.match(html,/getRSession\(\)\.help\(topic\)/);
});
