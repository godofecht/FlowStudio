"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("native Quarto rendering uses Flow-owned route and the real installed CLI helper", () => {
  const flow = fs.readFileSync(path.join(__dirname, "../src/main.flow"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  const helper = fs.readFileSync(path.join(__dirname, "../scripts/quarto_render.py"), "utf8");
  assert.match(flow, /if eq\(path, "\/api\/render\/quarto"\)/);
  assert.match(flow, /send_quarto_render\(fs_body\(\)\)/);
  assert.match(flow, /proc_arg\(command, "scripts\/quarto_render\.py"\)/);
  assert.match(flow, /proc_timeout_ms\(command, 60000\)/);
  assert.match(html, /id="renderQuarto"/);
  assert.match(html, /window\.confirm\("Render with the installed Quarto CLI\?/);
  assert.match(html, /FlowStudioQuarto\.encode\(renderedSource, renderedLanguage/);
  assert.match(html, /const renderedSource = \$\("source"\)\.value/);
  assert.match(html, /anchor\.download = renderReportName \+ "\.html"/);
  assert.match(html, /the editor changed during rendering/);
  assert.match(html, /fetch\("\/api\/render\/quarto"/);
  assert.match(html, /"X-FlowStudio-Intent": "run"/);
  assert.match(helper, /subprocess\.Popen\(/);
  assert.match(helper, /os\.killpg\(process\.pid, signal\.SIGKILL\)/);
  assert.match(helper, /"render", "report\.qmd", "--to", "html"/);
  assert.doesNotMatch(helper, /shell=True/);
  const packaging = fs.readFileSync(path.join(__dirname, "../scripts/package.sh"), "utf8");
  assert.match(packaging, /cp scripts\/quarto_render\.py "\$stage\/\$name\/scripts\/quarto_render\.py"/);
});

test("native Quarto rendering is not exposed through GitHub Pages", () => {
  const pages = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(pages, /if \(!nativeAvailable\)/);
  assert.match(pages, /if \(!window\.confirm\(/);
});
