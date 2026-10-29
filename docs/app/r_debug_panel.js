/* Native R cooperative top-level expression stepping; no simulated evaluator. */
(function (global) {
"use strict";
const STATES = new Set(["idle", "paused", "done", "error"]);
function format(result) {
  if (!result || !STATES.has(result.state) || typeof result.ok !== "boolean" ||
      typeof result.output !== "string" || result.output.length > 20000 ||
      !Number.isSafeInteger(result.index) || !Number.isSafeInteger(result.total))
    throw Error("Invalid native R debugger state.");
  const lines = ["R expression debugger: " + result.state +
    (result.ok ? "" : " (error)")];
  if (result.executed_line !== null) lines.push("Executed expression at line " + result.executed_line);
  if (result.next_line !== null) lines.push("Next expression at line " + result.next_line);
  if (Number.isSafeInteger(result.failed_line) && result.failed_line > 0)
    lines.push("Failed expression at line " + result.failed_line + " (top-level workspace only)");
  lines.push("Expression " + Math.min(result.index, result.total) + " of " + result.total);
  if (Array.isArray(result.frames)) for (const frame of result.frames)
    lines.push("Postmortem frame " + frame.id + ": " + frame.call +
      (Number.isSafeInteger(frame.definition_line) ?
        " (function defined at line " + frame.definition_line + ")" : "") +
      " (locals: " + (frame.locals.join(", ") || "none") + ")");
  if (result.output) lines.push("Output:\n" + result.output);
  return lines.join("\n");
}
function validRTargets(value) {
  if (typeof value !== "string" || value.length > 4096) return false;
  if (!value) return true;
  const tokens = value.split(",");
  return tokens.length <= 64 && tokens.every(token =>
    /^[1-9][0-9]{0,5}(?:\?[A-Za-z][A-Za-z0-9._]*(?:==|!=|>=|<=|>|<)-?(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,12})?)?$/.test(token));
}
// Navigate only to a line that actually exists in the exact source snapshot.
function revealSourceLine(source, line) {
  if (!source || typeof source.value !== "string" ||
      typeof source.setSelectionRange !== "function" ||
      !Number.isSafeInteger(line) || line < 1) return false;
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const newline = source.value.indexOf("\n", offset);
    if (newline < 0) return false;
    offset = newline + 1;
  }
  source.setSelectionRange(offset, offset);
  if (typeof source.focus === "function") source.focus();
  return true;
}
// A cursor target is a 1-based source line, not an expression index. The R
// kernel checks whether a later top-level expression actually starts there.
function caretLine(source) {
  if (!source || typeof source.value !== "string" ||
      !Number.isSafeInteger(source.selectionStart) ||
      source.selectionStart < 0 || source.selectionStart > source.value.length)
    return null;
  let line = 1;
  for (let i = 0; i < source.selectionStart; i++)
    if (source.value[i] === "\n") line++;
  return line;
}
function create({native, source, language, runtime, startButton, stepButton,
                 continueButton, runToCursorButton, targetLine, watchExpression, frameInput, frameList, evaluateButton,
                 stopButton, statusButton, target, notice, documentIdentity, revealLine}) {
  if (!native || !source || !language || !runtime || !startButton || !stepButton ||
      !continueButton || !targetLine || !watchExpression || !evaluateButton ||
      !stopButton || !statusButton || !target)
    throw Error("Missing R debugger controls.");
  const supported = native.available();
  let state = "idle", pending = false, frameCount = 0, frames = [], nextLine = null;
  let sourceRevision = 0, runSnapshot = null;
  const identity = typeof documentIdentity === "function" ? documentIdentity : () => null;
  // A paused R expression belongs to the original document revision.
  // Postmortem inspection is safe to display, but continuing stale execution
  // would execute code that no longer matches the visible editor.
  function snapshotCurrent() {
    return runSnapshot !== null &&
      source.value === runSnapshot.source &&
      sourceRevision === runSnapshot.revision &&
      identity() === runSnapshot.identity &&
      language.value === "r" && runtime.value === "native";
  }
  source.addEventListener("input", () => { sourceRevision++; update(); });
  if (runToCursorButton) {
    source.addEventListener("click", update);
    source.addEventListener("keyup", update);
    source.addEventListener("select", update);
  }
  function navigate(result, action) {
    if (action === "evaluate" || !snapshotCurrent()) return false;
    const line = result.state === "paused" ? result.next_line :
      result.state === "error" ? result.failed_line : null;
    if (!Number.isSafeInteger(line) || line < 1) return false;
    return typeof revealLine === "function" ? revealLine(line) :
      revealSourceLine(source, line);
  }
  // The real R kernel has already unwound on error. Selecting a retained
  // function frame changes the environment used by Evaluate; it never resumes
  // execution or claims to reveal the failing instruction inside the function.
  function renderFrames() {
    if (!frameList || typeof frameList.replaceChildren !== "function") return;
    const owner = frameList.ownerDocument || global.document;
    if (!owner || typeof owner.createElement !== "function") return;
    const selectable = !pending && state === "error" && snapshotCurrent();
    const selected = frameInput ? Number(frameInput.value) : 0;
    const buttons = frames.map(frame => {
      const button = owner.createElement("button");
      button.type = "button";
      button.textContent = "Frame " + frame.id + ": " + frame.call +
        (Number.isSafeInteger(frame.definition_line) ?
          " — definition line " + frame.definition_line : "");
      button.title = "Select retained postmortem environment for R Evaluate";
      button.disabled = !selectable;
      button.setAttribute("aria-pressed", String(selected === frame.id));
      button.addEventListener("click", () => {
        if (pending || state !== "error" || !snapshotCurrent()) return;
        if (frameInput) frameInput.value = String(frame.id);
        if (Number.isSafeInteger(frame.definition_line)) {
          if (typeof revealLine === "function") revealLine(frame.definition_line);
          else revealSourceLine(source, frame.definition_line);
        }
        renderFrames();
      });
      return button;
    });
    frameList.replaceChildren(...buttons);
  }
  function update() {
    const enabled = supported && language.value === "r" && runtime.value === "native";
    const current = snapshotCurrent();
    startButton.disabled = !enabled || pending || state === "paused";
    stepButton.disabled = !enabled || pending || state !== "paused" || !current;
    continueButton.disabled = !enabled || pending || state !== "paused" || !current;
    if (runToCursorButton) {
      const cursor = caretLine(source);
      runToCursorButton.disabled = !enabled || pending || state !== "paused" ||
        !current || cursor === null ||
        (Number.isSafeInteger(nextLine) && cursor <= nextLine);
    }
    targetLine.disabled = !enabled || pending || state !== "paused" || !current;
    watchExpression.disabled = !enabled || pending || (state !== "paused" && state !== "error") || !current;
    if (frameInput) frameInput.disabled = !enabled || pending || state !== "error" || !frameCount || !current;
    evaluateButton.disabled = !enabled || pending || (state !== "paused" && state !== "error") || !current;
    stopButton.disabled = !enabled || pending || state === "idle";
    statusButton.disabled = !enabled || pending;
    renderFrames();
  }
  async function execute(action) {
    if (pending || !supported || language.value !== "r" || runtime.value !== "native")
      return false;
    if ((action === "step" || action === "continue" || action === "run-to-cursor") &&
        state !== "paused") return false;
    if (action === "evaluate" && state !== "paused" && state !== "error") return false;
    if (["step", "continue", "run-to-cursor", "evaluate"].includes(action) && !snapshotCurrent()) {
      target.textContent = "Native R debugger: source changed; Stop or Status is available. Restart debugging to execute the current source.";
      if (notice) notice(target.textContent);
      update();
      return false;
    }
    const cursor = action === "run-to-cursor" ? caretLine(source) : null;
    if (action === "run-to-cursor" &&
        (cursor === null || (Number.isSafeInteger(nextLine) && cursor <= nextLine))) {
      target.textContent = "Select a source line after the next paused top-level expression.";
      update();
      return false;
    }
    const started = action === "start" ? {
      source:source.value, revision:sourceRevision, identity:identity()
    } : null;
    pending = true;
    update();
    try {
      const line = action === "run-to-cursor" ? String(cursor) :
        action === "continue" ? targetLine.value.trim() :
        action === "evaluate" ? watchExpression.value : "";
      if ((action === "continue" || action === "run-to-cursor") && !validRTargets(line))
        throw Error("R continue targets must be 1 to 64 comma-separated positive source lines with optional numeric conditions.");
      const selectedFrame = action === "evaluate" && frameInput ?
        Number(frameInput.value) : 0;
      if (action === "evaluate" && (!Number.isSafeInteger(selectedFrame) ||
          selectedFrame < 0 || selectedFrame > frameCount ||
          (selectedFrame !== 0 && state !== "error")))
        throw Error("Select an available postmortem function frame, or 0 for the workspace.");
      if (action === "evaluate" && (!line.trim() ||
          new TextEncoder().encode((selectedFrame ? "@" + selectedFrame + "\n" : "") + line).length > 4096))
        throw Error("R debugger evaluation requires 1 to 4096 bytes of source.");
      const result = action === "start" ?
        await native.debugRStart(source.value) :
        await native.debugRCommand(action === "run-to-cursor" ? "continue" : action, line, selectedFrame);
      state = result.state;
      nextLine = state === "paused" ? result.next_line : null;
      if (started) runSnapshot = started;
      if (state === "idle" || state === "done") runSnapshot = null;
      frames = state === "error" && Array.isArray(result.frames) ? result.frames : [];
      frameCount = frames.length;
      if (frameInput && (!Number.isSafeInteger(Number(frameInput.value)) ||
          Number(frameInput.value) > frameCount || state !== "error"))
        frameInput.value = "0";
      target.textContent = format(result);
      // A delayed response may describe a different file or edited buffer.
      // Keep its diagnostic text, but never move the editor to that source.
      navigate(result, action);
      if (notice) notice("Native R expression debugger: " + state + ".");
      return result.ok;
    } catch (error) {
      target.textContent = "Native R debugger error: " + String(error.message || error);
      if (notice) notice(target.textContent);
      return false;
    } finally {
      pending = false;
      update();
    }
  }
  startButton.addEventListener("click", () => { void execute("start"); });
  stepButton.addEventListener("click", () => { void execute("step"); });
  continueButton.addEventListener("click", () => { void execute("continue"); });
  if (runToCursorButton)
    runToCursorButton.addEventListener("click", () => { void execute("run-to-cursor"); });
  evaluateButton.addEventListener("click", () => { void execute("evaluate"); });
  stopButton.addEventListener("click", () => { void execute("stop"); });
  statusButton.addEventListener("click", () => { void execute("status"); });
  if (frameInput) frameInput.addEventListener("change", update);
  language.addEventListener("change", update);
  runtime.addEventListener("change", update);
  if (!supported) target.textContent = "Native R debugger requires FlowStudio on localhost:8751.";
  update();
  return Object.freeze({execute, update});
}
const api = Object.freeze({format, create, revealSourceLine, caretLine});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioRDebugPanel = api;
})(globalThis);
