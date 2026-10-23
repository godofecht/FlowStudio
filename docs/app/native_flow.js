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
async function run(code) {
  if (!available()) throw new Error("Flow execution requires the native FlowStudio server on port 8751.");
  if (typeof code !== "string" || new TextEncoder().encode(code).length > MAX_SOURCE_BYTES)
    throw new Error("Flow source exceeds the 64 KiB execution limit.");
  const controller = new AbortController();
  const timeout = global.setTimeout(() => controller.abort(), 70000);
  try {
    const response = await global.fetch("/api/run/flow", {
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
const api = Object.freeze({available, run});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNativeFlow = api;
})(globalThis);
