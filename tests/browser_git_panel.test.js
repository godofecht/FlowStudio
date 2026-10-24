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
