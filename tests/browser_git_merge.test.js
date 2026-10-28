"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const native = require("../docs/app/native_flow.js");
const panel = require("../docs/app/git_panel.js");

function button() {
  return {disabled:false, handlers:{},
    addEventListener(event, callback) {this.handlers[event] = callback;}};
}

test("fast-forward merge uses the fixed local route and rejects unsafe names", async () => {
  const previousLocation = globalThis.location;
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.location = new URL("http://127.0.0.1:8751/app/");
  globalThis.fetch = async (url, options) => {
    calls.push({url, options});
    return {ok:true,status:200,headers:{get:()=>null},text:async()=> "Updating HEAD"};
  };
  try {
    const result = await native.gitMergeBranch("feature/fast-forward");
    assert.equal(result.ok, true);
    assert.equal(result.output, "Updating HEAD");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/git/branch/merge");
    assert.equal(calls[0].options.body, "feature/fast-forward");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.headers["X-FlowStudio-Intent"], "run");
    assert.equal(calls[0].options.credentials, "omit");
    assert.equal(calls[0].options.redirect, "error");
    for (const name of ["", "-bad", "a..b", "a//b", "a.lock", "a/",
                        ".hidden", "a b", "a\n", "x".repeat(129)])
      await assert.rejects(native.gitMergeBranch(name), /Git branch name/);
    assert.equal(calls.length, 1);
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    globalThis.fetch = previousFetch;
  }
});

test("hosted Pages cannot send a merge to native localhost", async () => {
  const previousLocation = globalThis.location;
  const previousFetch = globalThis.fetch;
  globalThis.location = new URL("https://godofecht.github.io/FlowStudio/app/");
  globalThis.fetch = () => {throw Error("unexpected network request");};
  try {
    await assert.rejects(native.gitMergeBranch("feature/fast-forward"),
                         /native FlowStudio server/);
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    globalThis.fetch = previousFetch;
  }
});

test("fast-forward merge requires confirmation, locks other operations and reports failure", async () => {
  const statusButton = button(), diffButton = button(), mergeBranchButton = button();
  const createBranchButton = button(), switchBranchButton = button(), deleteBranchButton = button();
  const branchInput = {value:"feature/fast-forward"};
  const target = {textContent:""}, prompts = [], calls = [];
  let allow = false, finish;
  const ui = panel.create({
    native:{available:()=>true,gitMergeBranch(name) {
      calls.push(name);
      return new Promise(resolve => {finish = resolve;});
    }},
    statusButton,diffButton,mergeBranchButton,createBranchButton,
    switchBranchButton,deleteBranchButton,branchInput,target,
    confirmAction:message => {prompts.push(message);return allow;}
  });
  assert.equal(await ui.mergeBranch(), false);
  assert.deepEqual(calls, []);
  allow = true;
  const pending = ui.mergeBranch();
  assert.equal(mergeBranchButton.disabled, true);
  assert.equal(createBranchButton.disabled, true);
  assert.equal(deleteBranchButton.disabled, true);
  assert.equal(await ui.mergeBranch(), false);
  assert.equal(await ui.switchBranch(), false);
  finish({ok:false,status:422,output:"Not possible to fast-forward"});
  assert.equal(await pending, false);
  assert.match(target.textContent, /Not possible to fast-forward/);
  assert.equal(mergeBranchButton.disabled, false);
  assert.deepEqual(calls, ["feature/fast-forward"]);
  assert.match(prompts[0], /CURRENT local branch/);
  assert.match(prompts[0], /no merge commit/);
  const again = ui.mergeBranch();
  finish({ok:true,status:200,output:"Updating HEAD"});
  assert.equal(await again, true);
  assert.equal(target.textContent, "Updating HEAD");
  assert.equal(typeof mergeBranchButton.handlers.click, "function");
});

test("hosted Pages disables merge without asking for confirmation", async () => {
  const mergeBranchButton = button();
  const ui = panel.create({
    native:{available:()=>false},statusButton:button(),diffButton:button(),
    mergeBranchButton,branchInput:{value:"feature/fast-forward"},
    target:{textContent:""},confirmAction:()=>{throw Error("unexpected confirmation");}
  });
  assert.equal(await ui.mergeBranch(), false);
  assert.equal(mergeBranchButton.disabled, true);
});

test("checked-in browser UI wires the merge button into the real Git panel", () => {
  const html = fs.readFileSync(require.resolve("../docs/app/index.html"), "utf8");
  assert.match(html, /id="gitMergeBranch"/);
  assert.match(html, /mergeBranchButton:\$\("gitMergeBranch"\)/);
  const flow = fs.readFileSync(require.resolve("../src/main.flow"), "utf8");
  assert.match(flow, /\/api\/git\/branch\/merge/);
  assert.match(flow, /proc_arg\(command, "--ff-only"\)/);
  assert.match(flow, /proc_arg\(verify, "refs\/heads\/" \+ name\)/);
});
