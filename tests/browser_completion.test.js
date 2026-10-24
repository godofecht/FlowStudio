"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {create, prefixAt, validItems} = require("../docs/app/completion.js");
const {create:createRSession} = require("../docs/app/r_session.js");
const workerSource = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
const routes = fs.readFileSync(path.join(__dirname, "../src/data_routes.flow"), "utf8");

function fixture({python = async () => ({ok:true,items:["print"]}),
                  r = async () => ({ok:true,items:["mean"]})} = {}) {
  const events = {}, messages = [];
  let language = "python", generation = 0, busy = false;
  const source = {
    value:"pri", selectionStart:3, selectionEnd:3,
    addEventListener(type, fn) {(events[type] ||= []).push(fn);},
    setRangeText(value, start, end) {
      this.value = this.value.slice(0,start) + value + this.value.slice(end);
      this.selectionStart = this.selectionEnd = start + value.length;
    },
    dispatchEvent(event) {for (const fn of events[event.type] || []) fn(event);},
    focus() {}
  };
  const button = {addEventListener(type,fn) {(events["button:"+type] ||= []).push(fn);}};
  const target = {children:[],replaceChildren(...children){this.children=children;}};
  const document = {createElement(tag) {return {
    tag, children:[], listeners:{}, textContent:"",
    append(...children) {this.children.push(...children);},
    setAttribute() {},
    addEventListener(type, fn) {this.listeners[type]=fn;}
  };}};
  const api = create({source,button,target,language:()=>language,python,r,
    generation:()=>generation,isBusy:()=>busy,notice:x=>messages.push(x),document});
  return {api,source,target,events,messages,
    language:x=>{language=x;},reset:()=>{generation++;},busy:x=>{busy=x;}};
}
async function settle(replies, n) {
  for(let i=0;i<100&&replies.length<n;i++) await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(replies.length,n);
}
test("prefix parsing refuses arbitrary expressions, selections, member access and Flow", () => {
  const at = (value,language,offset=value.length) =>
    prefixAt({value,selectionStart:offset,selectionEnd:offset},language)?.prefix ?? null;
  assert.equal(at("pri","python"),"pri");
  assert.equal(at("x = pri","python"),"pri");
  assert.equal(at("x.foo","python"),null);
  assert.equal(at("mean","r"),"mean");
  assert.equal(at("stats::lm","r"),null);
  assert.equal(at("df$col","r"),null);
  assert.equal(at("print","flow"),null);
  assert.equal(prefixAt({value:"print",selectionStart:0,selectionEnd:5},"python"),null);
  assert.equal(validItems(["print"],"pri","python"),true);
  assert.equal(validItems(["print;bad"],"pri","python"),false);
  assert.equal(validItems(Array(65).fill("print"),"pri","python"),false);
});
test("editor completion inserts selected live symbol and fires input for draft tracking", async () => {
  const f=fixture({python:async prefix=>{
    assert.equal(prefix,"pri");
    return {ok:true,items:["print","private"]};
  }});
  let inputs=0;f.source.addEventListener("input",()=>{inputs++;});
  assert.equal(await f.api.complete(),true);
  assert.equal(f.target.children[1].children.length,2);
  f.target.children[1].children[0].listeners.click();
  assert.equal(f.source.value,"print");
  assert.equal(f.source.selectionStart,5);
  assert.equal(inputs,1);
  assert.equal(f.target.children.length,0);
});
test("stale source, language and generation cannot insert a completion", async () => {
  let release;const wait=new Promise(resolve=>{release=resolve;});
  const f=fixture({python:async()=>{await wait;return {ok:true,items:["print"]};}});
  const task=f.api.complete();
  f.source.value="private";f.source.selectionStart=f.source.selectionEnd=7;
  f.reset();release();
  assert.equal(await task,false);
  assert.equal(f.target.children.length,0);
  assert.equal(f.source.value,"private");
});
test("invalid completion payload is rejected without HTML interpretation", async () => {
  const f=fixture({python:async()=>({ok:true,items:["pri<img>"]})});
  assert.equal(await f.api.complete(),false);
  assert.equal(f.target.children.length,0);
  assert.match(f.messages.at(-1),/Invalid completion response/);
});
test("Python completion uses actual worker interpreter namespace without eval", async () => {
  const calls=[], replies=[];
  const py={async runPythonAsync(code){calls.push(code);return '["print","private"]';}};
  const self={postMessage:message=>replies.push(message)};
  vm.runInNewContext(workerSource,{self,TextEncoder,importScripts:()=>{},
    loadPyodide:async()=>py,fetch:async()=>({ok:true,text:async()=>""})});
  self.onmessage({data:{id:1,op:"complete",code:"pri"}});
  self.onmessage({data:{id:2,op:"complete",code:"pri;evil()"}});
  await settle(replies,2);
  assert.equal(replies[0].ok,true);
  assert.equal(replies[0].items[0],"print");
  assert.equal(replies[1].ok,false);
  assert.equal(calls.length,1);
  assert.match(calls[0],/set\(globals\(\)\)/);
  assert.match(calls[0],/vars\(_fs_completion_builtins\)/);
  assert.doesNotMatch(calls[0],/\beval\(/);
});
test("R completion enumerates search-path names through real webR API", async () => {
  const calls=[];
  class WebR {
    async init() {}
    async evalRRaw(code, type) {
      calls.push({code,type});return ["mean","median"];
    }
  }
  const r=createRSession({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})});
  const result=await r.complete("me");
  assert.equal(result.ok,true);
  assert.equal(result.items.length,2);
  assert.equal(calls.length,1);
  assert.equal(calls[0].type,"string[]");
  assert.match(calls[0].code,/head\(search\(\), 16L\)/);
  assert.match(calls[0].code,/startsWith\(n, "me"\)/);
  assert.doesNotMatch(calls[0].code,/\bget\(|\beval\(/);
  assert.equal((await r.complete("x;system('x')")).ok,false);
  assert.equal(calls.length,1);
});
test("both GitHub Pages and native Flow route load completion module", () => {
  assert.match(app, /<script src="\.\/completion\.js"><\/script>/);
  assert.match(app, /id="completeSource"/);
  assert.match(app, /request\("complete", prefix\)/);
  assert.match(app, /getRSession\(\)\.complete\(prefix\)/);
  assert.match(routes, /url == "\/app\/completion\.js"/);
  assert.match(routes, /path: "docs\/app\/completion\.js"/);
});
