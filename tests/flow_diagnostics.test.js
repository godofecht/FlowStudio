"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {mount} = require("../web/flow_diagnostics.js");
function fixture(checkSyntax = async () => ({ok:true,output:"checked",diagnostics:[]})) {
  const events = {};
  const markers = [];
  const output = {hidden:true,textContent:""};
  const status = {textContent:"",dataset:{}};
  const button = {disabled:false,handlers:{},addEventListener(name, fn){this.handlers[name]=fn;},click(){this.handlers.click();}};
  const language = {value:"flow",addEventListener(name,fn){events.language=fn;}};
  const app = {documents:{active:()=>({id:currentDoc})}};
  let currentDoc="doc-1", currentModel;
  function model(value) {let version=1;return {
    getValue:()=>value,getVersionId:()=>version,getLineCount:()=>value.split("\n").length,
    getLineMaxColumn:line=>value.split("\n")[line-1].length+1,
    edit(text){value=text;version++;events.content();}
  };}
  currentModel=model("function main() -> i32 {\n  return 0\n}");
  const editor = {
    getModel:()=>currentModel,
    createDecorationsCollection:()=>({set:x=>markers.push(x),clear:()=>markers.push([])}),
    onDidChangeModelContent:fn=>{events.content=fn;},
    onDidChangeModel:fn=>{events.model=fn;},
    setPosition:point=>{editor.position=point;},
    revealPositionInCenterIfOutsideViewport:point=>{editor.revealed=point;}
  };
  const native = {available:()=>true,checkSyntax};
  const controller=mount({editor,native,app,language,button,output,status});
  return {controller,events,editor,button,language,output,status,markers,
    edit:text=>currentModel.edit(text),switchDoc:(id,text)=>{currentDoc=id;currentModel=model(text);events.model();}};
}
test("real compiler result decorates Monaco source and retains complete error output",async()=>{
  const f=fixture(async code=>{
    assert.match(code,/function main/);
    return {ok:false,output:"/tmp/test.flow:2:3: error: unexpected token",diagnostics:[{line:2,column:3,message:"unexpected token"}]};
  });
  assert.equal(await f.controller.check(),false);
  assert.deepEqual(f.markers.at(-1)[0].range,{startLineNumber:2,startColumn:3,endLineNumber:2,endColumn:4});
  assert.equal(f.editor.position.lineNumber,2);
  assert.match(f.output.textContent,/unexpected token/);
  assert.equal(f.status.dataset.state,"error");
});
test("success clears old decorations and reports compiler success",async()=>{
  const f=fixture();
  assert.equal(await f.controller.check(),true);
  assert.deepEqual(f.markers.at(-1),[]);
  assert.equal(f.status.dataset.state,"ok");
});
test("edit and undo invalidate an in-flight compiler response",async()=>{
  let resolve;
  const f=fixture(()=>new Promise(done=>{resolve=done;}));
  const first=f.controller.check();
  f.edit("broken");
  f.edit("function main() -> i32 {\n  return 0\n}");
  resolve({ok:false,output:"stale",diagnostics:[{line:1,column:1,message:"stale"}]});
  assert.equal(await first,false);
  assert.equal(f.output.hidden,true);
  assert.deepEqual(f.markers.at(-1),[]);
  assert.equal(f.button.disabled,false);
});
test("document and language switches reject stale diagnostics",async()=>{
  let resolve;
  const f=fixture(()=>new Promise(done=>{resolve=done;}));
  const first=f.controller.check();
  f.switchDoc("doc-2","unrelated <- 1");
  resolve({ok:false,output:"wrong file",diagnostics:[{line:1,column:1,message:"wrong"}]});
  assert.equal(await first,false);
  assert.equal(f.editor.position,undefined);
  f.language.value="r";f.events.language();
  assert.equal(f.button.disabled,true);
  assert.equal(await f.controller.check(),false);
});
test("bad compiler locations cannot decorate an unrelated or nonexistent line",async()=>{
  const f=fixture(async()=>({ok:false,output:"error without valid location",diagnostics:[
    {line:99,column:1,message:"wrong"},{line:2,column:999,message:"clamped"},
    {line:-1,column:1,message:"wrong"}]}));
  assert.equal(await f.controller.check(),false);
  assert.equal(f.markers.at(-1).length,1);
  assert.equal(f.markers.at(-1)[0].range.startColumn,11);
  assert.equal(f.editor.position.lineNumber,2);
});
test("transport errors are visible and do not create invented compiler locations",async()=>{
  const f=fixture(async()=>{throw Error("Flow compiler missing");});
  assert.equal(await f.controller.check(),false);
  assert.match(f.output.textContent,/Flow compiler missing/);
  assert.deepEqual(f.markers.at(-1),[]);
});
test("a newer check wins after editing while an older compiler call is pending",async()=>{
  const replies=[];
  const f=fixture(()=>new Promise(resolve=>replies.push(resolve)));
  const first=f.controller.check();
  f.edit("function main() -> i32 {\n  return 1\n}");
  const second=f.controller.check();
  replies[0]({ok:false,output:"old",diagnostics:[{line:1,column:1,message:"old"}]});
  assert.equal(await first,false);
  assert.equal(f.button.disabled,true);
  replies[1]({ok:true,output:"new check passed",diagnostics:[]});
  assert.equal(await second,true);
  assert.equal(f.output.textContent,"new check passed");
  assert.equal(f.button.disabled,false);
});
test("invalid response is rejected without inventing compiler markers",async()=>{
  const f=fixture(async()=>({ok:true,output:5,diagnostics:[]}));
  assert.equal(await f.controller.check(),false);
  assert.match(f.output.textContent,/Invalid native Flow compiler response/);
  assert.deepEqual(f.markers.at(-1),[]);
});

test("multiple real compiler locations decorate distinct Monaco lines in compiler order", async () => {
  const f = fixture(async () => ({ok:false, output:"two errors", diagnostics:[
    {line:2,column:3,message:"parse error: unexpected token"},
    {line:1,column:10,message:"type error: invalid declaration"}
  ]}));
  assert.equal(await f.controller.check(), false);
  assert.equal(f.markers.at(-1).length, 2);
  assert.deepEqual(f.markers.at(-1).map(item => item.range.startLineNumber), [2,1]);
  assert.equal(f.markers.at(-1)[0].options.hoverMessage.value, "parse error: unexpected token");
  assert.equal(f.editor.position.lineNumber, 2);
});
