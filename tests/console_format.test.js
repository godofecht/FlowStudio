"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { format } = require("../web/console_format.js");

// Samples are verbatim server replies captured from the native routes.
const kinds = result => result.lines.map(line => line.kind + (line.line ? "@" + line.line : "") + ": " + line.text);

test("a Flow parse error becomes one located line, with the build log kept as detail", () => {
  const raw = [
    "flowc emit: parse failed",
    "/tmp/flowstudio-run-U5FXR6/main.flow:2:12: parse error: unexpected token '?' (byte 36)",
    "flowc emit: arena_len=3",
    "❌ flowc could not compile /tmp/flowstudio-run-U5FXR6/main.flow",
    "",
    "Process exited unsuccessfully."
  ].join("\n");
  const result = format("flow", raw, false);
  assert.deepEqual(kinds(result), ["error@2: unexpected token '?'"]);
  assert.equal(result.detail, raw);
});

test("a lenient type warning keeps the program output and drops the private path", () => {
  const raw = "/tmp/flowstudio-run-tYeGqa/main.flow:2:18: warning: Variable 'x' initialized with string but annotated as i32\n" +
    "flowc: 1 type warning(s) (lenient mode)\nafter\n";
  const result = format("flow", raw, true);
  assert.deepEqual(kinds(result), ["warning@2: Variable 'x' initialized with string but annotated as i32", "out: after"]);
  assert.ok(!result.lines.some(line => line.text.includes("/tmp/")));
});

test("a C build failure names the problem in one line", () => {
  const raw = [
    "/Users/me/flow/build/run.cvrrj0/main.c:436:15: error: use of undeclared identifier 'undefined_name'",
    "  436 |   int32_t a = undefined_name;",
    "      |               ^",
    "1 error generated.",
    "❌ C compilation/linking failed (flowc host)",
    "",
    "Process exited unsuccessfully."
  ].join("\n");
  const result = format("flow", raw, false);
  assert.equal(result.lines[0].kind, "error");
  assert.equal(result.lines[0].text, "C build failed: use of undeclared identifier 'undefined_name'");
  assert.ok(!kinds(result).some(line => /int32_t|generated|Process exited/.test(line)));
});

test("a program that exits non-zero keeps its output and says so once", () => {
  const result = format("flow", "partial\n\nProcess exited unsuccessfully.", false);
  assert.deepEqual(kinds(result), ["out: partial", "error: The program exited with an error."]);
  assert.deepEqual(kinds(format("flow", "Process exited with code 3.", false)), ["error: Exited with code 3."]);
});

test("Flow console session errors keep their entry line", () => {
  const result = format("flow", "line 1: Undefined variable 'undefined_thing'\n", false);
  assert.deepEqual(kinds(result), ["error@1: Undefined variable 'undefined_thing'"]);
  // The same text from a successful run is program output.
  assert.deepEqual(kinds(format("flow", "line 1: hello\n", true)), ["out: line 1: hello"]);
});

test("clean Flow output passes through unchanged", () => {
  const result = format("flow", "Hello from FlowStudio\n\n", true);
  assert.deepEqual(kinds(result), ["out: Hello from FlowStudio"]);
  assert.equal(result.detail, null);
});

test("a Python traceback leads with the exception and hides FlowStudio's kernel frames", () => {
  const raw = [
    "Traceback (most recent call last):",
    '  File "/Users/me/FlowStudio/src/python_kernel.py", line 308, in serve',
    "    exec(compiled, namespace)",
    '  File "<FlowStudio Python>", line 3, in <module>',
    '  File "<FlowStudio Python>", line 2, in f',
    "ZeroDivisionError: division by zero",
    ""
  ].join("\n");
  const result = format("python", raw, false);
  assert.deepEqual(kinds(result), [
    "error@2: ZeroDivisionError: division by zero",
    "dim@3: line 3, in <module>",
    "dim@2: line 2, in f"
  ]);
  assert.ok(!kinds(result).some(line => /python_kernel|exec\(compiled/.test(line)));
});

test("Python output without a traceback is left alone", () => {
  assert.deepEqual(kinds(format("python", "hi\n", true)), ["out: hi"]);
});

test("R errors and warnings are marked", () => {
  assert.deepEqual(kinds(format("r", "Warning: careful\nError: boom\n", false)), ["warning: careful", "error: boom"]);
  assert.deepEqual(kinds(format("r", "Error in log(\"a\"): non-numeric argument\n", false)), ["error: non-numeric argument"]);
  assert.deepEqual(kinds(format("r", "Warning: NaNs produced\n[1] NaN\n", true)), ["warning: NaNs produced", "out: [1] NaN"]);
});
