"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.join(__dirname, "..");
const panel = require(path.join(root, "web/packages_panel.js"));

function fakeElement(tag) {
  const node = {
    tagName: tag, children: [], textContent: "",
    className: "", placeholder: "", disabled: false, dataset: {},
    attributes: {},
    append(...nodes) { node.children.push(...nodes); },
    replaceChildren(...nodes) { node.children = nodes; },
    setAttribute(name, value) { node.attributes[name] = value; },
    addEventListener() {}
  };
  Object.defineProperty(node, "value", {
    get() { return node._value; }, set(v) { node._value = v; }
  });
  return node;
}

function fakeDocument() {
  const nodes = new Map();
  return {
    elements: nodes,
    createElement(tag) { return fakeElement(tag); },
    get node() { return nodes; }
  };
}

test("packages panel installs a pinned Python package through the session route", async () => {
  const doc = fakeDocument();
  const calls = [];
  const input = fakeElement("input");
  input.value = "requests==2.31.0";
  const p = panel.mount(doc, {
    target: fakeElement("div"), input,
    installButton: fakeElement("button"), listButton: fakeElement("button"),
    language: () => "python",
    fetchFn: async (route, init) => {
      calls.push([route, init.body]);
      if (init.body.includes("--format")) {
        return { ok: true, status: 200, text: async () => '[{"name":"pip","version":"25.0"}]' };
      }
      return { ok: true, status: 200, text: async () => "Successfully installed" };
    }
  });
  const done = await p.install();
  assert.equal(done, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "/api/run/python");
  assert.match(calls[0][1], /pip.*install.*--user.*requests==2\.31\.0/s);
  assert.equal(calls[1][0], "/api/run/python");
  assert.match(calls[1][1], /pip.*list.*--format.*json/s);
});

test("packages panel rejects unsafe specs before any request", async () => {
  const doc = fakeDocument();
  const requests = [];
  const input = fakeElement("input");
  input.value = "pkgs; import os";
  const p = panel.mount(doc, {
    target: fakeElement("div"), input,
    installButton: fakeElement("button"), listButton: fakeElement("button"),
    language: () => "python",
    fetchFn: async (route, body) => { requests.push([route, body]); return { ok: true, status: 200, text: async () => "[]" }; }
  });
  const done = await p.install();
  assert.equal(done, false);
  assert.equal(requests.length, 0);
  assert.equal(p.validSpec("ok-name==1.0", "python"), true);
  assert.equal(p.validSpec("../evil", "python"), false);
  assert.equal(p.validSpec("ggplot2", "r"), true);
  assert.equal(p.validSpec("system('ls')", "r"), false);
});

test("packages panel installs an R package with the CRAN mirror and parses inventory", async () => {
  const doc = fakeDocument();
  const calls = [];
  const input = fakeElement("input");
  input.value = "ggplot2";
  const p = panel.mount(doc, {
    target: fakeElement("div"), input,
    installButton: fakeElement("button"), listButton: fakeElement("button"),
    language: () => "r",
    fetchFn: async (route, init) => {
      calls.push([route, init.body]);
      if (init.body.includes("installed.packages")) {
        return { ok: true, status: 200, text: async () => "ggplot2 3.5.1\nMASS 7.3-60" };
      }
      return { ok: true, status: 200, text: async () => "* DONE (ggplot2)" };
    }
  });
  const done = await p.install();
  assert.equal(done, true);
  assert.equal(calls[0][0], "/api/run/r");
  assert.match(calls[0][1], /install\.packages\("ggplot2", repos = "https:\/\/cloud\.r-project\.org"\)/);
  assert.match(calls[1][1], /installed\.packages/);
});

test("packages panel inventory parsers reject malformed output", () => {
  assert.deepEqual(panel.parsePipInventory('[{"name":"pip","version":"25"}]'),
    [{ name: "pip", version: "25" }]);
  assert.equal(panel.parsePipInventory("not json"), null);
  assert.equal(panel.parsePipInventory('[{"name":42,"version":"1"}]'), null);
  assert.deepEqual(panel.parseRInventory("ggplot2 3.5.1\nMASS 7.3-60"),
    [{ name: "ggplot2", version: "3.5.1" }, { name: "MASS", version: "7.3-60" }]);
  assert.deepEqual(panel.parseRInventory("(no packages installed)"), []);
  assert.equal(panel.parseRInventory(42), null);
});

test("packages panel disables actions for Flow", () => {
  const doc = fakeDocument();
  const installButton = fakeElement("button");
  const listButton = fakeElement("button");
  const p = panel.mount(doc, {
    target: fakeElement("div"), input: fakeElement("input"),
    installButton, listButton,
    language: () => "flow",
    fetchFn: async () => ({ ok: true, status: 200, text: async () => "" })
  });
  p.updateLanguage();
  assert.equal(installButton.disabled, true);
  assert.equal(listButton.disabled, true);
  assert.equal(installButton.getAttribute && installButton.attributes.disabled, undefined);
});
