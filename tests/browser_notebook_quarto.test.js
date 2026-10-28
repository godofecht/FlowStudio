"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
require("../docs/app/notebook_rmarkdown_import.js");
require("../docs/app/notebook_rmarkdown.js");
const quarto = require("../docs/app/notebook_quarto.js");
const {parseCells} = require("../docs/app/source_cells.js");
const fence = String.fromCharCode(96).repeat(3);

test("exports executable R and Python chunks as real Quarto HTML source", () => {
  const source = "# %% [markdown]\n# Report\n\nText\n" +
    "# %% [r] label=summary\nprint(1)\n" +
    "# %% [python]\nprint('ready')\n";
  const qmd = quarto.encode(source, "r", parseCells);
  assert.match(qmd, /^---\ntitle: "FlowStudio notebook"\nformat: html\n---/);
  assert.ok(qmd.includes(fence + "{r summary}\nprint(1)\n" + fence));
  assert.ok(qmd.includes(fence + "{python}\nprint('ready')\n" + fence));
  assert.doesNotMatch(qmd, /output: html_document|# %%/);
  const restored = quarto.decode(qmd, parseCells);
  assert.deepEqual(parseCells(restored.source).map(cell => [cell.kind,cell.language]),
    [["markdown",null],["code","r"],["code","python"]]);
  assert.equal(parseCells(restored.source)[1].label, "summary");
});

test("preserves supported scalar Quarto YAML and Unicode through roundtrip", () => {
  const qmd = "---\ntitle: 'Résumé'\nauthor: Ada\nformat: html\n---\n\n" +
    fence + "{r analysis}\ncat('μ')\n" + fence + "\n";
  const restored = quarto.decode(qmd, parseCells);
  assert.equal(restored.language, "r");
  assert.equal(restored.metadataDiscarded, false);
  const exported = quarto.encode(restored.source, "r", parseCells);
  assert.match(exported, /^---\ntitle: 'Résumé'\nauthor: Ada\nformat: html\n---/);
  assert.match(exported, /cat\('μ'\)/);
  assert.equal((exported.match(/format:/g) || []).length, 1);
});


test("title-only Quarto frontmatter gains explicit HTML format on export", () => {
  const qmd = "---\ntitle: Notes\n---\n\n" + fence + "{r}\nprint(1)\n" + fence;
  const imported = quarto.decode(qmd, parseCells);
  const exported = quarto.encode(imported.source, "r", parseCells);
  assert.match(exported, /^---\ntitle: Notes\nformat: html\n---/);
  assert.equal((exported.match(/format: html/g) || []).length, 1);
});

test("accepts Quarto documents without YAML using default HTML", () => {
  const restored = quarto.decode("# Heading\n\n" + fence + "{python}\nprint(2)\n" + fence, parseCells);
  assert.equal(restored.language, "python");
  assert.match(quarto.encode(restored.source, "python", parseCells), /format: html/);
});

test("rejects unsupported YAML and unrepresented Quarto source options", () => {
  for (const yaml of [
    "---\nformat: pdf\n---\n",
    "---\nformat:\n  html: default\n---\n",
    "---\nexecute: false\nformat: html\n---\n",
    "---\noutput: html_document\n---\n",
    "---\nformat: html\nformat: html\n---\n"
  ]) assert.throws(() => quarto.decode(yaml + fence + "{r}\n1\n" + fence, parseCells));
  // Literal R eval: false is now safely imported as inert Markdown; see the roundtrip regression below.
  assert.throws(() => quarto.encode("# %% [r]\n#| eval: false\n1\n", "r", parseCells), /chunk options/);
});

test("refuses Quarto shortcodes and executable inline engines", () => {
  for (const content of ["{{< include _secret.qmd >}}", "{{% if true %}}",
    String.fromCharCode(96) + "{r} 1+1" + String.fromCharCode(96)]) {
    assert.throws(() => quarto.decode(content, parseCells), /shortcodes|inline/);
    assert.throws(() => quarto.encode("# %% [markdown]\n" + content, "r", parseCells), /shortcodes|inline/);
  }
});

test("rejects Flow chunks, unsafe knitr options and oversized inputs", () => {
  assert.throws(() => quarto.encode("# %% [flow]\nfunction main() -> i32 { return 0 }", "r", parseCells), /Flow/);
  assert.throws(() => quarto.decode(fence + "{flow}\n1\n" + fence, parseCells), /Unsupported R Markdown chunk/);
  assert.throws(() => quarto.decode(fence + "{r, echo=FALSE}\n1\n" + fence, parseCells), /Unsupported R Markdown chunk/);
  assert.throws(() => quarto.decode("x".repeat(4 * 1024 * 1024 + 1), parseCells), /4 MiB/);
});



test("imports literal Quarto #| label and eval: true into executable R/Python cells", () => {
  for (const language of ["r", "python"]) {
    const qmd = fence + "{" + language + "}\n#| label: summary\n#| eval: true\nprint(42)\n" + fence;
    const imported = quarto.decode(qmd, parseCells);
    const cells = parseCells(imported.source);
    assert.equal(cells.length, 1);
    assert.equal(cells[0].kind, "code");
    assert.equal(cells[0].language, language);
    assert.equal(cells[0].label, "summary");
    assert.match(cells[0].code, /print\(42\)/);
    assert.doesNotMatch(cells[0].code, /#\|/);
    assert.ok(quarto.encode(imported.source, language, parseCells).includes(
      fence + "{" + language + " summary}"));
  }
});

test("literal Quarto R eval: false remains inert through .qmd roundtrip", () => {
  const qmd = fence + "{r}\n#| label: disabled\n#| eval: false\nstop('must not run')\n" + fence;
  const imported = quarto.decode(qmd, parseCells);
  const cells = parseCells(imported.source);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].kind, "markdown");
  assert.match(cells[0].code, /eval=FALSE/);
  assert.match(cells[0].code, /stop\('must not run'\)/);
  const exported = quarto.encode(imported.source, "r", parseCells);
  assert.ok(exported.includes(fence + "{r disabled, eval=FALSE}"));
  assert.doesNotMatch(exported, /#\|/);
});

test("rejects unsupported, duplicate and late Quarto options without source mutation", () => {
  for (const option of [
    "#| echo: false", "#| eval: TRUE", "#| eval: x",
    "#| label: unsafe name", "#| label: x\n#| label: y",
    "#| eval: true\n#| eval: false"
  ]) assert.throws(() => quarto.decode(fence + "{r}\n" + option + "\n1\n" + fence, parseCells), /Quarto/);
  assert.throws(() => quarto.decode(fence + "{r existing}\n#| label: other\n1\n" + fence, parseCells), /Duplicate Quarto/);
  assert.throws(() => quarto.decode(fence + "{r}\n1\n#| eval: false\n" + fence, parseCells), /must precede/);
  assert.throws(() => quarto.decode(fence + "{python}\n#| eval: false\nprint(1)\n" + fence, parseCells), /Python/);
  assert.match(quarto.decode(fence + "text\n#| echo: false\n" + fence, parseCells).source, /#\| echo: false/);
  assert.throws(() => quarto.decode(fence + "{r, eval=FALSE}\n#| eval: true\n1\n" + fence, parseCells),
    /disabled chunks/);
  assert.throws(() => quarto.encode("# %% [markdown]\n" + fence + "{r, eval=FALSE}\n#| eval: true\n1\n" + fence, "r", parseCells),
    /disabled chunks/);
});

test("notebook file controller imports .qmd without executing or discarding unsaved edits", async () => {
  const {create} = require("../docs/app/notebook_io.js");
  function control() {
    const handlers = {};
    return {addEventListener(event, callback) { handlers[event] = callback; },
      click() { return handlers.click?.(); },
      change(files) { return handlers.change({target:{files, value:"old"}}); }};
  }
  const openButton = control(), fileInput = control(), saveButton = control();
  const quartoOpenButton = control(), quartoFileInput = control();
  const imported = [], notices = [];
  let busy = false, allow = true;
  create({openButton,fileInput,saveButton,quartoOpenButton,quartoFileInput,quarto,
    source:{value:"keep"},language:{value:"r"},format:{MAX_JSON_BYTES:4194304},
    parseCells,isBusy:()=>busy,canReplace:()=>allow,
    onImported:async (value,name)=>imported.push({value,name}),
    onExport:()=>{throw new Error("Unexpected export");},getResults:()=>[],
    getFilename:()=>"untitled.R",notice:message=>notices.push(message)});
  const qmd = "---\ntitle: test\nformat: html\n---\n\n" +
    fence + "{r}\nprint(42)\n" + fence;
  const file = {name:"study.qmd",size:new TextEncoder().encode(qmd).length,text:async()=>qmd};
  busy = true;
  await quartoFileInput.change([file]);
  busy = false; allow = false;
  await quartoFileInput.change([file]);
  allow = true;
  await quartoFileInput.change([file]);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].name, "study.qmd");
  assert.match(imported[0].value.source,/print\(42\)/);
  assert.match(notices.join(" "),/no code was executed/);
  assert.match(notices.join(" "),/Wait for notebook execution/);
  await quartoFileInput.change([{...file,size:4194305}]);
  assert.match(notices.join(" "),/exceeds 4 MiB/);
});

test("browser has wired import/export controls and syntactically valid script", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  for (const id of ["openQuarto","quartoFile","exportQuarto"])
    assert.ok(html.includes('id="' + id + '"'));
  assert.match(html, /src="\.\/notebook_quarto\.js"/);
  assert.match(html, /quarto:FlowStudioQuarto/);
  assert.match(html, /FlowStudioQuarto\.encode\(currentSource, selectedLanguage/);
  assert.match(html, /anchor\.download = reportName \+ "\.qmd"/);
  const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(inline);
  assert.doesNotThrow(() => new vm.Script(inline[1]));
});
