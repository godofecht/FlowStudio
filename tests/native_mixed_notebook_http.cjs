"use strict";
/* Production acceptance: actual notebook controller -> Flow-owned HTTP ->
 * native Flow compiler, persistent CPython/Rscript, graphics, portable .fsnb.
 * Invoked only while the native server is running; no runtime substitutes.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {parseCells} = require("../docs/app/source_cells.js");
const {create} = require("../docs/app/notebook_runner.js");
const format = require("../docs/app/notebook_format.js");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, "examples", name), "utf8").trimEnd();
const origin = "http://127.0.0.1:8751";
const routes = {flow:"/api/run/flow", python:"/api/run/python", r:"/api/run/r"};

async function post(route, code) {
  const response = await fetch(origin + route, {
    method:"POST", headers:{"X-FlowStudio-Intent":"run"}, body:code,
    signal:AbortSignal.timeout(route === routes.flow ? 80000 : 30000)
  });
  return {ok:response.ok, status:response.status, body:await response.text()};
}

async function main() {
  const flow = read("native_cyclic_network.flow");
  const python = read("spectral_interop_python.py");
  const r = read("spectral_interop_r.R");
  // Explicit numerical interchange, not imaginary shared Python/R namespaces:
  // serialize the real Python kernel's result into an inert, checked R vector.
  const seed = await post(routes.python, python);
  assert.equal(seed.status, 200, seed.body.slice(0, 500));
  const data = JSON.parse(seed.body);
  assert.equal(data.grid, 16);
  assert.equal(data.values.length, 256);
  assert.ok(data.values.every(v => typeof v === "number" && Number.isFinite(v)));
  const assignment = "flowstudio_spectral_values <- c(" +
    data.values.map(v => v.toPrecision(17)).join(",") + ")";
  const source = [
    "# %% [markdown]\nA native Flow cyclic network, Python tensor diffusion and R Fourier oracle.\n",
    "# %% [flow]\n" + flow + "\n",
    "# %% [python]\n" + python + "\n",
    "# %% [r]\n" + assignment + "\n" + r + "\n",
    "# %% [python]\nassert GRID == 16 and MODE_X == 2 and len(initial_field()) == 256\nprint('python-state-ok')\n",
    "# %% [r]\nstopifnot(length(flowstudio_spectral_values) == 256L, abs(mean(flowstudio_spectral_values) - 300) < 2e-10)\ncat('r-state-ok\\n')\n"
  ].join("");
  const cells = parseCells(source);
  assert.deepEqual(cells.map(c => c.kind === "markdown" ? "markdown" : c.language),
    ["markdown", "flow", "python", "r", "python", "r"]);
  const calls = [], entries = [];
  let plot = null;
  const execute = async (code, language) => {
    calls.push(language);
    const result = await post(routes[language], code);
    if (language === "r" && code.includes("spectral-r-ok") && result.ok) {
      const captured = await post("/api/plot/r", "");
      assert.equal(captured.status, 200, captured.body.slice(0, 300));
      plot = JSON.parse(captured.body);
    }
    return {ok:result.ok, output:result.body};
  };
  const runner = create({parseCells, execute, onCell:entry=>entries.push(entry),
    notice:()=>{}, allowNativeFlow:true});
  assert.deepEqual(await runner.run(source, "python"), {ok:true, executed:5});
  assert.deepEqual(calls, ["flow", "python", "r", "python", "r"]);
  const results = entries.filter(entry => entry.kind === "code");
  assert.deepEqual(results.map(entry => entry.language), calls);
  assert.deepEqual(JSON.parse(results[1].output).values, data.values);
  assert.match(results[2].output, /spectral-r-ok/);
  assert.match(results[3].output, /python-state-ok/);
  assert.match(results[4].output, /r-state-ok/);
  assert.equal(plot.warning, null);
  assert.ok(plot.svg ? plot.svg.includes("<svg") && plot.svg.includes("</svg>") :
    typeof plot.pdf === "string" && Buffer.from(plot.pdf, "hex").subarray(0, 4).toString() === "%PDF");

  // Portable multi-kernel notebook stores display snapshots, not interpreter state.
  const saved = format.encodeBundle(source, "python", results, parseCells);
  const restored = format.decodeBundle(saved, parseCells);
  assert.equal(restored.source, source);
  assert.equal(restored.language, "python");
  assert.deepEqual(restored.entries.map(e => [e.index, e.language, e.output]),
    results.map(e => [e.index, e.language, e.output]));
  const corrupted = JSON.parse(saved);
  corrupted.results[1].language = "r";
  assert.throws(() => format.decodeBundle(JSON.stringify(corrupted), parseCells), /language/);
  assert.throws(() => format.encode(source, "python", results, parseCells), /Mixed-language/);

  // Negative execution must stop the real notebook before the next runtime.
  const before = calls.length;
  const failure = await runner.run(
    "# %% [r]\nstop('expected-notebook-error')\n# %% [python]\nprint('must-not-run')\n", "python");
  assert.equal(failure.ok, false);
  assert.equal(failure.executed, 1);
  assert.deepEqual(calls.slice(before), ["r"]);
  assert.match(entries.at(-1).output, /expected-notebook-error/);
  const flowBefore = calls.length;
  const rejected = await runner.run(
    "# %% [flow]\nfunction main() -> i32 { return 37 }\n# %% [r]\ncat('must-not-run')\n", "python");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.executed, 1);
  assert.deepEqual(calls.slice(flowBefore), ["flow"]);

  // Parser/controller limits reject BEFORE any native interpreter side effect.
  const noCalls = calls.length;
  const tooMany = Array.from({length:129}, () => "# %% [python]\nprint(1)\n").join("");
  assert.match((await runner.run(tooMany, "python")).error, /128 executable-cell/);
  assert.match((await runner.run("# %% [python]\n" + "x".repeat(65537), "python")).error, /64 KiB/);
  const hosted = create({parseCells, execute, onCell:()=>{}, notice:()=>{}});
  assert.match((await hosted.run(source, "python")).error, /native Flow server/);
  assert.equal(calls.length, noCalls);

  // Failed R/Flow executions did not destroy the persistent real R/Python kernels.
  const rRecovery = await post(routes.r, "cat(length(flowstudio_spectral_values), '\\n')");
  assert.equal(rRecovery.status, 200, rRecovery.body);
  assert.equal(rRecovery.body.trim(), "256");
  const pyRecovery = await post(routes.python, "print(len(initial_field()))");
  assert.equal(pyRecovery.status, 200, pyRecovery.body);
  assert.equal(pyRecovery.body.trim(), "256");
  console.log("PASS: real Flow/Python/R notebook, 256-cell Fourier oracle, R plot, persistent kernels, portable restore, negative and resource gates");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
