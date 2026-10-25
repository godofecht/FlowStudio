"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const native = require("../docs/app/native_flow.js");
const plots = require("../docs/app/plot_history.js");
const localhost = new URL("http://127.0.0.1:8751/app/");
const svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="504" height="360"><path d="M0 0L5 5"/></svg>';

function response(body, status = 200) {
  return {ok:status === 200, status, headers:{get:()=>null}, text:async()=>body};
}
async function withBrowser(location, fetch, work) {
  const oldLocation = globalThis.location, oldFetch = globalThis.fetch;
  globalThis.location = location;
  globalThis.fetch = fetch;
  try { return await work(); }
  finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
    globalThis.fetch = oldFetch;
  }
}

test("native R SVG uses real Flow-owned plot IPC with intent gate", async () => {
  const calls = [];
  await withBrowser(localhost, async (route, options) => {
    calls.push([route, options]);
    return response(JSON.stringify({svg, pdf:null, warning:null}));
  }, async () => {
    const session = native.createRSession();
    assert.deepEqual(await session.plot(), {ok:true, svg, pdf:null, warning:null});
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/plot/r");
  assert.equal(calls[0][1].body, "");
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].headers["X-FlowStudio-Intent"], "run");
  assert.equal(calls[0][1].credentials, "omit");
  assert.equal(calls[0][1].redirect, "error");
});

test("native R SVG reports empty, warning and backend failures", async () => {
  for (const payload of [{svg:null, pdf:null, warning:null},
                        {svg:null, pdf:null, warning:"SVG capture exceeded limit."}]) {
    await withBrowser(localhost, async () => response(JSON.stringify(payload)), async () =>
      assert.deepEqual(await native.createRSession().plot(), {ok:true, ...payload}));
  }
  await withBrowser(localhost, async () => response("Kernel unavailable", 503), async () => {
    const result = await native.createRSession().plot();
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
  });
});

test("native R SVG rejects malformed and oversized snapshots", async () => {
  const bad = ["{", "[]", "null", JSON.stringify({svg:"<svg></svg>", warning:42}),
    JSON.stringify({svg:"<script>bad</script>", warning:null}),
    JSON.stringify({svg:"<svg/>", warning:null}),
    JSON.stringify({svg:"<svg></svg>", warning:"x".repeat(201)}),
    JSON.stringify({svg:"<svg>" + "x".repeat(60001) + "</svg>", warning:null})];
  for (const body of bad) {
    await withBrowser(localhost, async () => response(body), async () =>
      await assert.rejects(native.createRSession().plot(), /JSON|Invalid native R SVG/));
  }
});

test("native R SVG never contacts localhost from Pages; reset invalidates in-flight plot", async () => {
  await withBrowser(new URL("https://godofecht.github.io/FlowStudio/app/"),
    () => { throw Error("Unexpected network"); },
    async () => await assert.rejects(native.createRSession().plot(), /native FlowStudio server/));
  let release;
  const calls = [];
  await withBrowser(localhost, async route => {
    calls.push(route);
    if (route === "/api/plot/r") await new Promise(resolve => { release = resolve; });
    return response(route === "/api/reset/r" ? "R session reset." :
      JSON.stringify({svg, pdf:null, warning:null}));
  }, async () => {
    const session = native.createRSession();
    const pending = session.plot();
    for (let i = 0; i < 8 && !release; i++) await Promise.resolve();
    assert.equal(typeof release, "function");
    const reset = session.reset();
    release();
    assert.equal((await pending).ok, false);
    assert.match((await pending).output, /discarded/);
    assert.equal((await reset).ok, true);
  });
  assert.deepEqual(calls, ["/api/plot/r", "/api/reset/r"]);
});

test("SVG plot history creates safe img data URI with zoom and SVG download", () => {
  const original = globalThis.document;
  const makeNode = tag => ({
    tag, children:[], attributes:{}, style:{}, firstChild:null,
    setAttribute(name,value) { this.attributes[name] = value; },
    append(child) { this.children.push(child); this.firstChild = this.children[0]; },
    replaceChildren(...children) { this.children = children; this.firstChild = children[0] || null; }
  });
  globalThis.document = {createElement:makeNode};
  try {
    const target = makeNode("div");
    const history = plots.create(target);
    assert.equal(history.append([{number:1, svg}]), 1);
    const holder = target.children[0];
    const image = holder.children[0], save = holder.children[1], zoom = holder.children[2];
    assert.equal(image.tag, "img");
    assert.equal(image.alt, "R plot 1");
    assert.ok(image.src.startsWith("data:image/svg+xml;charset=utf-8,"));
    assert.ok(decodeURIComponent(image.src.split(",")[1]).includes("<svg"));
    assert.equal(save.download, "flowstudio-figure-1.svg");
    zoom.onclick();
    assert.equal(zoom.attributes["aria-pressed"], "true");
    assert.equal(history.append([{number:2, svg:"<script>bad</script>"}]), 0);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

test("native R PDF fallback is validated and rendered with a PDF download", async () => {
  const pdf = "255044462d312e340a";
  await withBrowser(localhost, async () => response(JSON.stringify({svg:null, pdf, warning:null})),
    async () => assert.deepEqual(await native.createRSession().plot(),
      {ok:true, svg:null, pdf, warning:null}));
  const original = globalThis.document;
  const makeNode = tag => ({
    tag, children:[], attributes:{}, firstChild:null,
    setAttribute(name,value) { this.attributes[name] = value; },
    append(child) { this.children.push(child); this.firstChild = this.children[0]; },
    replaceChildren(...children) { this.children = children; this.firstChild = children[0] || null; }
  });
  globalThis.document = {createElement:makeNode};
  try {
    const target = makeNode("div");
    assert.equal(plots.create(target).append([{number:3, pdf}]), 1);
    const [image, save] = target.children[0].children;
    assert.equal(image.tag, "embed");
    assert.equal(image.attributes.type, "application/pdf");
    assert.ok(image.src.startsWith("data:application/pdf;base64,"));
    assert.equal(save.download, "flowstudio-figure-3.pdf");
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

test("Flow owns native R plot route and IDE fetches it after execution", () => {
  const root = path.join(__dirname, "..");
  const read = name => fs.readFileSync(path.join(root, name), "utf8");
  assert.match(read("src/main.flow"), /if eq\(path, "\/api\/plot\/r"\) \{\s*send_r_plot\(\)/);
  assert.match(read("src/r_session.c"), /fs_r_plot\(void\) \{ return request_r\('P', ""\); \}/);
  assert.match(read("src/r_kernel.R"), /plot_snapshot <- function\(\)/);
  assert.match(read("docs/app/index.html"), /await getRSession\(\)\.plot\(\)/);
});
