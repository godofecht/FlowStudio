"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

global.FlowStudioSourceCells = require("../web/source_cells.js");
const exporter = require("../web/notebook_export.js");
const { mount } = require("../web/workspace_notebook.js");

function fixture(lang = "python", text = "# %%\nx = 3\n") {
  const elements = new Map();
  const link = { click() { link.clicked = true; }, clicked: false };
  const button = { addEventListener(type, fn) { assert.equal(type, "click"); this.click = fn; } };
  elements.set("exportNotebook", button);
  elements.set("source", { value: text });
  elements.set("language", { value: lang });
  elements.set("fileLabel", { textContent: "project/test.py" });
  elements.set("resultStatus", { textContent: "", dataset: {} });
  const doc = { getElementById: id => elements.get(id), createElement: tag => {
    assert.equal(tag, "a");
    return link;
  } };
  const urls = { created: [], revoked: [], createObjectURL(blob) {
    this.created.push(blob);
    return "blob:local-1";
  }, revokeObjectURL(url) { this.revoked.push(url); } };
  const timers = [];
  const controller = mount(doc, exporter, urls, (fn, delay) => timers.push({ fn, delay }));
  return { elements, link, button, urls, timers, controller };
}

test("exports the current unsaved Python buffer as a valid notebook download", async () => {
  const f = fixture();
  f.elements.get("source").value = "# %%\nx = 99\n# %% [markdown]\n# # Results\n";
  assert.equal(f.button.click(), true);
  assert.equal(f.link.clicked, true);
  assert.equal(f.link.download, "test.ipynb");
  const nb = JSON.parse(await f.urls.created[0].text());
  assert.equal(nb.nbformat, 4);
  assert.equal(nb.metadata.kernelspec.name, "python3");
  assert.equal(nb.cells[0].source, "x = 99\n");
  assert.equal(nb.cells[1].source, "# Results\n");
  assert.deepEqual(nb.cells[0].outputs, []);
  assert.equal(f.timers[0].delay, 1000);
  f.timers[0].fn();
  assert.deepEqual(f.urls.revoked, ["blob:local-1"]);
  assert.equal(f.elements.get("resultStatus").dataset.state, "ok");
});

test("R metadata and current filename are used without a server request", async () => {
  const f = fixture("r", "# %%\nx <- 42\n");
  f.elements.get("fileLabel").textContent = "analysis/my report.R";
  assert.equal(f.controller.exportCurrent(), true);
  const nb = JSON.parse(await f.urls.created[0].text());
  assert.equal(nb.metadata.kernelspec.name, "ir");
  assert.equal(nb.cells[0].source, "x <- 42\n");
  assert.equal(f.link.download, "my_report.ipynb");
});

test("Flow, empty source and over-limit buffers do not produce downloads", () => {
  const f = fixture("flow", "function main() -> i32 { return 0 }");
  assert.equal(f.button.click(), false);
  assert.match(f.elements.get("resultStatus").textContent, /Python and R only/);
  f.elements.get("language").value = "python";
  f.elements.get("source").value = "  ";
  assert.equal(f.button.click(), false);
  f.elements.get("source").value = "x".repeat(2 * 1024 * 1024 + 1);
  assert.equal(f.button.click(), false);
  assert.deepEqual(f.urls.created, []);
  assert.equal(f.elements.get("resultStatus").dataset.state, "error");
});

test("download failure revokes the URL and preserves the error", () => {
  const f = fixture();
  f.link.click = () => { throw new Error("Download blocked"); };
  assert.equal(f.controller.exportCurrent(), false);
  assert.deepEqual(f.urls.revoked, ["blob:local-1"]);
  assert.equal(f.timers.length, 0);
  assert.match(f.elements.get("resultStatus").textContent, /Download blocked/);
});

test("served Flow router and editor load exporter dependencies once and in order", () => {
  const routes = read("src/data_routes.flow");
  const html = read("web/index.html");
  assert.ok(routes.includes('if url == "/workspace_notebook.js"'));
  assert.ok(routes.includes('path: "web/workspace_notebook.js"'));
  assert.equal(html.split('id="exportNotebook"').length - 1, 1);
  const tags = ["/notebook_export.js", "/workspace_notebook.js"];
  const offsets = tags.map(name => {
    const tag = '<script src="' + name + '"></script>';
    assert.equal(html.split(tag).length - 1, 1, name);
    return html.indexOf(tag);
  });
  assert.ok(offsets[0] > html.indexOf("FlowStudioWorkspaceTabs.mount();"));
  assert.ok(offsets[0] < offsets[1]);
  assert.ok(offsets[1] < html.indexOf("</body>"));
});

