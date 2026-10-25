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
test("native R package panel allows real inventory but disables installation",async()=>{
  const calls=[], notices=[];
  const target=node(),input=node("input"),installButton=node("button"),listButton=node("button");
  let native=false;
  const panel=create({document:{createElement:node},target,input,installButton,listButton,
    language:()=>"r",rReadOnly:()=>native,
    rSession:()=>({async packages(){calls.push("list");return {ok:true,packages:[{name:"stats",version:"4.5.1"}]};},
      async installPackage(){throw Error("must not install");}}),
    request:async()=>{throw Error("wrong runtime");},notice:text=>notices.push(text)});
  native=true;panel.updateLanguage();
  assert.equal(installButton.disabled,true);
  assert.equal(listButton.disabled,false);
  assert.equal(await panel.list(),true);
  assert.deepEqual(calls,["list"]);
  assert.equal(target.children[0]["aria-label"],"Installed R packages");
  input.value="ggplot2";
  installButton.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,["list"]);
  native=false;panel.updateLanguage();
  assert.equal(installButton.disabled,false);
});