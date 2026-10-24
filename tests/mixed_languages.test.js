"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {parseScalar, runPipeline} = require("../docs/app/mixed_languages.js");
test("Python scalar is validated before embedding in R source", () => {
  assert.equal(parseScalar("15\n"), 15);
  for (const invalid of ["15;system('oops')", "1e9", "-1", "NaN", "1x2", "1.2.3", ""]) {
    assert.throws(() => parseScalar(invalid));
  }
});
test("browser pipeline passes Python result to R and checks answer", async () => {
  let rSource = "";
  const result = await runPipeline(
    async code => { assert.match(code, /sum/); return {ok:true, output:"15\n"}; },
    async code => { rSource = code; return {ok:true, output:"3.87298334620742\n"}; }
  );
  assert.equal(rSource, "cat(sqrt(15))");
  assert.equal(result.python, 15);
  assert.ok(Math.abs(result.r - Math.sqrt(15)) < 1e-5);
});
test("pipeline rejects interpreter errors and unexpected R results", async () => {
  await assert.rejects(runPipeline(async () => ({ok:false, output:"error"}), async () => ({})), /Python failed/);
  await assert.rejects(runPipeline(async () => ({ok:true, output:"15"}), async () => ({ok:false, output:"error"})), /R failed/);
  await assert.rejects(runPipeline(async () => ({ok:true, output:"15"}), async () => ({ok:true, output:"12"})), /unexpected result/);
});
test("Pages demo loads existing real browser runtimes", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/mixed.html"), "utf8");
  assert.match(html, /r_session\.js/);
  assert.match(html, /mixed_languages\.js/);
  assert.match(fs.readFileSync(path.join(__dirname, "../docs/app/mixed_languages.js"), "utf8"), /python-worker\.js/);
});
