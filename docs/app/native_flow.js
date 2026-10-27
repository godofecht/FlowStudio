/* Native Flow execution is available only from FlowStudio's own loopback server.
 * GitHub Pages never sends source to a guessed localhost service.
 */
(function (global) {
"use strict";
const MAX_SOURCE_BYTES = 65536;
const MAX_OUTPUT_BYTES = 131072;
function available(location = global.location) {
  return !!location && location.protocol === "http:" &&
    (location.hostname === "127.0.0.1" || location.hostname === "localhost") &&
    location.port === "8751";
}
async function request(endpoint, code, timeoutMs = 70000) {
  if (!available()) throw new Error("Flow execution requires the native FlowStudio server on port 8751.");
  if (typeof code !== "string" || new TextEncoder().encode(code).length > MAX_SOURCE_BYTES)
    throw new Error("Flow source exceeds the 64 KiB execution limit.");
  const controller = new AbortController();
  const timeout = global.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await global.fetch(endpoint, {
      method: "POST",
      headers: {"Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run"},
      body: code,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
    const length = Number(response.headers?.get("content-length"));
    if (Number.isFinite(length) && length > MAX_OUTPUT_BYTES)
      throw new Error("Native Flow output exceeds 128 KiB.");
    const output = await response.text();
    if (new TextEncoder().encode(output).length > MAX_OUTPUT_BYTES)
      throw new Error("Native Flow output exceeds 128 KiB.");
    return {ok: response.ok, output, status: response.status};
  } finally {
    global.clearTimeout(timeout);
  }
}
async function run(code) {
  return request("/api/run/flow", code);
}
async function tracePython(code) {
  const response = await request("/api/trace/python", code);
  if (response.status !== 200 && response.status !== 422)
    return {ok:false, error:response.output, status:response.status};
  let data;
  try { data = JSON.parse(response.output); }
  catch (_) { throw new Error("Native Python trace response was not JSON."); }
  return {ok:response.ok, data, status:response.status};
}
async function debugRResponse(endpoint, body) {
  const response = await request(endpoint, body);
  if (response.status !== 200 && response.status !== 422)
    throw new Error(response.output);
  let data;
  try { data = JSON.parse(response.output); }
  catch (_) { throw new Error("Native R debugger returned invalid JSON."); }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      !["idle", "paused", "done", "error"].includes(data.state) ||
      !Number.isSafeInteger(data.index) || data.index < 1 || data.index > 1025 ||
      !Number.isSafeInteger(data.total) || data.total < 0 || data.total > 1024 ||
      ![data.next_line, data.executed_line].every(line =>
        line === null || (Number.isSafeInteger(line) && line > 0)) ||
      !(data.failed_line === undefined || data.failed_line === null ||
        (Number.isSafeInteger(data.failed_line) && data.failed_line > 0)) ||
      typeof data.output !== "string" || data.output.length > 20000 ||
      !(data.frames === undefined || (Array.isArray(data.frames) &&
        data.frames.length <= 8 && data.frames.every((frame, i) =>
          frame && typeof frame === "object" && !Array.isArray(frame) &&
          frame.id === i + 1 && typeof frame.call === "string" &&
          frame.call.length <= 180 && Array.isArray(frame.locals) &&
          frame.locals.length <= 16 && frame.locals.every(name =>
            typeof name === "string" && name.length <= 80)))))
    throw new Error("Invalid native R debugger response.");
  return {...data, ok:response.ok};
}
async function debugRStart(source) {
  if (typeof source !== "string" || !source.trim())
    throw new Error("Native R debugger requires nonempty R source.");
  return debugRResponse("/api/debug/r/start", source);
}
function validRTargets(value) {
  if (typeof value !== "string" || value.length > 4096) return false;
  if (!value) return true;
  const tokens = value.split(",");
  return tokens.length <= 64 && tokens.every(token =>
    /^[1-9][0-9]{0,5}(?:\?[A-Za-z][A-Za-z0-9._]*(?:==|!=|>=|<=|>|<)-?(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,12})?)?$/.test(token));
}
async function debugRCommand(action, targetLine = "", frameIndex = 0) {
  if (!["step", "continue", "evaluate", "stop", "status"].includes(action))
    throw new Error("Unknown native R debugger action.");
  if (action === "continue") {
    const lines = typeof targetLine === "number" ? String(targetLine) : targetLine;
    if (!validRTargets(lines))
      throw new Error("R continue target must be 1 to 64 comma-separated positive source lines with optional numeric conditions.");
    return debugRResponse("/api/debug/r/continue", lines);
  }
  if (action === "evaluate") {
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex > 8)
      throw new Error("Invalid retained R function frame index.");
    if (typeof targetLine !== "string" || !targetLine.trim())
      throw new Error("R debugger evaluation requires 1 to 4096 bytes of source.");
    const body = frameIndex ? "@" + frameIndex + "\n" + targetLine : targetLine;
    if (new TextEncoder().encode(body).length > 4096)
      throw new Error("R debugger evaluation requires 1 to 4096 bytes of source.");
    return debugRResponse("/api/debug/r/evaluate", body);
  }
  if (frameIndex !== 0 || targetLine !== "")
    throw new Error("Only R continue and evaluate accept source input; Only R evaluate accepts a function frame.");
  return debugRResponse("/api/debug/r/" + action, "");
}
async function debugPythonStart(source, breakpoints, pauseOnException = false) {
  if (typeof source !== "string" || !source.trim() ||
      !Array.isArray(breakpoints) || breakpoints.length > 64)
    throw new Error("Python debugger requires source and up to 64 valid breakpoint lines.");
  if (typeof pauseOnException !== "boolean")
    throw new Error("Pause on exception must be a boolean.");
  const lineCount = source.split(/\r\n|\r|\n/).length;
  const condition = /^[A-Za-z_][A-Za-z_0-9]*(?:==|!=|>=|<=|>|<)-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
  const lines = breakpoints.map(point => {
    if (Number.isSafeInteger(point)) return point;
    if (!point || typeof point !== "object" || Array.isArray(point) ||
        Object.keys(point).length !== 2 ||
        !Object.hasOwn(point, "line") || !Object.hasOwn(point, "condition") ||
        typeof point.condition !== "string" || point.condition.length > 80 ||
        !condition.test(point.condition))
      throw new Error("Invalid Python conditional breakpoint.");
    return point.line;
  });
  if (lines.some(line => !Number.isSafeInteger(line) || line < 1 || line > lineCount) ||
      new Set(lines).size !== lines.length)
    throw new Error("Python debugger requires distinct valid breakpoint lines.");
  const payload = pauseOnException ? {source, breakpoints, pause_on_exception:true} :
    {source, breakpoints};
  return debugPythonResponse("/api/debug/python/start", JSON.stringify(payload));
}
async function debugPythonCommand(action) {
  if (!["step", "next", "finish", "continue", "stop", "status"].includes(action))
    throw new Error("Unknown Python debugger action.");
  return debugPythonResponse("/api/debug/python/" + action, "");
}
async function debugPythonResponse(route, body) {
  const response = await request(route, body);
  if (response.status !== 200 && response.status !== 422)
    throw new Error(response.output);
  let data;
  try { data = JSON.parse(response.output); }
  catch (_) { throw new Error("Native Python debugger returned invalid JSON."); }
  return data;
}
async function checkRSyntax(code) {
  const response = await request("/api/check/r", code);
  if (response.ok) return {ok:true, output:response.output, diagnostics:[]};
  // Actual R parse() errors report <text>:LINE:COLUMN: message.
  // Transport failures have no source location and remain ordinary errors.
  const match = response.status === 422 ?
    /(?:<text>|[^\s:]+):(\d+):(\d+):\s*([^\r\n]*)/.exec(response.output) : null;
  const line = match ? Number(match[1]) : 0;
  const column = match ? Number(match[2]) : 0;
  const diagnostics = match && Number.isSafeInteger(line) && line > 0 &&
    Number.isSafeInteger(column) && column > 0 ?
    [{line, column, message:match[3].slice(0, 512)}] : [];
  return {ok:false, output:response.output, diagnostics};
}
async function checkSyntax(code) {
  const response = await request("/api/check/flow", code);
  if (response.ok) return {ok:true, output:response.output, diagnostics:[]};
  // Strict flowc diagnostics use FILE:LINE:COLUMN: severity: message.
  // Keep compiler output when it does not carry a source location.
  const match = /(?:^|\n)[^\r\n]*?:(\d+):(\d+):\s*(?:error:\s*)?([^\r\n]+)/.exec(response.output);
  const line = match ? Number(match[1]) : 0;
  const column = match ? Number(match[2]) : 0;
  const diagnostics = match && Number.isSafeInteger(line) && line > 0 &&
    Number.isSafeInteger(column) && column > 0 ?
    [{line, column, message:match[3].slice(0, 512)}] : [];
  return {ok:false, output:response.output, diagnostics};
}
async function gitStatus() {
  return request("/api/git/status", "");
}
async function gitDiff() {
  return request("/api/git/diff", "");
}
async function gitStagedDiff() {
  return request("/api/git/diff/staged", "");
}
function checkedGitPath(path) {
  if (typeof path !== "string" || !path.trim() || [".", "..", "/"].includes(path.trim()) ||
      new TextEncoder().encode(path).length > 512)
    throw new Error("Choose a specific Git path of at most 512 bytes.");
  return path;
}
async function gitStage(path) {
  return request("/api/git/stage", checkedGitPath(path));
}
async function gitUnstage(path) {
  return request("/api/git/unstage", checkedGitPath(path));
}
async function gitCommit(message) {
  if (typeof message !== "string" || !message.trim() ||
      new TextEncoder().encode(message).length > 512)
    throw new Error("Git commit message must contain 1 to 512 bytes.");
  return request("/api/git/commit", message);
}
async function gitBranches() {
  return request("/api/git/branches", "");
}
function checkedBranchName(name) {
  if (typeof name !== "string" || !name || new TextEncoder().encode(name).length > 128 ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) ||
      name.includes("..") || name.includes("//") || name.endsWith("/") ||
      name.endsWith(".") || name.split("/").some(part => !part || part.startsWith(".") || part.endsWith(".lock")))
    throw new Error("Git branch name must be a valid 1–128 byte local branch name.");
  return name;
}
async function gitCreateBranch(name) {
  return request("/api/git/branch/create", checkedBranchName(name));
}
async function gitSwitchBranch(name) {
  return request("/api/git/branch/switch", checkedBranchName(name));
}

// The native R adapter shares Flow-owned localhost transport but never shares
// interpreter state with webR. Its unsupported features fail explicitly.
function validateRInspection(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      !Array.isArray(payload.variables) || payload.variables.length > 128 ||
      typeof payload.truncated !== "boolean")
    throw new Error("Invalid native R environment response.");
  let nodes = 0;
  function convert(node, depth) {
    if (++nodes > 384 || !node || typeof node !== "object" || Array.isArray(node) ||
        typeof node.name !== "string" || !node.name || node.name.length > 160 ||
        typeof node.type !== "string" || !node.type || node.type.length > 100 ||
        [node.name, node.type].some(value => value.includes("\0")) ||
        (node.size !== null && (!Number.isSafeInteger(node.size) || node.size < 0)) ||
        (node.dimensions !== null && (!Array.isArray(node.dimensions) ||
          node.dimensions.length < 1 || node.dimensions.length > 8 ||
          node.dimensions.some(value => !Number.isSafeInteger(value) || value < 0))) ||
        (node.truncated !== undefined && typeof node.truncated !== "boolean"))
      throw new Error("Invalid native R environment entry.");
    const result = {name:node.name, type:node.type,
      shape:node.dimensions === null ? null : node.dimensions.map(String),
      preview:node.size === null ? "(not evaluated)" : "length " + node.size};
    if (node.truncated) result.truncated = true;
    if (node.children !== undefined) {
      if (node.type !== "list" || depth >= 2 || !Array.isArray(node.children) ||
          node.children.length > 12)
        throw new Error("Invalid native R environment nesting.");
      result.children = node.children.map(child => convert(child, depth + 1));
    }
    return result;
  }
  return {ok:true, variables:payload.variables.map(node => convert(node, 0)),
    truncated:payload.truncated};
}
function validateRTable(payload, requestedOffset = 0) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      !Array.isArray(payload.columns) || payload.columns.length < 1 ||
      payload.columns.length > 32 || !Array.isArray(payload.rows) ||
      payload.rows.length > 200 || !Number.isSafeInteger(payload.totalRows) ||
      payload.totalRows < payload.rows.length || typeof payload.truncated !== "boolean" ||
      !payload.columns.every(value => typeof value === "string" && value.length <= 160) ||
      !payload.rows.every(row => Array.isArray(row) &&
        row.length === payload.columns.length &&
        row.every(value => typeof value === "string" && value.length <= 160)))
    throw new Error("Invalid native R table response.");
  // Old preview responses without paging metadata are accepted at offset zero
  // only. Paged responses must identify the requested slice exactly.
  if (payload.offset === undefined) {
    if (requestedOffset !== 0 || payload.nextOffset !== undefined)
      throw new Error("Invalid native R table page metadata.");
  } else if (!Number.isSafeInteger(payload.offset) ||
             payload.offset !== requestedOffset || payload.offset < 0 ||
             payload.offset > payload.totalRows ||
             payload.rows.length > payload.totalRows - payload.offset ||
             !(payload.nextOffset === null ||
               (Number.isSafeInteger(payload.nextOffset) &&
                payload.rows.length > 0 &&
                payload.nextOffset === payload.offset + payload.rows.length &&
                payload.nextOffset < payload.totalRows))) {
    throw new Error("Invalid native R table page metadata.");
  }
  return payload;
}
function createRSession() {
  let epoch = 0;
  let serial = Promise.resolve();
  function schedule(work) {
    const next = serial.then(work);
    serial = next.catch(() => {});
    return next;
  }
  function stale() { return {ok:false, output:"Native R session reset; result discarded."}; }
  function run(code) {
    if (typeof code !== "string" || !code.trim() ||
        new TextEncoder().encode(code).length > MAX_SOURCE_BYTES)
      return Promise.resolve({ok:false, output:"R source is empty or exceeds 64 KiB."});
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return stale();
      const result = await request("/api/run/r", code);
      return generation === epoch ? result : stale();
    });
  }
  function inspect() {
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return stale();
      const result = await request("/api/inspect/r", "");
      if (generation !== epoch) return stale();
      if (!result.ok) return result;
      let payload;
      try { payload = JSON.parse(result.output); }
      catch (_) { throw new Error("Native R inspection was not JSON."); }
      return validateRInspection(payload);
    });
  }
  function table(name, offset = 0) {
    if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9._]{0,119}$/.test(name) ||
        name.includes("..") || name.endsWith(".") ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > 9999999999)
      return Promise.resolve({ok:false, output:"Invalid R variable name or row offset."});
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return stale();
      const response = await request("/api/table/r", name + (offset ? "\t" + offset : ""));
      if (generation !== epoch) return stale();
      if (!response.ok) return response;
      let payload;
      try { payload = JSON.parse(response.output); }
      catch (_) { throw new Error("Native R table response was not JSON."); }
      return {ok:true, table:validateRTable(payload, offset)};
    });
  }
  function plot() {
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return stale();
      const response = await request("/api/plot/r", "");
      if (generation !== epoch) return stale();
      if (!response.ok) return response;
      let payload;
      try { payload = JSON.parse(response.output); }
      catch (_) { throw new Error("Native R plot response was not JSON."); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          (payload.svg !== null && (typeof payload.svg !== "string" ||
            new TextEncoder().encode(payload.svg).length > 60000 ||
            !/<svg[\s>]/.test(payload.svg) || !payload.svg.includes("</svg>"))) ||
          (payload.pdf !== null && (typeof payload.pdf !== "string" ||
            payload.pdf.length > 120000 || payload.pdf.length < 8 ||
            payload.pdf.length % 2 !== 0 || !payload.pdf.startsWith("25504446") ||
            !/^[0-9a-f]+$/.test(payload.pdf))) ||
          (payload.svg !== null && payload.pdf !== null) ||
          (payload.warning !== null && (typeof payload.warning !== "string" ||
            payload.warning.length > 200)))
        throw new Error("Invalid native R SVG plot response.");
      return {ok:true, svg:payload.svg, pdf:payload.pdf, warning:payload.warning};
    });
  }
  function packages() {
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return stale();
      const response = await request("/api/packages/r", "");
      if (generation !== epoch) return stale();
      if (!response.ok) return response;
      let payload;
      try { payload = JSON.parse(response.output); }
      catch (_) { throw new Error("Native R package inventory was not JSON."); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          !Array.isArray(payload.packages) || payload.packages.length > 1000 ||
          typeof payload.truncated !== "boolean" ||
          payload.packages.some(item => !item || typeof item !== "object" ||
            Array.isArray(item) || typeof item.name !== "string" ||
            !/^[A-Za-z][A-Za-z0-9.]{0,99}$/.test(item.name) ||
            typeof item.version !== "string" || item.version.length > 100 ||
            item.version.includes("\0")))
        throw new Error("Invalid native R package inventory response.");
      return {ok:true, packages:payload.packages, truncated:payload.truncated};
    });
  }
  function loadPackage(name) {
    if (typeof name !== "string" ||
        !/^[A-Za-z][A-Za-z0-9.]{0,79}$/.test(name) ||
        name.includes("..") || name.endsWith("."))
      return Promise.resolve({ok:false, output:"Invalid installed R package name."});
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return stale();
      const result = await request("/api/packages/r/load", name);
      return generation === epoch ? result : stale();
    });
  }
  function installPackage(name) {
    if (typeof name !== "string" ||
        !/^[A-Za-z][A-Za-z0-9.]{0,79}$/.test(name) ||
        name.includes("..") || name.endsWith("."))
      return Promise.resolve({ok:false, output:"Invalid R package name."});
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return stale();
      const result = await request("/api/packages/r/install", name, 190000);
      return generation === epoch ? result : stale();
    });
  }
  function updatePackage(name) {
    if (typeof name !== "string" ||
        !/^[A-Za-z][A-Za-z0-9.]{0,79}$/.test(name) ||
        name.includes("..") || name.endsWith("."))
      return Promise.resolve({ok:false, output:"Invalid R package name."});
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return stale();
      const result = await request("/api/packages/r/update", name, 190000);
      return generation === epoch ? result : stale();
    });
  }
  function removePackage(name) {
    if (typeof name !== "string" ||
        !/^[A-Za-z][A-Za-z0-9.]{0,79}$/.test(name) ||
        name.includes("..") || name.endsWith("."))
      return Promise.resolve({ok:false, output:"Invalid R package name."});
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return stale();
      const result = await request("/api/packages/r/remove", name);
      return generation === epoch ? result : stale();
    });
  }
  function checkSyntax(code) {
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return stale();
      const result = await checkRSyntax(code);
      return generation === epoch ? result : stale();
    });
  }
  function reset() {
    const generation = ++epoch;
    return schedule(async () => {
      const result = await request("/api/reset/r", "");
      return generation === epoch ? result : stale();
    });
  }
  const unsupported = () => Promise.resolve({ok:false,
    output:"This operation is not available for native R yet. Select browser webR for help, completion or variable transfer; the two R workspaces are separate."});
  return Object.freeze({run, inspect, checkSyntax, reset,
    table, plot, packages, loadPackage, installPackage, updatePackage, removePackage,
    help:unsupported, complete:unsupported,
    exportVariable:unsupported, importVariable:unsupported});
}

const api = Object.freeze({available, run, createRSession, checkSyntax, checkRSyntax, tracePython, debugRStart, debugRCommand, debugPythonStart, debugPythonCommand, gitStatus, gitDiff, gitStagedDiff, gitStage, gitUnstage, gitCommit, gitBranches, gitCreateBranch, gitSwitchBranch});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNativeFlow = api;
})(globalThis);
