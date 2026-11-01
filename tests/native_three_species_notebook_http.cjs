"use strict";
const assert = require("node:assert/strict");

async function run({post, routes, flow, read, parseCells, create, format}) {
  // Six real Flow/Python/R notebook cells: 3,072 seeded values, 48 R midpoint
  // PDE steps, and independent Python stencil verification. No shared namespace.
  const threeInitialResponse = await post(routes.python, read("coupled_three_species_python.py"));
  assert.equal(threeInitialResponse.status, 200, threeInitialResponse.body.slice(0, 300));
  const threeInitial = JSON.parse(threeInitialResponse.body);
  assert.deepEqual(Object.keys(threeInitial).sort(), ["a", "b", "c"]);
  for (const name of ["a", "b", "c"]) {
    assert.equal(threeInitial[name].length, 1024);
    assert.ok(threeInitial[name].every(Number.isFinite));
  }
  const threeAssignments = ["a", "b", "c"].map(name =>
    "flowstudio_three_initial_" + name + " <- c(" +
    threeInitial[name].map(value => value.toPrecision(17)).join(",") + ")");
  assert.ok(threeAssignments.every(code => Buffer.byteLength(code, "utf8") <= 65536));
  const threeSource = [
    "# %% [flow]\n" + flow + "\n",
    "# %% [python]\n" + read("coupled_three_species_python.py") + "\n",
    ...threeAssignments.map(code => "# %% [r]\n" + code + "\n"),
    "# %% [r]\n" + read("coupled_three_species_r.R") + "\n"
  ].join("");
  const threeEntries = [], threeCalls = [];
  const threeRunner = create({parseCells, execute:async (code, language) => {
    threeCalls.push(language);
    const response = await post(routes[language], code);
    return {ok:response.ok, output:response.body};
  }, onCell:entry => threeEntries.push(entry), notice:()=>{}, allowNativeFlow:true});
  assert.deepEqual(await threeRunner.run(threeSource, "python"), {ok:true, executed:6});
  assert.deepEqual(threeCalls, ["flow", "python", "r", "r", "r", "r"]);
  const threeResults = threeEntries.filter(entry => entry.kind === "code");
  assert.equal(threeResults.length, 6);
  const threeFrame = threeResults[5].output.split(/\r?\n/).filter(line =>
    line.startsWith("FLOWSTUDIO_THREE_R_V1 "));
  assert.equal(threeFrame.length, 1);
  const threeValues = threeFrame[0].slice("FLOWSTUDIO_THREE_R_V1 ".length)
    .split(",").map(Number);
  assert.equal(threeValues.length, 3072);
  assert.ok(threeValues.every(Number.isFinite));
  const threeResult = Object.fromEntries(["a", "b", "c"].map((name, i) =>
    [name, threeValues.slice(i * 1024, (i + 1) * 1024)]));
  const checkThree = async result => {
    const payload = JSON.stringify(result);
    const code = "import json\nnotebook_three_error = verify_result(json.loads(" + JSON.stringify(payload) +
      "))\nprint('notebook-three-species-oracle-ok', notebook_three_error)";
    assert.ok(Buffer.byteLength(code, "utf8") < 131072);
    return post(routes.python, code);
  };
  const threeVerified = await checkThree(threeResult);
  assert.equal(threeVerified.status, 200, threeVerified.body.slice(0, 400));
  assert.match(threeVerified.body, /notebook-three-species-oracle-ok/);
  const threeCorrupted = {...threeResult, c:threeResult.c.slice()};
  threeCorrupted.c[1023] += .1;
  const threeRejected = await checkThree(threeCorrupted);
  assert.equal(threeRejected.status, 422, threeRejected.body.slice(0, 400));
  assert.match(threeRejected.body, /anisotropic stencil mismatch/);
  const threePlot = await post("/api/plot/r", "");
  assert.equal(threePlot.status, 200, threePlot.body.slice(0, 300));
  const threeGraphics = JSON.parse(threePlot.body);
  assert.equal(threeGraphics.warning, null);
  assert.ok(threeGraphics.svg ? threeGraphics.svg.includes("<svg") &&
    threeGraphics.svg.includes("</svg>") :
    typeof threeGraphics.pdf === "string" &&
    Buffer.from(threeGraphics.pdf, "hex").subarray(0, 4).toString() === "%PDF");
  const threeSaved = format.encodeBundle(threeSource, "python", threeResults, parseCells);
  const threeRestored = format.decodeBundle(threeSaved, parseCells);
  assert.equal(threeRestored.source, threeSource);
  assert.deepEqual(threeRestored.entries.map(entry => entry.output),
    threeResults.map(entry => entry.output));
  assert.equal(threeRestored.entries.length, 6);
  const threeRecovery = await checkThree(threeResult);
  assert.equal(threeRecovery.status, 200, threeRecovery.body.slice(0, 300));
  const rThreeRecovery = await post(routes.r,
    "stopifnot(length(flowstudio_three_final_a) == 1024L, " +
    "length(flowstudio_three_final_b) == 1024L, " +
    "length(flowstudio_three_final_c) == 1024L); cat('r-three-recovery-ok\\n')");
  assert.equal(rThreeRecovery.status, 200, rThreeRecovery.body.slice(0, 300));
  assert.match(rThreeRecovery.body, /r-three-recovery-ok/);

  // Real notebook controller must resume a persistent R PDE checkpoint across
  // two separate executable cells and preserve its exact numerical output.
  const restart = read("coupled_three_species_restart_r.R");
  assert.ok(Buffer.byteLength(restart, "utf8") < 65536);
  const restartSource = [
    "# %% [r]\nflowstudio_three_restart_phase <- 0L\n",
    "# %% [r]\n" + restart + "\n",
    "# %% [r]\n" + restart + "\n"
  ].join("");
  const runCheckpointNotebook = async () => {
    const callsBefore = threeCalls.length;
    const entriesBefore = threeEntries.length;
    assert.deepEqual(await threeRunner.run(restartSource, "python"),
      {ok:true, executed:3});
    assert.deepEqual(threeCalls.slice(callsBefore), ["r", "r", "r"]);
    const outputs = threeEntries.slice(entriesBefore);
    assert.equal(outputs.length, 3);
    assert.deepEqual(outputs.map(entry => entry.language), ["r", "r", "r"]);
    for (const [index, phase] of [[1, 1], [2, 2]]) {
      const frame = outputs[index].output.split(/\r?\n/).filter(line =>
        line.startsWith("FLOWSTUDIO_THREE_RESTART_V1 "));
      assert.equal(frame.length, 1);
      assert.ok(frame[0].startsWith("FLOWSTUDIO_THREE_RESTART_V1 " + phase + " "));
    }
    const frame = outputs[2].output.split(/\r?\n/).find(line =>
      line.startsWith("FLOWSTUDIO_THREE_RESTART_V1 2 "));
    const values = frame.slice("FLOWSTUDIO_THREE_RESTART_V1 2 ".length)
      .split(",").map(Number);
    assert.equal(values.length, 3072);
    assert.ok(values.every(Number.isFinite));
    const result = Object.fromEntries(["a", "b", "c"].map((name, i) =>
      [name, values.slice(i * 1024, (i + 1) * 1024)]));
    const checked = await checkThree(result);
    assert.equal(checked.status, 200, checked.body.slice(0, 300));
    const saved = format.encodeBundle(restartSource, "python", outputs, parseCells);
    const restored = format.decodeBundle(saved, parseCells);
    assert.equal(restored.source, restartSource);
    assert.deepEqual(restored.entries.map(entry => entry.output),
      outputs.map(entry => entry.output));
    return outputs[2].output;
  };
  const checkpointOutput = await runCheckpointNotebook();
  const failedBefore = threeCalls.length;
  assert.deepEqual(await threeRunner.run(
    "# %% [r]\n" + restart +
    "\n# %% [r]\nflowstudio_three_notebook_unexpected <- TRUE\n", "python"),
    {ok:false, executed:1});
  assert.deepEqual(threeCalls.slice(failedBefore), ["r"]);
  const noMutation = await post(routes.r,
    "stopifnot(!exists('flowstudio_three_notebook_unexpected', inherits=TRUE)); " +
    "cat('checkpoint-notebook-stop-ok\\n')");
  assert.equal(noMutation.status, 200, noMutation.body.slice(0, 300));
  assert.match(noMutation.body, /checkpoint-notebook-stop-ok/);
  assert.equal(await runCheckpointNotebook(), checkpointOutput);
}
module.exports = {run};
