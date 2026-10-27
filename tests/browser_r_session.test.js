"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {create,renderImages,CDN} = require("../docs/app/r_session.js");
function mock() {
  const calls = [], instances = [];
  class WebR {
    constructor(options) {this.options=options;this.closed=false;instances.push(this);}
    async init() {calls.push("init");}
    close() {this.closed=true;}
    Shelter = class {
      async captureR(code, options) {
        calls.push({code,options});
        return {output:[{type:"stdout",data:"42"}],images:[]};
      }
      async purge() {calls.push("purge");}
    };
    async evalRRaw(code,type) {
      calls.push({inspect:code,type});
      return ["@0", "0\tx\tinteger\t2%20x%203\tint%20%5B1%3A6%5D\t0"];
    }
  }
  const load=async()=>({WebR,ChannelType:{PostMessage:"post"}});
  return {calls,instances,load};
}
test("pinned released webR and explicit GitHub Pages PostMessage channel", async()=>{
  assert.equal(CDN,"https://webr.r-wasm.org/v0.6.0/webr.mjs");
  const m=mock(), r=create({load:m.load});
  assert.equal((await r.run("x <- 42")).output,"42\n");
  assert.equal(m.instances[0].options.channelType,"post");
  assert.deepEqual(m.calls[1],{code:"x <- 42",options:{withAutoprint:true}});
  assert.equal(m.calls[2],"purge");
});
test("reuses R state, inspects actual global environment and resets",async()=>{
  const m=mock(), r=create({load:m.load});
  await r.run("x <- 1");
  await r.run("x + 41");
  const inspection=await r.inspect();
  assert.equal(m.instances.length,1);
  assert.equal(inspection.truncated,false);
  assert.deepEqual(inspection.variables,[{name:"x",type:"integer",shape:["2","3"],preview:"int [1:6]"}]);
  assert.match(m.calls.at(-1).inspect, /base::ls\(envir=base::globalenv\(\)/);
  r.reset();
  assert.equal(m.instances[0].closed,true);
  await r.run("x <- 5");
  assert.equal(m.instances.length,2);
});
test("serializes concurrent commands and never accepts oversized or blank input",async()=>{
  const m=mock(), r=create({load:m.load});
  const results=await Promise.all([r.run("a <- 1"),r.run("a + 2")]);
  assert.equal(results.every(x=>x.ok),true);
  assert.deepEqual(m.calls.filter(x=>x.code).map(x=>x.code),["a <- 1","a + 2"]);
  assert.equal((await r.run(" ")).ok,false);
  assert.equal((await r.run("λ".repeat(40000))).ok,false);
  assert.equal(m.calls.filter(x=>x.code).length,2);
});
test("R errors return failure and shelters are purged",async()=>{
  const m=mock(), r=create({load:m.load});
  const instance=await r.run("x <- 1");
  assert.equal(instance.ok,true);
  m.instances[0].Shelter=class {async captureR(){throw Error("R parse error");}async purge(){m.calls.push("purged after error");}};
  const failed=await r.run("stop('bad')");
  assert.equal(failed.ok,false);
  assert.match(failed.output,/R parse error/);
  assert.ok(m.calls.includes("purged after error"));
});
test("captures structured R errors without losing stdout",async()=>{
  const m=mock(), r=create({load:m.load});
  await r.run("x <- 1");
  m.instances[0].Shelter=class {async captureR(){return {output:[{type:"stdout",data:"before"},{type:"error",data:"failed"}],images:[]};}async purge(){}};
  const result=await r.run("stop('bad')");
  assert.equal(result.ok,false);
  assert.match(result.output,/before\nfailed/);
});
test("plot bitmaps render to real canvas API and are closed",()=>{
  const closed=[];
  const bitmap={width:800,height:600,close(){closed.push(true);}};
  const target={replaceChildren(node){this.node=node;}};
  const document={createElement(tag){return {tag,style:{},children:[],setAttribute(){},append(child){this.children.push(child);},getContext(){return {drawImage(...args){assert.equal(args[0],bitmap);}}}};}};
  assert.equal(renderImages(target,[bitmap],document),1);
  assert.equal(target.node.children[0].tag,"canvas");
  assert.equal(closed.length,1);
});
