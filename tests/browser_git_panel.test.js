"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const panel = require("../docs/app/git_panel.js");
function button() {
  return {disabled:false, handlers:{}, addEventListener(event, fn) {this.handlers[event] = fn;}};
}
test("hosted Pages cannot invoke native Git", async () => {
  const statusButton = button(), diffButton = button(), target = {textContent:""};
  const ui = panel.create({native:{available:()=>false, gitStatus:()=>{throw Error("network")}},
    statusButton, diffButton, target});
  assert.equal(await ui.show("status"),false);
  assert.equal(statusButton.disabled,true);
  assert.equal(diffButton.disabled,true);
  assert.match(target.textContent,/GitHub Pages/);
});
test("Git status and diff are displayed as text", async () => {
  const statusButton = button(), diffButton = button(), target = {textContent:""};
  const calls = [];
  const ui = panel.create({native:{available:()=>true,
    async gitStatus(){calls.push("status");return {ok:true,status:200,output:"## main\\n?? <img onerror=alert(1)>"};},
    async gitDiff(){calls.push("diff");return {ok:true,status:200,output:"diff --git a/a b/a"};}},
    statusButton,diffButton,target});
  assert.equal(await ui.show("status"),true);
  assert.match(target.textContent,/onerror/);
  assert.equal(await ui.show("diff"),true);
  assert.deepEqual(calls,["status","diff"]);
});
test("concurrent clicks are ignored and failed responses remain visible", async () => {
  const statusButton = button(), diffButton = button(), target = {textContent:""};
  let resolve, calls = 0;
  const ui = panel.create({native:{available:()=>true,gitStatus(){calls++;return new Promise(r=>resolve=r);}},
    statusButton,diffButton,target});
  const first = ui.show("status");
  assert.equal(statusButton.disabled,true);
  assert.equal(await ui.show("status"),false);
  assert.equal(calls,1);
  resolve({ok:false,status:422,output:"not a git repository"});
  assert.equal(await first,false);
  assert.match(target.textContent,/not a git repository/);
  assert.equal(statusButton.disabled,false);
});
test("network errors recover both controls", async () => {
  const statusButton = button(), diffButton = button(), target = {textContent:""};
  const ui = panel.create({native:{available:()=>true,gitDiff:async()=>{throw Error("timeout");}},
    statusButton,diffButton,target});
  assert.equal(await ui.show("diff"),false);
  assert.match(target.textContent,/timeout/);
  assert.equal(diffButton.disabled,false);
});

test("stage and commit require explicit confirmation and preserve literal inputs", async () => {
  const statusButton = button(), diffButton = button(), stagedDiffButton = button();
  const stageButton = button(), commitButton = button(), target = {textContent:""};
  const pathInput = {value:"folder/a [1].flow"}, messageInput = {value:"Fix native execution"};
  const calls = [], prompts = [];
  let allow = false;
  const ui = panel.create({native:{available:()=>true,
    async gitStatus(){return {ok:true,status:200,output:"clean"};},
    async gitDiff(){return {ok:true,status:200,output:""};},
    async gitStagedDiff(){calls.push("staged");return {ok:true,status:200,output:"diff --cached"};},
    async gitStage(path){calls.push(["stage",path]);return {ok:true,status:200,output:""};},
    async gitCommit(message){calls.push(["commit",message]);return {ok:true,status:200,output:"[main abc]"};}},
    statusButton,diffButton,stagedDiffButton,stageButton,commitButton,
    pathInput,messageInput,target,confirmAction:(prompt)=>{prompts.push(prompt);return allow;}});
  assert.equal(await ui.stage(),false);
  assert.equal(await ui.commit(),false);
  assert.deepEqual(calls,[]);
  allow = true;
  assert.equal(await ui.stage(),true);
  assert.equal(await ui.show("staged"),true);
  assert.equal(await ui.commit(),true);
  assert.deepEqual(calls,[["stage","folder/a [1].flow"],"staged",["commit","Fix native execution"]]);
  assert.match(prompts[0],/server working tree/);
  assert.match(prompts[1],/ALL currently staged/);
  assert.equal(stageButton.disabled,false);
  assert.equal(commitButton.disabled,false);
});
test("hosted Pages disables all Git writes and does not ask for confirmation", async () => {
  const statusButton = button(), diffButton = button(), stagedDiffButton = button();
  const stageButton = button(), commitButton = button(), target = {textContent:""};
  const ui = panel.create({native:{available:()=>false},statusButton,diffButton,
    stagedDiffButton,stageButton,commitButton,pathInput:{value:"a.py"},
    messageInput:{value:"commit"},target,confirmAction:()=>{throw Error("prompted");}});
  assert.equal(await ui.stage(),false);
  assert.equal(await ui.commit(),false);
  assert.equal(stageButton.disabled,true);
  assert.equal(commitButton.disabled,true);
});
test("Git write concurrency locks all controls and recovers after rejection", async () => {
  const statusButton = button(), diffButton = button(), stagedDiffButton = button();
  const stageButton = button(), commitButton = button(), target = {textContent:""};
  let resolve, calls = 0;
  const ui = panel.create({native:{available:()=>true,
    gitStage(){calls++;return new Promise(r=>resolve=r);}},
    statusButton,diffButton,stagedDiffButton,stageButton,commitButton,
    pathInput:{value:"a.py"},messageInput:{value:"msg"},target,confirmAction:()=>true});
  const first = ui.stage();
  assert.equal(commitButton.disabled,true);
  assert.equal(await ui.stage(),false);
  assert.equal(await ui.commit(),false);
  assert.equal(calls,1);
  resolve({ok:false,status:422,output:"path missing"});
  assert.equal(await first,false);
  assert.match(target.textContent,/path missing/);
  assert.equal(commitButton.disabled,false);
});
