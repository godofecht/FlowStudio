/* Read-only Git inspection of the native FlowStudio server working tree.
 * The browser never supplies a repository path or shell command.
 */
(function (global) {
"use strict";
function create({native, statusButton, diffButton, target, notice}) {
  if (!native || !statusButton || !diffButton || !target)
    throw new Error("Git panel requires its native client and controls.");
  const supported = !!native.available();
  let pending = false;
  if (!supported) {
    statusButton.disabled = true;
    diffButton.disabled = true;
    target.textContent = "Git inspection requires the local FlowStudio server. GitHub Pages cannot access your working tree.";
  }
  async function show(kind) {
    if (!supported || pending) return false;
    pending = true;
    statusButton.disabled = true;
    diffButton.disabled = true;
    target.textContent = "Reading native Git " + kind + "…";
    try {
      const response = kind === "status" ? await native.gitStatus() : await native.gitDiff();
      if (!response || typeof response.ok !== "boolean" || typeof response.output !== "string")
        throw new Error("Invalid native Git response.");
      if (response.ok) {
        target.textContent = response.output || (kind === "diff" ? "No unstaged changes." : "Clean working tree.");
        notice?.("Native Git " + kind + " refreshed for the server working tree.");
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
      statusButton.disabled = false;
      diffButton.disabled = false;
    }
  }
  statusButton.addEventListener("click", () => { void show("status"); });
  diffButton.addEventListener("click", () => { void show("diff"); });
  return Object.freeze({show, supported});
}
const api = Object.freeze({create});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioGitPanel = api;
})(globalThis);
