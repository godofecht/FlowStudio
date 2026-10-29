/* Interactive native CPython debugger: breakpoint/step controls and safe stack display.
 * No browser-only emulation; commands go to the Flow-owned localhost backend.
 */
(function (global) {
"use strict";
const STATES = new Set(["idle", "running", "paused", "done", "stopped"]);
function validate(data) {
  if (!data || typeof data !== "object" || !STATES.has(data.state) ||
      typeof data.ok !== "boolean" || !Array.isArray(data.stack) ||
      data.stack.length > 16 || typeof data.output !== "string" ||
      data.output.length > 131072 || typeof data.message !== "string" ||
      data.message.length > 1024) throw Error("Invalid native debugger response.");
  if (data.exception !== undefined && data.exception !== null &&
      (!data.exception || typeof data.exception !== "object" ||
       Array.isArray(data.exception) ||
       Object.keys(data.exception).sort().join(",") !== "line,type" ||
       typeof data.exception.type !== "string" ||
       data.exception.type.length > 80 ||
       !Number.isSafeInteger(data.exception.line) || data.exception.line < 1))
    throw Error("Invalid native debugger exception metadata.");
  for (const frame of data.stack) {
    if (!frame || !Number.isSafeInteger(frame.line) || frame.line < 1 ||
        typeof frame.function !== "string" || frame.function.length > 80 ||
        !frame.locals || typeof frame.locals !== "object" ||
        Array.isArray(frame.locals) || Object.keys(frame.locals).length > 16)
      throw Error("Invalid native debugger stack frame.");
    for (const value of Object.values(frame.locals)) {
      if (!value || typeof value.type !== "string" || value.type.length > 80 ||
          (value.value !== undefined && (typeof value.value !== "string" || value.value.length > 120)))
        throw Error("Invalid native debugger local.");
    }
  }
  return data;
}
function parseBreakpoints(input, lineCount) {
  if (typeof input !== "string" || input.length > 512) throw Error("Invalid breakpoint input.");
  if (!input.trim()) return [];
  const tokens = input.split(/[\s,]+/).filter(Boolean);
  if (tokens.length > 64) throw Error("At most 64 breakpoints are supported.");
  const points = tokens.map(token => {
    // Syntax: line or line?numericLocalComparison, e.g. 4?counter>=3.
    // No expression evaluation in the browser or native interpreter.
    const match = /^([1-9][0-9]*)(?:\?([A-Za-z_][A-Za-z_0-9]*(?:==|!=|>=|<=|>|<)-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?))?$/.exec(token);
    if (!match) throw Error("Use line or line?name>=number (no spaces).");
    const line = Number(match[1]);
    if (!Number.isSafeInteger(line) || line > lineCount) throw Error("Breakpoint is outside source.");
    return match[2] ? {line, condition:match[2]} : line;
  });
  const lines = points.map(point => typeof point === "number" ? point : point.line);
  if (new Set(lines).size !== lines.length) throw Error("Duplicate breakpoint line.");
  return points;
}
function caretLine(source) {
  if (!source || typeof source.value !== "string" ||
      !Number.isSafeInteger(source.selectionStart) ||
      source.selectionStart < 0 || source.selectionStart > source.value.length)
    return null;
  return source.value.slice(0, source.selectionStart).split(/\r\n|\r|\n/).length;
}
function format(data) {
  validate(data);
  const lines = ["Python debugger: " + data.state + (data.ok ? "" : " (error)")];
  if (data.message) lines.push(data.message);
  if (data.exception) lines.push("Exception: " + data.exception.type +
    " at line " + data.exception.line + " (raised; may be caught)");
  for (const frame of data.stack) {
    lines.push("Line " + frame.line + " in " + frame.function);
    for (const [name, value] of Object.entries(frame.locals))
      lines.push("  " + name + ": " + value.type + (value.value === undefined ? "" : " = " + value.value));
  }
  if (data.output) lines.push("Output:\n" + data.output);
  return lines.join("\n");
}
function create({native, source, language, breakpoints, pauseOnException, startButton, stepButton,
                 nextButton, finishButton, continueButton, stopButton, statusButton, target, notice,
                 runToCursorButton = null,
                 frameHost = null, getDocId = () => null, onFrame = () => {}}) {
  if (!native || !source || !language || !breakpoints || !startButton ||
      !stepButton || !nextButton || !finishButton || !continueButton || !stopButton || !statusButton || !target)
    throw Error("Native Python debugger requires its controls.");
  const supported = !!native.available();
  let state = "idle", pending = false;
  let sourceSnapshot = null, documentSnapshot = null;
  let sourceRevision = 0, revisionSnapshot = null;
  let currentResult = null, selectedFrame = -1;

  // The native kernel retains the source passed to start(), not subsequent
  // editor edits. Never navigate a different document or a changed buffer.
  function executionIsCurrent() {
    // A changed-then-restored buffer is not the same editor revision.
    // A null document ID is permitted for standalone debugger clients, but
    // the workspace supplies real IDs for navigation and isolation.
    return sourceSnapshot !== null && revisionSnapshot === sourceRevision &&
      getDocId() === documentSnapshot && source.value === sourceSnapshot &&
      language.value === "python";
  }
  function sourceIsCurrent() {
    return documentSnapshot !== null && executionIsCurrent();
  }
  function selectFrame(index, automatic = false) {
    if (!automatic && pending) return false;
    if (state !== "paused" || !currentResult ||
        !Number.isSafeInteger(index) || index < 0 ||
        index >= currentResult.stack.length) return false;
    if (!sourceIsCurrent()) {
      if (notice) notice("Editor changed since debugger start; frame navigation disabled.");
      update();
      return false;
    }
    selectedFrame = index;
    if (frameHost) {
      for (let i = 0; i < frameHost.children.length; i++)
        frameHost.children[i].setAttribute("aria-current", i === index ? "true" : "false");
    }
    onFrame(currentResult.stack[index], index);
    return true;
  }
  function renderFrames(result) {
    selectedFrame = result.state === "paused" && result.stack.length ? 0 : -1;
    if (!frameHost) return;
    frameHost.replaceChildren();
    if (selectedFrame < 0) return;
    const doc = frameHost.ownerDocument || global.document;
    for (let index = 0; index < result.stack.length; index++) {
      const frame = result.stack[index];
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "live-debug-frame";
      button.textContent = "Frame " + (index + 1) + ": " + frame.function + " · line " + frame.line;
      button.setAttribute("aria-current", index === selectedFrame ? "true" : "false");
      button.addEventListener("click", () => { selectFrame(index); });
      frameHost.append(button);
    }
  }
  function update() {
    startButton.disabled = !supported || pending || state === "paused" || state === "running";
    stepButton.disabled = !supported || pending || state !== "paused" || !executionIsCurrent();
    nextButton.disabled = !supported || pending || state !== "paused" || !executionIsCurrent();
    finishButton.disabled = !supported || pending || state !== "paused" || !executionIsCurrent();
    continueButton.disabled = !supported || pending || state !== "paused" || !executionIsCurrent();
    if (runToCursorButton) runToCursorButton.disabled = !supported || pending ||
      state !== "paused" || !executionIsCurrent() || caretLine(source) === null;
    stopButton.disabled = !supported || pending || (state !== "paused" && state !== "running");
    statusButton.disabled = !supported || pending;
    if (frameHost) {
      for (const button of frameHost.children)
        button.disabled = !supported || pending || state !== "paused" || !sourceIsCurrent();
    }
  }
  async function execute(action) {
    if (!supported || pending) return false;
    if (action === "start" && (state === "paused" || state === "running")) return false;
    if (["step", "next", "finish", "continue", "run-to-cursor"].includes(action)) {
      if (state !== "paused") return false;
      if (!executionIsCurrent()) {
        if (notice) notice("Editor changed since debugger start; stop the old session before continuing.");
        update();
        return false;
      }
    }
    if (action === "stop" && state !== "paused" && state !== "running") return false;
    pending = true;
    update();
    try {
      let result;
      if (action === "start") {
        if (language.value !== "python") throw Error("Select Python to debug native source.");
        sourceSnapshot = source.value;
        documentSnapshot = getDocId();
        revisionSnapshot = sourceRevision;
        const lines = sourceSnapshot.split(/\r\n|\r|\n/).length;
        result = await native.debugPythonStart(sourceSnapshot, parseBreakpoints(breakpoints.value, lines),
          !!(pauseOnException && pauseOnException.checked));
      } else if (action === "run-to-cursor") {
        const line = caretLine(source);
        if (line === null) throw Error("Place the editor caret on a valid source line.");
        result = await native.debugPythonRunToLine(line);
      } else result = await native.debugPythonCommand(action);
      validate(result);
      state = result.state;
      currentResult = result;
      target.textContent = format(result);
      renderFrames(result);
      if (state === "paused" && result.stack.length && sourceIsCurrent())
        selectFrame(0, true);
      if (notice) notice("Native Python debugger: " + state +
        (frameHost && state === "paused" && !sourceIsCurrent() ?
          " (editor changed; navigation disabled)." : "") + ".");
      return result.ok;
    } catch (error) {
      currentResult = null;
      selectedFrame = -1;
      if (frameHost) frameHost.replaceChildren();
      target.textContent = "Native Python debugger error: " + String(error.message || error);
      if (notice) notice(target.textContent);
      return false;
    } finally {
      pending = false;
      update();
    }
  }
  // Input events also invalidate an edit-then-undo of the same source text.
  // Stop and status remain available to recover the old paused kernel.
  source.addEventListener?.("input", () => { sourceRevision++; update(); });
  language.addEventListener?.("change", update);
  if (runToCursorButton) {
    runToCursorButton.addEventListener("click", () => { void execute("run-to-cursor"); });
    for (const event of ["click", "keyup", "select"]) source.addEventListener?.(event, update);
  }
  startButton.addEventListener("click", () => { void execute("start"); });
  stepButton.addEventListener("click", () => { void execute("step"); });
  nextButton.addEventListener("click", () => { void execute("next"); });
  finishButton.addEventListener("click", () => { void execute("finish"); });
  continueButton.addEventListener("click", () => { void execute("continue"); });
  stopButton.addEventListener("click", () => { void execute("stop"); });
  statusButton.addEventListener("click", () => { void execute("status"); });
  if (!supported) target.textContent = "Native Python debugger requires the FlowStudio localhost server.";
  update();
  return Object.freeze({execute, supported, selectFrame, update});
}
const api = Object.freeze({validate, parseBreakpoints, caretLine, format, create});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioPythonDebugPanel = api;
})(globalThis);
