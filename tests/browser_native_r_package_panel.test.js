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
test("native R package panel loads installed packages without network installation",async()=>{
  const calls=[], notices=[];
  const target=node(),input=node("input"),installButton=node("button"),listButton=node("button");
  let native=true;
  const panel=create({document:{createElement:node},target,input,installButton,listButton,
    language:()=>"r",rNative:()=>native,
    rSession:()=>({async packages(){calls.push("list");return {ok:true,packages:[{name:"splines",version:"4.5.1"}]};},
      async loadPackage(name){calls.push("load:"+name);return {ok:true,output:"Loaded installed R package "+name};},
      async installPackage(name){calls.push("install:"+name);return {ok:true};}}),
    request:async()=>{throw Error("wrong runtime");},notice:text=>notices.push(text)});
  assert.equal(installButton.disabled,false);
  assert.equal(installButton.textContent,"Load installed R package");
  assert.equal(await panel.list(),true);
  assert.equal(target.children[0]["aria-label"],"Installed R packages");
  input.value="splines";
  installButton.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,["list","load:splines","list"]);
  assert.ok(notices.some(text=>text.includes("loaded into the native session")));
  native=false;panel.updateLanguage();
  assert.equal(installButton.textContent,"Install R package");
  installButton.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,["list","load:splines","list","install:splines","list"]);
});
test("native R package panel refuses expression injection before any load",async()=>{
  const calls=[], notices=[];
  const target=node(),input=node("input"),installButton=node("button"),listButton=node("button");
  create({document:{createElement:node},target,input,installButton,listButton,
    language:()=>"r",rNative:()=>true,
    rSession:()=>({async packages(){calls.push("list");return {ok:true,packages:[]};},
      async loadPackage(name){calls.push(name);return {ok:true};}}),
    request:async()=>{throw Error("wrong runtime");},notice:text=>notices.push(text)});
  input.value="splines;stop('unsafe')";
  installButton.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[]);
  assert.ok(notices.some(text=>text.includes("valid R package name")));
});
