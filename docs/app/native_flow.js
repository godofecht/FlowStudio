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
async function request(endpoint, code) {
  if (!available()) throw new Error("Flow execution requires the native FlowStudio server on port 8751.");
  if (typeof code !== "string" || new TextEncoder().encode(code).length > MAX_SOURCE_BYTES)
    throw new Error("Flow source exceeds the 64 KiB execution limit.");
  const controller = new AbortController();
  const timeout = global.setTimeout(() => controller.abort(), 70000);
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
const api = Object.freeze({available, run, checkSyntax, tracePython, gitStatus, gitDiff});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNativeFlow = api;
})(globalThis);
