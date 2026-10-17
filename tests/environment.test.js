"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Environment = require("../web/environment.js");

function fakeDocument() {
  function element(tagName) {
    return {
      tagName,
      children: [],
      attributes: {},
      textContent: "",
      append(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      setAttribute(key, value) { this.attributes[key] = value; }
    };
  }
  return {createElement: element};
}

test("normalizes a bounded set of environment values", () => {
  const variables = Array.from({length: 250}, (_, i) => ({
    name: "var" + i, type: "integer", preview: "x".repeat(300)
  }));
  const result = Environment.normalize({variables});
  assert.equal(result.length, 200);
  assert.equal(result[0].name, "var0");
  assert.equal(result[0].preview.length, 160);
});

test("rejects malformed inspection JSON", () => {
  assert.throws(() => Environment.normalize({}), TypeError);
  assert.throws(() => Environment.normalize(null), TypeError);
  assert.throws(() => Environment.normalize({variables: {}}), TypeError);
});

test("renders variables as text with accessible headings", () => {
  const doc = fakeDocument();
  const container = doc.createElement("div");
  const count = Environment.render(container, {
    variables: [{name: "experiment", type: "str", preview: "a < b && b > c"}]
  }, doc);
  assert.equal(count, 1);
  const table = container.children[0];
  assert.equal(table.tagName, "table");
  assert.equal(table.attributes["aria-label"], "Session variables");
  const row = table.children[1].children[0];
  assert.equal(row.children[0].textContent, "experiment");
  assert.equal(row.children[2].textContent, "a < b && b > c");
});

test("inspects Python via authorized POST without sending source", async () => {
  const calls = [];
  const result = await Environment.inspect("python", async (url, options) => {
    calls.push({url, options});
    return {ok: true, json: async () => ({variables: [{name: "a", type: "int", preview: "42"}]})};
  });
  assert.deepEqual(result, [{name: "a", type: "int", preview: "42"}]);
  assert.equal(calls[0].url, "/api/inspect/python");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["X-FlowStudio-Intent"], "run");
  assert.equal(calls[0].options.body, undefined);
});

test("rejects unsupported Flow inspection without HTTP request", async () => {
  let called = false;
  await assert.rejects(Environment.inspect("flow", async () => {called = true;}), RangeError);
  assert.equal(called, false);
});

test("surfaces inspection HTTP failures", async () => {
  await assert.rejects(
    Environment.inspect("r", async () => ({
      ok: false, status: 503, text: async () => "R unavailable"
    })),
    /HTTP 503.*R unavailable/
  );
});

test("reset uses authorized POST and returns response text", async () => {
  const calls = [];
  const message = await Environment.reset("r", async (url, options) => {
    calls.push({url, options});
    return {ok: true, text: async () => "Session reset"};
  });
  assert.equal(message, "Session reset");
  assert.equal(calls[0].url, "/api/reset/r");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["X-FlowStudio-Intent"], "run");
});

test("reset refuses unsupported runtime and failed status", async () => {
  await assert.rejects(Environment.reset("flow", async () => ({})), RangeError);
  await assert.rejects(
    Environment.reset("python", async () => ({ok: false, status: 500})),
    /HTTP 500/
  );
});
