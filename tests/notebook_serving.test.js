"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("Flow router serves notebook page and four explicit script assets", () => {
  const routes = read("src/data_routes.flow");
  for (const file of ["notebook.html", "source_cells.js", "notebook_export.js", "notebook_import.js", "notebook_page.js"])
    assert.ok(routes.includes('path: "web/' + file + '"'), file);
  assert.ok(routes.includes('url == "/notebook"'));
});

test("Notebook page loads its parser, exporter and controller in order", () => {
  const html = read("web/notebook.html");
  const scripts = ["source_cells.js", "notebook_export.js", "notebook_import.js", "notebook_page.js"];
  const offsets = scripts.map(file => {
    const tag = '<script src="/' + file + '"></script>';
    assert.equal(html.split(tag).length - 1, 1, file);
    return html.indexOf(tag);
  });
  assert.deepEqual([...offsets].sort((a, b) => a - b), offsets);
  for (const id of ["source", "language", "importFile", "export", "status"])
    assert.ok(html.includes('id="' + id + '"'), id);
  assert.ok(read("web/notebook_page.js").includes("FlowStudioNotebookExport.buildNotebook"));
});
