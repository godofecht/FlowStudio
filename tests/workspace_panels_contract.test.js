"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const html = read("web/index.html");
const routes = read("src/data_routes.flow");
const main = read("src/main.flow");

test("sidebar panels load in dependency order behind the console stack", () => {
  const order = ["/terminal_render.js", "/console.js", "/workspace_console.js",
    "/packages_panel.js", "/examples_gallery.js", "/debug_panel.js",
    "/workspace_panels.js", "/ui/workbench.js"];
  let last = -1;
  for (const tag of order) {
    const at = html.indexOf('<script' + (tag === "/ui/workbench.js" ? " type=\"module\"" : "") + ' src="' + tag + '">');
    assert.ok(at > last, tag + " must load after the previous script");
    last = at;
  }
  for (const tag of ["/packages_panel.js", "/examples_gallery.js",
    "/debug_panel.js", "/workspace_panels.js", "/terminal_render.js"]) {
    assert.ok(html.split('<script src="' + tag + '"></script>').length - 1 === 1,
      tag + " loads exactly once");
  }
  // The completion core is imported by the bundled workbench rather than through a script tag.
  assert.match(read("frontend/completion.js"), /import '\/ide_completion_core\.js';/);
});

test("every workspace script tag has an explicit allowlisted route", () => {
  for (const tag of ["/packages_panel.js", "/examples_gallery.js",
    "/debug_panel.js", "/workspace_panels.js", "/ide_completion_core.js",
    "/terminal_render.js"]) {
    assert.ok(routes.includes('if url == "' + tag + '"'), tag + " route allowlisted");
  }
});

test("MLIR backend is a real compiler invocation behind an explicit route", () => {
  assert.match(main, /--backend=" \+ backend/);
  assert.match(main, /if eq\(path, "\/api\/run\/flow-mlir"\)/);
  assert.match(main, /send_execution\("flow", fs_body\(\), "mlir"\)/);
  // The plain Flow route and the compile check must not regress to MLIR.
  assert.match(main, /send_execution\("flow", fs_body\(\), ""\)/);
  assert.match(main, /execute\("flow", code, true, ""\)/);
  assert.match(html, /<select id="flowBackend"[\s\S]*?<option value="mlir">MLIR/);
  assert.match(html, /\/api\/run\/" \+ language\.value \+\s*\n\s*\(backend \? "-" \+ backend : ""\)/);
});
