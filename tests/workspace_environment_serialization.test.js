"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {mount} = require("../web/workspace_environment.js");

test("environment reset serializes inspection", async () => {
  let finishReset;
  const calls = [];
  const panel = {append() {}};
  const runtime = {parentElement: panel, textContent: ""};
  const language = {value: "flow", addEventListener() {}};
  const doc = {
    getElementById: id => id === "runtimeInfo" ? runtime : id === "language" ? language : null,
    createElement: () => ({append() {}, replaceChildren() {}, setAttribute() {}, addEventListener() {}})
  };
  const original = globalThis.FlowStudioEnvironment;
  globalThis.FlowStudioEnvironment = {
    reset: () => new Promise(resolve => { finishReset = resolve; }),
    inspect: async () => { calls.push("inspect"); return []; },
    render: () => 0
  };
  const controller = mount(doc, async () => ({}));
  globalThis.FlowStudioEnvironment = original;
  language.value = "python";
  const resetting = controller.reset();
  assert.equal(await controller.afterExecution("python"), false);
  assert.deepEqual(calls, []);
  finishReset();
  assert.equal(await resetting, true);
  assert.deepEqual(calls, ["inspect"]);
});
