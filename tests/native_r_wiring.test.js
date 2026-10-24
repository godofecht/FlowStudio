"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

test("Flow owns the native R execution and reset HTTP routes", () => {
  const flow = read("src/main.flow");
  assert.match(flow, /function fs_r_run\(code: string\) -> string/);
  assert.match(flow, /function fs_r_reset\(\) -> void/);
  assert.match(flow, /if eq\(path, "\/api\/run\/r"\) \{\s*send_r\(fs_body\(\)\)/);
  assert.match(flow, /if eq\(path, "\/api\/reset\/r"\) \{\s*fs_r_reset\(\)/);
  assert.match(flow, /if eq\(method, "POST"\) and fs_intent_allowed\(\) == 1/);
});
test("R kernel and transport use bounded IPC and are included in native builds", () => {
  const transport = read("src/r_session.c");
  const kernel = read("src/r_kernel.R");
  assert.match(transport, /execlp\("Rscript", "Rscript", "--vanilla", "src\/r_kernel\.R"/);
  assert.match(transport, /FS_R_DEADLINE_MS 15000/);
  assert.match(transport, /FS_R_MAX 131072/);
  assert.match(kernel, /workspace <- new\.env/);
  assert.match(kernel, /sys\.source\("src\/flowjit\.R", envir = flowjit_api\)/);
  assert.match(read("scripts/package.sh"), /src\/flowjit\.R/);
  assert.match(kernel, /withVisible\(eval\(expression, envir = workspace\)\)/);
  assert.match(kernel, /MAX_OUTPUT <- 131072L/);
  assert.match(read("scripts/build.sh"), /src\/r_session\.c/);
  assert.match(read("scripts/package.sh"), /src\/r_kernel\.R/);
});
test("native editor exposes explicit R reset without conflating Python state", () => {
  const html = read("web/index.html");
  assert.match(html, /id="resetR"/);
  assert.match(html, /el\("resetR"\)\.addEventListener\("click"/);
  assert.match(html, /fetch\("\/api\/reset\/r"/);
  assert.match(html, /"X-FlowStudio-Intent": "run"/);
});
