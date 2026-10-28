/* Explicit, local-only Git operations on the native server working tree.
 * The browser never sends a command, repository path, or shell expression.
 */
(function (global) {
"use strict";
function create({native, statusButton, diffButton, stagedDiffButton, stageButton, unstageButton, commitButton,
                 branchesButton, createBranchButton, switchBranchButton, deleteBranchButton, branchInput,
                 pathInput, messageInput, target, notice, confirmAction}) {
  if (!native || !statusButton || !diffButton || !target)
    throw new Error("Git panel requires its native client and controls.");
  const supported = !!native.available();
  const controls = [statusButton, diffButton, stagedDiffButton, stageButton, unstageButton, commitButton,
    branchesButton, createBranchButton, switchBranchButton, deleteBranchButton].filter(Boolean);
  let pending = false;
  function lock(value) {
    for (const button of controls) button.disabled = value || !supported;
  }
  lock(false);
  if (!supported)
    target.textContent = "Git requires the local FlowStudio server. GitHub Pages cannot access your working tree.";
  async function perform(kind, operation) {
    if (!supported || pending) return false;
    pending = true;
    lock(true);
    target.textContent = "Running native Git " + kind + "…";
    try {
      const response = await operation();
      if (!response || typeof response.ok !== "boolean" || typeof response.output !== "string")
        throw new Error("Invalid native Git response.");
      if (response.ok) {
        target.textContent = response.output || (kind === "status" ? "Clean working tree." :
          kind === "diff" || kind === "staged diff" ? "No changes." : "Operation succeeded.");
        notice?.("Native Git " + kind + " completed for the server working tree.");
        return true;
      }
      target.textContent = "Git " + kind + " failed (HTTP " + response.status + "): " + response.output;
      notice?.("Native Git " + kind + " failed.");
      return false;
    } catch (error) {
      target.textContent = "Git " + kind + " unavailable: " + String(error?.message || error);
      notice?.("Native Git " + kind + " unavailable.");
      return false;
    } finally {
      pending = false;
      lock(false);
    }
  }
  function approve(message) {
    const confirm = confirmAction || global.confirm;
    return typeof confirm === "function" && confirm(message) === true;
  }
  function show(kind) {
    if (kind === "status") return perform("status", () => native.gitStatus());
    if (kind === "diff") return perform("diff", () => native.gitDiff());
    if (kind === "staged") return perform("staged diff", () => native.gitStagedDiff());
    if (kind === "branches") return perform("branches", () => native.gitBranches());
    return Promise.resolve(false);
  }
  function stage() {
    if (!supported || pending || !pathInput) return Promise.resolve(false);
    const path = pathInput.value;
    if (!path || !path.trim() || !approve("Stage Git path \"" + path +
      "\" in the native server working tree? A directory stages its contents.")) return Promise.resolve(false);
    return perform("stage", () => native.gitStage(path));
  }
  function unstage() {
    if (!supported || pending || !pathInput) return Promise.resolve(false);
    const path = pathInput.value;
    if (!path || !path.trim() || !approve("Unstage Git path \"" + path +
      "\" in the native server index? Working-tree changes will be preserved."))
      return Promise.resolve(false);
    return perform("unstage", () => native.gitUnstage(path));
  }
  function commit() {
    if (!supported || pending || !messageInput) return Promise.resolve(false);
    const message = messageInput.value;
    if (!message || !message.trim() || !approve(
      "Commit ALL currently staged changes in the native server working tree? Review Staged diff first."))
      return Promise.resolve(false);
    return perform("commit", () => native.gitCommit(message));
  }
  function createBranch() {
    if (!supported || pending || !branchInput) return Promise.resolve(false);
    const name = branchInput.value;
    if (!name || !name.trim() || !approve(
      "Create local Git branch \"" + name + "\" at HEAD in the native server working tree?"))
      return Promise.resolve(false);
    return perform("branch creation", () => native.gitCreateBranch(name));
  }
  function switchBranch() {
    if (!supported || pending || !branchInput) return Promise.resolve(false);
    const name = branchInput.value;
    if (!name || !name.trim() || !approve(
      "Switch the native server working tree to Git branch \"" + name +
      "\"? All tracked and untracked changes must first be cleared."))
      return Promise.resolve(false);
    return perform("branch switch", () => native.gitSwitchBranch(name));
  }
  function deleteBranch() {
    if (!supported || pending || !branchInput) return Promise.resolve(false);
    const name = branchInput.value;
    if (!name || !name.trim() || !approve(
      "Delete local Git branch \"" + name +
      "\" from the native server repository? Git refuses the checked-out branch and unmerged commits; no force deletion is available."))
      return Promise.resolve(false);
    return perform("branch deletion", () => native.gitDeleteBranch(name));
  }
  statusButton.addEventListener("click", () => { void show("status"); });
  diffButton.addEventListener("click", () => { void show("diff"); });
  stagedDiffButton?.addEventListener("click", () => { void show("staged"); });
  stageButton?.addEventListener("click", () => { void stage(); });
  unstageButton?.addEventListener("click", () => { void unstage(); });
  commitButton?.addEventListener("click", () => { void commit(); });
  branchesButton?.addEventListener("click", () => { void show("branches"); });
  createBranchButton?.addEventListener("click", () => { void createBranch(); });
  switchBranchButton?.addEventListener("click", () => { void switchBranch(); });
  deleteBranchButton?.addEventListener("click", () => { void deleteBranch(); });
  return Object.freeze({show, stage, unstage, commit, createBranch, switchBranch, deleteBranch, supported});
}
const api = Object.freeze({create});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioGitPanel = api;
})(globalThis);
