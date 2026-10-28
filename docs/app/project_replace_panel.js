/* Explicit, bounded, browser-local project replacement UI. */
(function (global) {
"use strict";
function create({project, isOpenHandle, query, replacement, caseSensitive, regex, wholeWord,
                 previewButton, applyButton, undoButton, output, notice, confirmChange}) {
  if (!project || typeof project.previewReplace !== "function" ||
      typeof project.applyReplace !== "function" ||
      typeof project.undoReplace !== "function" ||
      typeof project.hasUndoReplace !== "function" ||
      typeof isOpenHandle !== "function" || !undoButton)
    throw new TypeError("Project replacement requires a writable project controller.");
  let plan = null, revision = 0, working = false, controller = null;
  const controls = [query, replacement, caseSensitive, regex, wholeWord];
  function options() {
    return {caseSensitive: !!caseSensitive.checked, regex: !!regex.checked,
      wholeWord: !!wholeWord.checked};
  }
  function invalidate() {
    revision++;
    if (controller) controller.abort();
    plan = null;
    applyButton.disabled = true;
    if (!working) output.textContent = "Preview replacements before applying.";
  }
  function excerpt(before, after) {
    let index = 0;
    while (index < before.length && index < after.length && before[index] === after[index])
      index++;
    const start = Math.max(0, index - 32);
    return JSON.stringify(before.slice(start, index + 70)) + " → " +
      JSON.stringify(after.slice(start, index + 70));
  }
  function display(preview) {
    const lines = [preview.matches + " matches; " + preview.files.length +
      " changed files. Preview only; nothing has been written."];
    for (const entry of preview.files) {
      lines.push(entry.path + " (" + entry.count + " matches)");
      lines.push("  " + excerpt(entry.before, entry.after));
    }
    if (!preview.files.length) lines.push("No on-disk changes to apply.");
    output.textContent = lines.join("\n");
  }
  async function preview() {
    if (working) return false;
    invalidate();
    const token = revision;
    controller = new AbortController();
    working = true;
    previewButton.disabled = true;
    undoButton.disabled = true;
    try {
      const candidate = await project.previewReplace(query.value, replacement.value,
        {...options(), signal: controller.signal});
      if (token !== revision) return false;
      plan = candidate;
      display(candidate);
      applyButton.disabled = candidate.files.length === 0;
      return true;
    } catch (error) {
      if (token === revision && error.name !== "AbortError") {
        output.textContent = "Preview failed: " + (error.message || String(error));
        notice(output.textContent);
      }
      return false;
    } finally {
      working = false;
      controller = null;
      previewButton.disabled = false;
      undoButton.disabled = !project.hasUndoReplace();
    }
  }
  async function apply() {
    if (working || !plan || !plan.files.length) return false;
    const candidate = plan, token = revision;
    const message = "Replace " + candidate.matches + " matches in " +
      candidate.files.length + " project files? Writes are not atomic; earlier files " +
      "may remain changed if a later write or recovery fails.";
    if (!confirmChange(message)) return false;
    if (token !== revision || candidate !== plan) return false;
    working = true;
    controller = new AbortController();
    previewButton.disabled = true;
    applyButton.disabled = true;
    undoButton.disabled = true;
    try {
      const result = await project.applyReplace(candidate, {
        signal: controller.signal,
        isBlocked: entry => isOpenHandle(entry.handle)
      });
      if (token === revision) {
        plan = null;
        output.textContent = "Replaced " + result.matches + " matches in " +
          result.files + " project files. One-level undo is available.";
        notice(output.textContent);
      }
      return true;
    } catch (error) {
      plan = null;
      const message = "Replacement failed: " + (error.message || String(error)) +
        " Review the recovery report and project files before retrying.";
      output.textContent = message;
      notice(message);
      return false;
    } finally {
      working = false;
      controller = null;
      previewButton.disabled = false;
      undoButton.disabled = !project.hasUndoReplace();
    }
  }
  async function undo() {
    if (working || !project.hasUndoReplace()) {
      undoButton.disabled = true;
      return false;
    }
    if (!confirmChange("Undo the last project-wide replacement? Files must be unchanged; multi-file writes are not atomic."))
      return false;
    working = true;
    controller = new AbortController();
    previewButton.disabled = true;
    applyButton.disabled = true;
    undoButton.disabled = true;
    plan = null;
    try {
      const result = await project.undoReplace({
        signal: controller.signal, isBlocked: entry => isOpenHandle(entry.handle)
      });
      output.textContent = "Restored " + result.files + " project files (" +
        result.matches + " replacements undone).";
      notice(output.textContent);
      return true;
    } catch (error) {
      output.textContent = "Project undo failed: " + (error.message || String(error)) +
        ". Review files before further changes.";
      notice(output.textContent);
      return false;
    } finally {
      working = false;
      controller = null;
      previewButton.disabled = false;
      undoButton.disabled = !project.hasUndoReplace();
    }
  }
  for (const control of controls) {
    control.addEventListener("input", invalidate);
    control.addEventListener("change", invalidate);
  }
  previewButton.addEventListener("click", () => { void preview(); });
  applyButton.addEventListener("click", () => { void apply(); });
  undoButton.addEventListener("click", () => { void undo(); });
  applyButton.disabled = true;
  undoButton.disabled = true;
  return {preview, apply, undo, invalidate};
}
const api = Object.freeze({create});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioProjectReplacePanel = api;
})(globalThis);
