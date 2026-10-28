"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.join(__dirname, "..");
const panel = require(path.join(root, "web/debug_panel.js"));

test("breakpoint store toggles, sorts and bounds breakpoints", () => {
  const store = panel.createBreakpointStore();
  assert.equal(store.toggle("doc-a", 3), true);
  assert.equal(store.toggle("doc-a", 1), true);
  assert.deepEqual(store.lines("doc-a"), [1, 3]);
  assert.equal(store.toggle("doc-a", 3), true);
  assert.deepEqual(store.lines("doc-a"), [1]);
  assert.equal(store.toggle("doc-a", 0), false, "line numbers start at 1");
  assert.equal(store.toggle(null, 5), false);
  for (let line = 2; line <= panel.MAX_BREAKPOINTS + 2; line++) store.toggle("doc-b", line);
  assert.equal(store.count("doc-b"), panel.MAX_BREAKPOINTS, "bounded store");
  store.clear("doc-b");
  assert.equal(store.count("doc-b"), 0);
});

const TRACE = {
  ok: true, truncated: false, output: "hello",
  events: [
    { line: 1, function: "<module>", elapsed_ms: 0,
      locals: { total: { type: "int", value: "0" }, "__dunder__": { type: "int", value: "9" } } },
    { line: 4, function: "step", elapsed_ms: 1.2, locals: { total: { type: "int", value: "5" } } },
    { line: 7, function: "<module>", elapsed_ms: 2, locals: { total: { type: "int", value: "9" } } }
  ]
};

test("steps derive from the trace with breakpoint marks and clean locals", () => {
  const result = panel.stepsFromTrace(TRACE, [4]);
  assert.equal(result.ok, true);
  assert.equal(result.truncated, false);
  assert.equal(result.steps.length, 3);
  // Dunder locals are dropped by the sanitizer.
  assert.deepEqual(result.steps[0].locals,
    [{ name: "total", type: "int", value: "0" }]);
  assert.equal(result.steps[1].atBreakpoint, true);
  assert.equal(result.steps[0].atBreakpoint, false);
  assert.throws(() => panel.stepsFromTrace(null, []), /Malformed/);
  assert.throws(() => panel.stepsFromTrace({ events: "no" }, []), /Malformed/);
});

function fakeDocument() {
  const made = [];
  function element(tag) {
    const node = {
      tag, children: [], textContent: "", className: "", dataset: {},
      title: "", attributes: {},
      append(...nodes) { node.children.push(...nodes); },
      replaceChildren(...nodes) { node.children = nodes; },
      setAttribute(name, value) { node.attributes[name] = value; },
      addEventListener(name, fn) { node.listeners[name] = fn; },
      listeners: {},
      querySelector(selector) { return node._sections?.[selector] || null; },
      querySelectorAll() { return []; }
    };
    made.push(node);
    return node;
  }
  return { createElement: element, made };
}

function testCoveragePanelNode(doc) {
  const stepsNode = doc.createElement("div");
  const localsNode = doc.createElement("div");
  const wrap = doc.createElement("div");
  wrap._sections = { ".debug-steps": stepsNode, ".debug-locals": localsNode };
  return wrap;
}

test("debug run posts the source to the real trace route and renders steps", async () => {
  const doc = fakeDocument();
  const node = testCoveragePanelNode(doc);
  const requests = [];
  let jumped = null;
  const p = panel.mount(doc, {
    node,
    fetchFn: async (route, init) => {
      requests.push([route, init.body]);
      return { ok: true, status: 200, text: async () => JSON.stringify(TRACE) };
    },
    getSource: () => "total = 5\ntotal += 4\nprint(total)\n",
    getBreakpoints: () => [4],
    onStep: step => { jumped = step; }
  });
  const result = await p.run();
  assert.ok(result);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], "/api/trace/python");
  assert.equal(requests[0][1], "total = 5\ntotal += 4\nprint(total)\n");
  assert.equal(p.total(), 3);
  // Clicking the second step fires the jump callback and paints locals.
  const stepRows = node._sections[".debug-steps"].children
    .map(row => row.querySelector("button") || row.children[0]);
  assert.equal(stepRows.length, 3);
  stepRows[1].listeners.click();
  assert.equal(jumped.line, 4);
  assert.equal(p.current().line, 4);
  assert.equal(p.previous().line, 1, "scrub backwards");
  assert.equal(p.next().line, 4, "scrub forwards");
});

test("debug run refuses empty buffers and posts nothing", async () => {
  const doc = fakeDocument();
  let requests = 0;
  const p = panel.mount(doc, {
    node: testCoveragePanelNode(doc),
    fetchFn: async () => { requests++; return { ok: true, status: 200, text: async () => "{\"events\":[]}" }; },
    getSource: () => "   ",
    getBreakpoints: () => []
  });
  assert.equal(await p.run(), null);
  assert.equal(requests, 0);
  assert.equal(p.total(), 0);
});

test("replay steps keep dense indices after invalid trace records are filtered", async () => {
  const malformed = { ...TRACE, events: [
    TRACE.events[0],
    { line: -5, function: "invalid" },
    TRACE.events[1],
    { line: 100001, function: "invalid" },
    TRACE.events[2]
  ] };
  const parsed = panel.stepsFromTrace(malformed, [4]);
  assert.deepEqual(parsed.steps.map(step => step.index), [0, 1, 2]);
  assert.deepEqual(parsed.steps.map(step => step.eventIndex), [0, 2, 4]);
  const doc = fakeDocument(), node = testCoveragePanelNode(doc);
  let jumped = null;
  const p = panel.mount(doc, {
    node,
    fetchFn: async () => ({ ok: true, text: async () => JSON.stringify(malformed) }),
    getSource: () => "x = 1\nx += 1",
    getDocId: () => "document-a",
    onStep: step => { jumped = step; }
  });
  await p.run();
  const rows = node._sections[".debug-steps"].children;
  assert.equal(rows[1].children[0].textContent.startsWith("#2  line 4"), true);
  rows[1].children[0].listeners.click();
  assert.equal(p.at(), 1);
  assert.equal(p.current().line, 4);
  assert.equal(jumped.eventIndex, 2);
  assert.equal(p.previous().line, 1);
  assert.equal(p.next().line, 4);
  assert.equal(p.goTo(2).line, 7);
});

test("replay navigation refuses a trace belonging to a different editor buffer", async () => {
  const doc = fakeDocument(), node = testCoveragePanelNode(doc);
  let activeDoc = "document-a", jumps = 0, warning = "";
  const p = panel.mount(doc, {
    node,
    fetchFn: async () => ({ ok: true, text: async () => JSON.stringify(TRACE) }),
    getSource: () => "x = 1",
    getDocId: () => activeDoc,
    onStep: () => { jumps++; },
    notice: message => { warning = message; }
  });
  await p.run();
  activeDoc = "document-b";
  node._sections[".debug-steps"].children[1].children[0].listeners.click();
  assert.equal(p.at(), -1);
  assert.equal(p.total(), 0);
  assert.equal(jumps, 0);
  assert.match(warning, /editor buffer changed/);
});

test("replay drops an asynchronous trace when its document or source changed", async () => {
  for (const change of ["document", "source"]) {
    const doc = fakeDocument(), node = testCoveragePanelNode(doc);
    let activeDoc = "document-a", source = "x = 1", resolveFetch, warning = "";
    const p = panel.mount(doc, {
      node,
      fetchFn: () => new Promise(resolve => { resolveFetch = resolve; }),
      getSource: () => source,
      getDocId: () => activeDoc,
      notice: message => { warning = message; }
    });
    const pending = p.run();
    if (change === "document") activeDoc = "document-b";
    else source = "x = 2";
    resolveFetch({ ok: true, text: async () => JSON.stringify(TRACE) });
    assert.equal(await pending, null);
    assert.equal(p.total(), 0);
    assert.match(warning, /Editor buffer changed/);
  }
});

test("workspace wires replay debugger to the actual active document", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve("../web/workspace_panels.js"), "utf8");
  assert.match(source, /getDocId: activeDocumentId/);
});

test("replay refuses navigation after editing the traced source", async () => {
  const doc = fakeDocument(), node = testCoveragePanelNode(doc);
  let source = "x = 1", jumps = 0, warning = "";
  const p = panel.mount(doc, {
    node,
    fetchFn: async () => ({ ok: true, text: async () => JSON.stringify(TRACE) }),
    getSource: () => source,
    getDocId: () => "document-a",
    onStep: () => { jumps++; },
    notice: message => { warning = message; }
  });
  await p.run();
  source = "x = 2";
  node._sections[".debug-steps"].children[1].children[0].listeners.click();
  assert.equal(p.at(), -1);
  assert.equal(p.total(), 0);
  assert.equal(jumps, 0);
  assert.match(warning, /editor buffer changed/);
});

test("trace execution writes captured stdout and failure tracebacks once", async () => {
  for (const ok of [true, false]) {
    const output = ok ? "42\n" : "Traceback (most recent call last):\nValueError: bad\n";
    const writes = [];
    const doc = fakeDocument();
    const p = panel.mount(doc, {
      node: testCoveragePanelNode(doc),
      fetchFn: async () => ({
        ok, status: ok ? 200 : 422,
        text: async () => JSON.stringify({ ...TRACE, ok, output })
      }),
      getSource: () => "print(42)",
      getDocId: () => "document-a",
      onOutput: (text, successful) => writes.push([text, successful])
    });
    const result = await p.run();
    assert.equal(result.ok, ok);
    assert.deepEqual(writes, [[output, ok]]);
    assert.equal(p.total(), 3);
  }
});

test("public replay navigation invalidates stale locals and step counts", async () => {
  for (const change of ["document", "source"]) {
    const doc = fakeDocument(), node = testCoveragePanelNode(doc);
    let source = "x = 1", docId = "document-a", warning = "";
    const p = panel.mount(doc, {
      node,
      fetchFn: async () => ({ ok: true, text: async () => JSON.stringify(TRACE) }),
      getSource: () => source,
      getDocId: () => docId,
      notice: message => { warning = message; }
    });
    await p.run();
    assert.equal(p.goTo(1).line, 4);
    if (change === "document") docId = "document-b";
    else source = "x = 2";
    assert.equal(p.next(), null);
    assert.equal(p.previous(), null);
    assert.equal(p.goTo(0), null);
    assert.equal(p.current(), null);
    assert.equal(p.total(), 0);
    assert.equal(p.at(), -1);
    assert.equal(node._sections[".debug-steps"].children.length, 0);
    assert.match(warning, /editor buffer changed/);
  }
});

test("rerunning a trace clears previous locals while the request is pending", async () => {
  const doc = fakeDocument(), node = testCoveragePanelNode(doc);
  let fetchCount = 0, finishSecond;
  const p = panel.mount(doc, {
    node,
    fetchFn: () => {
      fetchCount++;
      if (fetchCount === 1) return Promise.resolve({
        ok: true, text: async () => JSON.stringify(TRACE)
      });
      return new Promise(resolve => { finishSecond = resolve; });
    },
    getSource: () => "x = 1",
    getDocId: () => "document-a"
  });
  await p.run();
  assert.equal(p.total(), 3);
  const pending = p.run();
  assert.equal(p.total(), 0);
  assert.equal(p.current(), null);
  assert.equal(node._sections[".debug-steps"].children.length, 0);
  finishSecond({ ok: true, text: async () => JSON.stringify({
    ...TRACE, events: [TRACE.events[0]]
  }) });
  await pending;
  assert.equal(p.total(), 1);
});

test("failed or stale reruns do not publish stale Python console output", async () => {
  const doc = fakeDocument(), node = testCoveragePanelNode(doc);
  let source = "x = 1", finishSecond;
  const writes = [];
  let request = 0;
  const p = panel.mount(doc, {
    node,
    fetchFn: () => {
      request++;
      if (request === 1) return Promise.resolve({
        ok: true, text: async () => JSON.stringify({ ...TRACE, output: "first\n" })
      });
      return new Promise(resolve => { finishSecond = resolve; });
    },
    getSource: () => source,
    getDocId: () => "document-a",
    onOutput: text => writes.push(text)
  });
  await p.run();
  assert.deepEqual(writes, ["first\n"]);
  const pending = p.run();
  source = "x = 2";
  finishSecond({ ok: true, text: async () => JSON.stringify({ ...TRACE, output: "stale\n" }) });
  assert.equal(await pending, null);
  assert.deepEqual(writes, ["first\n"]);
  assert.equal(p.total(), 0);
});

test("workspace sends Python debugger stdout to the runtime console", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve("../web/workspace_panels.js"), "utf8");
  assert.match(source, /onOutput: output =>/);
  assert.match(source, /FlowStudioConsoleIO\.write\(text, "python"\)/);
});

test("replay navigation selects real steps, jumps breakpoints, and updates the visible and accessible state", async () => {
  const doc = fakeDocument(), node = testCoveragePanelNode(doc);
  const button = () => ({ disabled: false, listeners: {},
    addEventListener(event, fn) { this.listeners[event] = fn; } });
  const previousButton = button(), nextButton = button();
  const previousBreakpointButton = button(), nextBreakpointButton = button();
  let source = "x = 1", visited = [];
  const p = panel.mount(doc, {
    node, previousButton, nextButton, previousBreakpointButton, nextBreakpointButton,
    getSource: () => source, getDocId: () => "source-document",
    getBreakpoints: () => [4, 7],
    onStep: step => visited.push(step.line),
    fetchFn: async () => ({ ok: true, text: async () => JSON.stringify(TRACE) })
  });
  assert.equal(previousButton.disabled, true);
  assert.equal(nextButton.disabled, true);
  await p.run();
  assert.equal(previousButton.disabled, true);
  assert.equal(nextButton.disabled, false);
  assert.equal(previousBreakpointButton.disabled, true);
  assert.equal(nextBreakpointButton.disabled, false);
  const rows = node._sections[".debug-steps"].children;
  assert.match(rows[0].className, /debug-step-active/);
  assert.equal(rows[0].children[0].attributes["aria-current"], "step");
  nextBreakpointButton.listeners.click();
  assert.equal(p.at(), 1);
  assert.equal(p.current().line, 4);
  assert.equal(rows[0].children[0].attributes["aria-current"], "false");
  assert.equal(rows[1].children[0].attributes["aria-current"], "step");
  assert.match(rows[1].className, /debug-step-here debug-step-active/);
  nextButton.listeners.click();
  assert.equal(p.at(), 2);
  assert.equal(nextButton.disabled, true);
  assert.equal(nextBreakpointButton.disabled, true);
  previousBreakpointButton.listeners.click();
  assert.equal(p.at(), 1);
  previousButton.listeners.click();
  assert.equal(p.at(), 0);
  assert.deepEqual(visited, [4, 7, 4, 1]);
  assert.equal(p.goTo(2).line, 7);
  assert.equal(p.next(), null);
  source = "x = 2";
  previousButton.listeners.click();
  assert.equal(p.total(), 0);
  assert.equal(previousButton.disabled, true);
  assert.equal(nextButton.disabled, true);
  assert.equal(previousBreakpointButton.disabled, true);
  assert.equal(nextBreakpointButton.disabled, true);
  assert.equal(node._sections[".debug-steps"].children.length, 0);
});

test("native replay step controls are present and wired to the real panel", () => {
  const fs = require("node:fs");
  const html = fs.readFileSync(require.resolve("../web/index.html"), "utf8");
  const wiring = fs.readFileSync(require.resolve("../web/workspace_panels.js"), "utf8");
  for (const id of ["debugPrevious", "debugNext", "debugPreviousBp", "debugNextBp"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
    assert.match(wiring, new RegExp('el\\("' + id + '"\\)'));
  }
  assert.match(html, /\.debug-step\.debug-step-active button/);
});
