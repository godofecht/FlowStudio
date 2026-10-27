"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {create} = require("../docs/app/r_session.js");

const workerSource = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");

function pythonHarness(reply) {
  const calls = [], replies = [];
  const py = {async runPythonAsync(code) { calls.push(code); return typeof reply === "function" ? reply(code) : reply; }};
  const self = {postMessage: message => replies.push(message)};
  vm.runInNewContext(workerSource, {self, TextEncoder, importScripts: () => {},
    loadPyodide: async () => py, fetch: async () => ({ok:true,text:async()=>""})});
  return {calls, replies, send:(id, code)=>self.onmessage({data:{id,op:"check",code}})};
}
async function waitFor(h, count) {
  for (let i = 0; i < 100 && h.replies.length < count; i++)
    await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(h.replies.length, count);
}
function rHarness(rows) {
  const calls = [], instances = [];
  class WebR {
    constructor() { instances.push(this); }
    async init() {}
    close() {}
    async evalRRaw(code, type) { calls.push({code,type}); return typeof rows === "function" ? rows(code) : rows; }
    Shelter = class {async captureR() {throw Error("syntax check must not execute source");}};
  }
  return {calls, instances, session:create({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})})};
}

test("Python AST syntax check returns location without executing source", async () => {
  const h = pythonHarness(JSON.stringify({ok:false,diagnostics:[{message:"invalid syntax",line:2,column:3}]}));
  h.send(1, "side_effect()\nif");
  await waitFor(h, 1);
  assert.equal(h.replies[0].ok, false);
  assert.equal(h.replies[0].diagnostics[0].line, 2);
  assert.match(h.calls[0], /_fs_ast\.parse\(_fs_source\)/);
  assert.match(h.calls[0], /side_effect\(\)/);
  assert.equal(h.calls.length, 1);
});
test("Python syntax checks serialize with ordinary execution", async () => {
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  let seen = 0;
  const h = pythonHarness(async () => {
    seen++;
    if (seen === 1) await gate;
    return JSON.stringify({ok:true,diagnostics:[]});
  });
  h.send(1, "x=1");
  h.send(2, "x=2");
  for (let i = 0; i < 20 && seen < 1; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(seen, 1);
  release();
  await waitFor(h, 2);
  assert.deepEqual(h.replies.map(x=>x.id), [1,2]);
  assert.equal(h.replies.every(x=>x.ok), true);
});
test("Python syntax diagnostics reject oversized input and malformed runtime payloads", async () => {
  const h = pythonHarness(JSON.stringify({ok:false,diagnostics:[{message:"bad",line:0,column:1}]}));
  h.send(1, "λ".repeat(40000));
  h.send(2, "x=1");
  await waitFor(h, 2);
  assert.match(h.replies[0].output, /Invalid execution request/);
  assert.match(h.replies[1].output, /Invalid syntax diagnostic response/);
  assert.equal(h.calls.length, 1);
});
test("R syntax check uses parse, not evaluation, and returns line/column", async () => {
  const h = rHarness(["error\t" + encodeURIComponent("<text>:3:7: unexpected symbol")]);
  const result = await h.session.checkSyntax("x <- 1\ny <- 2\n?");
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics[0], {message:"<text>:3:7: unexpected symbol",line:3,column:7});
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].type, "string[]");
  assert.match(h.calls[0].code, /parse\(text=/);
  assert.doesNotMatch(h.calls[0].code, /eval\(parse/);
});
test("R syntax success and invalid requests are bounded", async () => {
  const h = rHarness(["ok"]);
  assert.deepEqual(await h.session.checkSyntax("x <- 1"), {ok:true,diagnostics:[]});
  assert.equal((await h.session.checkSyntax(" ")).ok,false);
  assert.equal((await h.session.checkSyntax("λ".repeat(40000))).ok,false);
  assert.equal(h.calls.length, 1);
});
test("R reset discards an in-flight syntax response", async () => {
  let release, entered;
  const gate = new Promise(resolve => {release = resolve;});
  const started = new Promise(resolve => {entered = resolve;});
  const h = rHarness(async () => {entered(); await gate; return ["ok"];});
  const result = h.session.checkSyntax("x <- 1");
  await started;
  h.session.reset();
  release();
  assert.equal((await result).ok, false);
});
test("Pages exposes syntax check control and diagnostic navigation", () => {
  assert.match(app, /id="checkSyntax"/);
  assert.match(app, /getRSession\(\)\.checkSyntax\(code\)/);
  assert.match(app, /nativeRSession = FlowStudioNativeFlow\.createRSession\(\)/);
  assert.match(app, /request\("check", code\)/);
  assert.match(app, /code\.split\("\\n"\)/);
  assert.match(app, /setSelectionRange\(offset, offset\)/);
  assert.match(app, /\$\("source"\)\.value !== code/);
  assert.match(app, /checkSyntax"\)\.addEventListener/);
});


test("browser Flow syntax checks use the native compiler client, not run", () => {
  assert.match(app, /language === "flow" && !globalThis\.FlowStudioNativeFlow\?\.available/);
  assert.match(app, /FlowStudioNativeFlow\.checkSyntax\(code\)/);
  assert.doesNotMatch(app, /FlowStudioNativeFlow\.run\(code\)[^;]*checkSyntax/);
  assert.match(app, /Flow strict compile check passed; source was not executed/);
});
