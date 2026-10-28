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
  assert.match(html, /const executionLanguage = languageOverride \|\| language\.value/);
  assert.match(html, /\/api\/run\/" \+ executionLanguage \+\s*\n\s*\(backend \? "-" \+ backend : ""\)/);
});

const panels = read("web/workspace_panels.js");

test("Run Project executes the whole open project sequentially with failure stop", () => {
  assert.match(html, /<button id="runProject" /, "topbar exposes a Run Project button");
  assert.match(html, /el\("runProject"\)\.addEventListener\("click"/, "button is wired");
  assert.match(html, /runProject: \(\) => runProject\(\),/, "command palette exposes runProject");
  assert.match(html, /\* Run Project: executes every buffer of the example project that owns the/,
    "runProject is an intentional, documented orchestrator");
  // The sequence reuses the single-run code path so output and plots match.
  assert.match(html,
    /await executeCode\(src\.value, plan\.title \+ " \/ " \+ step\.name,\n\s*step\.language, \{ forceRunGate: true \}\)/,
    "each step runs via executeCode with its own language");
  assert.match(html, /if \(!ran\)\s*\{\s*status\(plan\.title \+ " stopped at " \+ step\.name/, 
    "a failing file stops the sequence");
  // executeCode must report success for the stop-on-failure decision.
  assert.match(html, /let ok = false;\n  try \{/, "executeCode tracks success");
  assert.match(html, /ok = response\.ok;/, "executeCode reports response.ok");
  assert.match(html, /  return ok;\n\}\nasync function run\(\)/, "executeCode returns ok to callers");
  assert.match(html, /el\("run"\)\.disabled && !options\.forceRunGate/, 
    "project runs bypass the single-run button gate");
  // The ordered plan comes from the examples panel because that panel
  // already tracks which open buffers belong to each project.
  assert.match(panels, /exports\.projectRunPlan/, "panel exposes the ordered run plan");
  assert.match(panels, /steps\.push\(\{ id: doc\.id, name: file\.name, language: doc\.language \}\)/,
    "plan steps carry document id, filename and language");
});

test("legacy Reader pipeline text is auto-upgraded on reopen and draft restore", () => {
  assert.match(panels, /Examples\.upgradeFiles/, 
    "reopening a saved project upgrades legacy Flow text");
  assert.match(panels, /const LEGACY_READER_MARKER = "for row in Reader"/,
    "dirty open buffers holding the legacy source are upgraded too");
  assert.match(panels, /function upgradeOpenBuffers/, "buffer-level upgrade helper exists");
  // The upgrade itself lives with the curated text it replaces.
  const gallery = read("web/examples_gallery.js");
  assert.match(gallery, /function upgradeFiles/, "gallery exposes upgradeFiles");
  assert.match(gallery, /const api = \{ examples, validate, mount, upgradeFiles \};/,
    "upgradeFiles stays exported for panels and recovery");
  const recovery = read("web/editor_recovery.js");
  assert.match(recovery, /gallery\.upgradeFiles/, "recovered drafts are upgraded");
  assert.match(recovery, /let draft = pending/, "draft reassignment stays allowed");
});
