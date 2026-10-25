"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

test("Flow owns intent-gated R inspection and sends JSON only for successful IPC", () => {
  const main = read("src/main.flow");
  assert.match(main, /function fs_r_inspect\(\) -> string/);
  assert.match(main, /if eq\(path, "\/api\/inspect\/r"\) \{\s*send_r_environment\(\)/);
  assert.match(main, /if eq\(method, "POST"\) and fs_intent_allowed\(\) == 1/);
  assert.match(main, /function send_r_environment\(\) -> void \{[\s\S]*?"application\/json; charset=utf-8"/);
});

test("R IPC uses a separate zero-length inspection opcode and bounds response", () => {
  const transport = read("src/r_session.c");
  const kernel = read("src/r_kernel.R");
  assert.match(transport, /fs_r_inspect\(void\) \{ return request_r\('I', ""\); \}/);
  assert.match(kernel, /\^\[ECITPKL\]\[0-9a-f\]\{8\}\$/);
  assert.match(kernel, /inspect_workspace <- function\(\)/);
  assert.match(transport, /fs_r_plot\(void\) \{ return request_r\(\x27P\x27, ""\); \}/);
  assert.match(transport, /fs_r_check\(const char \*code\) \{ return request_r\(\x27C\x27, code\); \}/);
  assert.match(kernel, /check_source <- function\(source\)/);
  assert.match(kernel, /bindingIsActive\(name, workspace\)/);
  assert.match(kernel, /length\(entries\) >= 128L/);
  assert.match(kernel, /used \+ additional > 65000L/);
});

test("Native editor refreshes R metadata without executing source for inspection", () => {
  const html = read("web/index.html");
  assert.match(html, /fetch\("\/api\/inspect\/" \+ selectedLanguage/);
  assert.match(html, /selectedLanguage !== "python" && selectedLanguage !== "r"/);
  assert.match(html, /cell\.textContent = value/);
});
