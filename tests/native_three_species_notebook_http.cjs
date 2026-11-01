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
}
module.exports = {run};
