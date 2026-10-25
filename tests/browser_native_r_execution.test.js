"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const native = require("../docs/app/native_flow.js");
const localhost = new URL("http://127.0.0.1:8751/app/");

async function withBrowser(location, fetch, work) {
  const priorLocation = globalThis.location, priorFetch = globalThis.fetch;
  globalThis.location = location;
  globalThis.fetch = fetch;
  try { return await work(); }
  finally {
    if (priorLocation === undefined) delete globalThis.location;
    else globalThis.location = priorLocation;
    globalThis.fetch = priorFetch;
  }
}
function response(output, status = 200) {
  return {ok:status === 200, status, headers:{get:()=>null},
    text:async()=>output};
}
const tree = {variables:[{name:"nested",type:"list",size:1,dimensions:null,
  children:[{name:"[[1]] matrix",type:"integer",size:6,dimensions:[2,3]}]}],
truncated:false};

test("native R editor sends actual source to Flow-owned persistent R endpoint", async () => {
  const calls = [];
  await withBrowser(localhost, async (route, options) => {
    calls.push([route, options.body]);
    assert.equal(options.method, "POST");
    assert.equal(options.headers["X-FlowStudio-Intent"], "run");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    return response(route === "/api/run/r" ? "42\n" : JSON.stringify(tree));
  }, async () => {
    const session = native.createRSession();
    assert.deepEqual(await session.run("x <- 41\ncat(x + 1, '\\n')"),
      {ok:true, status:200, output:"42\n"});
    const inspection = await session.inspect();
    assert.equal(inspection.ok, true);
    assert.equal(inspection.variables[0].preview, "length 1");
    assert.deepEqual(inspection.variables[0].children[0].shape, ["2", "3"]);
    assert.equal(inspection.variables[0].children[0].name, "[[1]] matrix");
  });
  assert.deepEqual(calls.map(item => item[0]), ["/api/run/r", "/api/inspect/r"]);
});

test("native R serializes runs and resets the real persistent kernel", async () => {
  const calls = [];
  let release;
  await withBrowser(localhost, async (route, options) => {
    calls.push(route);
    if (route === "/api/run/r" && options.body === "slow <- 1")
      await new Promise(resolve => { release = resolve; });
    return response(route === "/api/reset/r" ? "R session reset." : "ok");
  }, async () => {
    const session = native.createRSession();
    const running = session.run("slow <- 1");
    for (let i = 0; i < 6 && !release; i++) await Promise.resolve();
    assert.equal(typeof release, "function");
    const discarded = session.run("stale <- 2");
    const reset = session.reset();
    const next = session.run("fresh <- 3");
    release();
    assert.equal((await running).ok, false);
    assert.match((await discarded).output, /discarded/);
    assert.equal((await reset).ok, true);
    assert.equal((await next).ok, true);
  });
  assert.deepEqual(calls, ["/api/run/r", "/api/reset/r", "/api/run/r"]);
});

test("native R source errors, parser diagnostics and reset errors stay failures", async () => {
  await withBrowser(localhost, async route => response(
    route === "/api/run/r" ? "Error: object not found" :
    route === "/api/check/r" ? "R syntax error: <text>:2:4: unexpected ')'" :
    "R unavailable", 422), async () => {
    const session = native.createRSession();
    const run = await session.run("unknown");
    assert.equal(run.ok, false);
    assert.equal(run.status, 422);
    const check = await session.checkSyntax("x <- )");
    assert.equal(check.ok, false);
    assert.deepEqual(check.diagnostics, [{line:2,column:4,message:"unexpected ')'"}]);
    assert.equal((await session.reset()).ok, false);
  });
});

test("native R rejects malformed or unsafe environment trees", async () => {
  const invalid = [
    "{",
    JSON.stringify({variables:[],truncated:"no"}),
    JSON.stringify({variables:[{name:"x",type:"list",size:1,dimensions:null,
      children:[{name:"y",type:"list",size:1,dimensions:null,
        children:[{name:"z",type:"list",size:1,dimensions:null,children:[]}]}]}],
      truncated:false}),
    JSON.stringify({variables:[{name:"x",type:"integer",size:1,dimensions:null,
      children:[]}],truncated:false}),
    JSON.stringify({variables:[{name:"x",type:"integer",size:1,dimensions:[-1]}],
      truncated:false})
  ];
  for (const output of invalid) {
    await withBrowser(localhost, async () => response(output), async () => {
      await assert.rejects(native.createRSession().inspect(), /JSON|Invalid native R/);
    });
  }
});

test("native R never contacts localhost from Pages and bounds source and output", async () => {
  await withBrowser(new URL("https://godofecht.github.io/FlowStudio/app/"),
    () => { throw Error("Unexpected network call"); },
    async () => await assert.rejects(native.createRSession().run("1+1"),
      /native FlowStudio server/));
  await withBrowser(localhost, () => { throw Error("Unexpected network call"); },
    async () => {
      assert.equal((await native.createRSession().run(" ")).ok, false);
      assert.equal((await native.createRSession().run("x".repeat(65537))).ok, false);
    });
  await withBrowser(localhost, async () => response("x".repeat(131073)), async () => {
    await assert.rejects(native.createRSession().run("1+1"), /128 KiB/);
  });
});

test("native R unsupported operations cannot silently use the webR workspace", async () => {
  const session = native.createRSession();
  for (const operation of ["installPackage","help","complete",
                           "exportVariable","importVariable"]) {
    const result = await session[operation]("x");
    assert.equal(result.ok, false, operation);
    assert.match(result.output, /not available for native R/);
  }
});

test("browser IDE exposes explicit R runtime selection and routes through the selected session", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source);
  assert.doesNotThrow(() => new vm.Script(source));
  assert.match(html, /id="rRuntime"[^>]*>.*value="browser".*value="native"/);
  assert.match(source, /nativeRSession = FlowStudioNativeFlow\.createRSession\(\)/);
  assert.match(source, /language === "r" \? await getRSession\(\)\.run\(code\)/);
  assert.match(source, /language === "r" \? await getRSession\(\)\.checkSyntax\(code\)/);
  assert.match(source, /await session\.reset\(\)/);
  assert.match(source, /selectedLanguage === "r" \? getRSession\(\)\.run\(code\)/);
});
