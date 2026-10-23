"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {create} = require("../docs/app/r_session.js");
function mock(lines) {
  const calls = [];
  class WebR {
    async init() {}
    close() {}
    async evalRRaw(code, type) {calls.push({code,type});return lines;}
  }
  return {calls,load:async()=>({WebR,ChannelType:{PostMessage:"post"}})};
}
test("R table reads an actual data.frame or matrix by validated name", async () => {
  const m=mock(["3\t2","x\ty","1\t2","3\t4","5\t6"]);
  const session=create({load:m.load});
  const result=await session.table("data");
  assert.equal(result.ok,true);
  assert.deepEqual(result.table,{columns:["x","y"],rows:[["1","2"],["3","4"],["5","6"]],totalRows:3,truncated:false});
  assert.match(m.calls[0].code,/get\("data", envir=\.GlobalEnv, inherits=FALSE\)/);
  assert.match(m.calls[0].code,/is\.data\.frame\(v\) \|\| is\.matrix\(v\)/);
  assert.equal(m.calls[0].type,"string[]");
});
test("R table rejects expression injection before evaluating", async () => {
  const m=mock([]);
  const session=create({load:m.load});
  const result=await session.table('data"); system("bad');
  assert.equal(result.ok,false);
  assert.equal(m.calls.length,0);
});
test("R table rejects malformed data and caps previews", async () => {
  const m=mock(["300\t1","name",...Array.from({length:201},()=> "x")]);
  const session=create({load:m.load});
  assert.equal((await session.table("data")).ok,false);
  const n=mock(["300\t1","name","x"]);
  const next=create({load:n.load});
  const result=await next.table("data");
  assert.equal(result.ok,true);
  assert.equal(result.table.truncated,true);
});
