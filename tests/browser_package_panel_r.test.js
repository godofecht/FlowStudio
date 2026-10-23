"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {create}=(()=>{require("../docs/app/packages_panel.js");return globalThis.FlowStudioPackages;})();

function node(tag="div") {
  const handlers={};
  return {tag,children:[],disabled:false,value:"",textContent:"",style:{},
    setAttribute(k,v){this[k]=v;},addEventListener(k,fn){handlers[k]=fn;},
    click(){handlers.click?.();},replaceChildren(...items){this.children=items;this.textContent="";},
    append(...items){this.children.push(...items);}};
}
function fixture() {
  const calls=[], notices=[];
  const target=node(),input=node("input"),installButton=node("button"),listButton=node("button");
  let lang="python";
  const r={async installPackage(spec){calls.push(["r-install",spec]);return {ok:true};},
    async packages(){calls.push(["r-list"]);return {ok:true,packages:[{name:"Matrix",version:"1.7-0"}]};}};
  const panel=create({document:{createElement:node},target,input,installButton,listButton,
    language:()=>lang,rSession:()=>r,notice:msg=>notices.push(msg),
    request:async (op,code)=>{calls.push(["python",op,code]);return op==="packages"?{ok:true,packages:[{name:"numpy",version:"2"}]}:{ok:true};}});
  return {panel,calls,notices,target,input,installButton,listButton,setLanguage(v){lang=v;panel.updateLanguage();}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test("R panel lists and installs into webR, not the Python worker",async()=>{
  const f=fixture();
  f.setLanguage("r");
  assert.equal(f.input.placeholder,"ggplot2");
  assert.equal(f.installButton.textContent,"Install R package");
  f.input.value="Matrix";
  f.installButton.click();
  await tick();
  assert.deepEqual(f.calls,[["r-install","Matrix"],["r-list"]]);
  assert.equal(f.target.children[0].tag,"table");
  assert.equal(f.target.children[0]["aria-label"],"Installed R packages");
});
test("Python package workflow remains unchanged",async()=>{
  const f=fixture();
  f.input.value="attrs==25.1.0";
  f.installButton.click();
  await tick();
  assert.deepEqual(f.calls,[["python","install","attrs==25.1.0"],["python","packages",undefined]]);
});
test("R invalid specifications never reach a runtime",async()=>{
  const f=fixture();f.setLanguage("r");
  for(const spec of ["ggplot2==1.0","a;system('x')","a..b","-bad"]){f.input.value=spec;f.installButton.click();}
  await tick();
  assert.deepEqual(f.calls,[]);
  assert.match(f.notices.at(-1),/valid R package name/);
});
test("Flow disables package controls and does not submit to Python or R",async()=>{
  const f=fixture();f.setLanguage("flow");
  assert.equal(f.installButton.disabled,true);
  assert.equal(f.listButton.disabled,true);
  assert.equal(await f.panel.list(),false);
  assert.deepEqual(f.calls,[]);
});
test("language switch discards late inventory instead of displaying wrong-runtime packages",async()=>{
  const f=fixture();
  let release;
  const wait=new Promise(resolve=>{release=resolve;});
  const request=async()=>{await wait;return {ok:true,packages:[{name:"numpy",version:"2"}]};};
  const g=fixture();
  const h=create({document:{createElement:node},target:g.target,input:g.input,
    installButton:g.installButton,listButton:g.listButton,notice:msg=>g.notices.push(msg),
    language:()=>g.current||"python",rSession:()=>({}),request});
  const pending=h.list();
  g.current="r";h.updateLanguage();release();
  assert.equal(await pending,false);
  assert.equal(g.target.children.length,0);
});
test("reset clears package results and ignores an inventory response already in flight",async()=>{
  const f=fixture();
  let release;
  const wait=new Promise(resolve=>{release=resolve;});
  const g=create({document:{createElement:node},target:f.target,input:f.input,
    installButton:f.installButton,listButton:f.listButton,
    language:()=>"r",rSession:()=>({async packages(){await wait;return {ok:true,packages:[{name:"Matrix",version:"1"}]};}}),
    request:async()=>{throw Error("wrong runtime");},notice:msg=>f.notices.push(msg)});
  const pending=g.list();
  await tick();
  g.clear();
  release();
  assert.equal(await pending,false);
  assert.equal(f.target.children.length,0);
  assert.doesNotMatch(f.notices.at(-1),/inventory updated/);
});
test("switch away and back invalidates a pending inventory even if the language matches again",async()=>{
  const f=fixture();
  let release;
  const wait=new Promise(resolve=>{release=resolve;});
  let language="python";
  const g=create({document:{createElement:node},target:f.target,input:f.input,
    installButton:f.installButton,listButton:f.listButton,
    language:()=>language,rSession:()=>({}),
    request:async()=>{await wait;return {ok:true,packages:[{name:"numpy",version:"2"}]};},
    notice:msg=>f.notices.push(msg)});
  const pending=g.list();
  language="r";g.updateLanguage();
  language="python";g.updateLanguage();
  release();
  assert.equal(await pending,false);
  assert.equal(f.target.children.length,0);
});
