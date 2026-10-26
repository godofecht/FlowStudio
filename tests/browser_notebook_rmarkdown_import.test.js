"use strict";
(function registerTests() {
  const test = require("node:test");
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const {decode} = require("../docs/app/notebook_rmarkdown_import.js");
  const {encode} = require("../docs/app/notebook_rmarkdown.js");
  const {parseCells} = require("../docs/app/source_cells.js");
  const {create} = require("../docs/app/notebook_io.js");
  const tick = String.fromCharCode(96);
  function button() {
    const handlers = {};
    return {
      addEventListener(type, handler) { handlers[type] = handler; },
      click() { return handlers.click?.(); },
      change(files) { return handlers.change({target:{files, value:"previous"}}); }
    };
  }
  function controls(options = {}) {
    const openButton = button(), fileInput = button(), saveButton = button();
    const rMarkdownOpenButton = button(), rMarkdownFileInput = button();
    const messages = [], imported = [];
    let busy = false, allow = true;
    create({openButton, fileInput, saveButton, rMarkdownOpenButton, rMarkdownFileInput,
      rMarkdown:{decode}, source:{value:"keep"}, language:{value:"r"},
      format:{MAX_JSON_BYTES:4*1024*1024}, parseCells,
      isBusy:() => busy, canReplace:() => allow,
      onImported:async (value,name) => imported.push({value,name}),
      onExport:() => { throw new Error("Unexpected export"); },
      getResults:() => [], getFilename:() => "untitled.R",
      notice:message => messages.push(message)});
    return {rMarkdownOpenButton, rMarkdownFileInput, messages, imported,
      busy(value) { busy = value; }, allow(value) { allow = value; }};
  }
  function file(text, name = "analysis.Rmd") {
    return {name, size:new TextEncoder().encode(text).length, text:async () => text};
  }
  test("imports exported R/Python Markdown cells without executing source", () => {
    const source = "# %% [markdown]\n# Analysis\n\nText\n" +
      "# %% [r]\nx <- 4\n" + "# %% [python]\nprint('hi')\n";
    const imported = decode(encode(source, "r", parseCells), parseCells);
    const cells = parseCells(imported.source);
    assert.equal(imported.language, "r");
    assert.equal(imported.metadataDiscarded, true);
    assert.deepEqual(cells.map(cell => [cell.kind,cell.language]),
      [["markdown",null],["code","r"],["code","python"]]);
    assert.match(cells[1].code, /x <- 4/);
    assert.match(cells[2].code, /print\('hi'\)/);
  });
  test("accepts scalar YAML and CRLF, selecting Python for Python-first chunks", () => {
    const input = "---\r\ntitle: 'Résumé'\r\nauthor: Ada\r\ndate: 2026-10-26\r\noutput: html_document\r\n---\r\n\r\n" +
      tick.repeat(3) + "{python}\r\nprint('μ')\r\n" + tick.repeat(3) + "\r\n";
    const imported = decode(input, parseCells);
    assert.equal(imported.language, "python");
    assert.equal(imported.metadataDiscarded, true);
    assert.equal(parseCells(imported.source)[0].language, "python");
    assert.match(imported.source, /μ/);
    assert.doesNotMatch(imported.source, /\r/);
  });
  test("preserves ordinary fenced Markdown as inert Markdown", () => {
    const input = "# Documentation\n\n" + tick.repeat(4) + "json\n{\"x\": 1}\n" +
      tick.repeat(4) + "\n\n" + tick.repeat(3) + "{r}\nprint(1)\n" + tick.repeat(3) + "\n";
    const cells = parseCells(decode(input, parseCells).source);
    assert.equal(cells.length, 2);
    assert.equal(cells[0].kind, "markdown");
    assert.match(cells[0].code, /json\n\{"x": 1\}/);
    assert.equal(cells[1].language, "r");
  });
  test("recognizes long backtick and tilde chunk fences", () => {
    for (const symbol of [tick, "~"]) {
      const fence = symbol.repeat(5);
      const input = fence + "{r}\ncat('" + tick.repeat(4) + "')\n" + fence + "\n";
      const cells = parseCells(decode(input, parseCells).source);
      assert.equal(cells.length, 1);
      assert.match(cells[0].code, /cat\(/);
    }
  });
  test("rejects unsupported knitr engines, options and unterminated chunks", () => {
    for (const header of ["{bash}", "{r, echo=FALSE}", "{python analysis}", "{flow}"]) {
      assert.throws(() => decode(tick.repeat(3) + header + "\nx\n" + tick.repeat(3), parseCells),
        /Unsupported R Markdown chunk/);
    }
    assert.throws(() => decode(tick.repeat(3) + "{r}\nprint(1)", parseCells),
      /Unterminated/);
  });
  test("rejects unsupported or malformed YAML rather than dropping semantics", () => {
    assert.throws(() => decode("---\nparams:\n  x: 1\n---\nHello", parseCells), /metadata/);
    assert.throws(() => decode("---\noutput: pdf_document\n---\nHello", parseCells), /html_document/);
    assert.throws(() => decode("---\ntitle: hello\nHello", parseCells), /not terminated/);
  });
  test("rejects percent markers and oversized source without changing code", () => {
    assert.throws(() => decode(tick.repeat(3) + "{r}\n# %% [r]\n" + tick.repeat(3), parseCells),
      /percent-cell marker/);
    assert.throws(() => decode("x\0", parseCells), /NUL/);
    assert.throws(() => decode("x".repeat(4*1024*1024+1), parseCells), /4 MiB/);
    assert.throws(() => decode(tick.repeat(3) + "{r}\n" + "x".repeat(65537) +
      "\n" + tick.repeat(3), parseCells), /64 KiB/);
    assert.throws(() => decode(Array(257).fill(tick.repeat(3) + "{r}\nx\n" +
      tick.repeat(3)).join("\n"), parseCells), /256 cells/);
  });
  test("browser controller imports real Rmd data and reports discarded YAML", async () => {
    const ui = controls();
    const input = "---\ntitle: test\noutput: html_document\n---\n\n" +
      tick.repeat(3) + "{r}\nx <- 7\n" + tick.repeat(3);
    await ui.rMarkdownFileInput.change([file(input)]);
    assert.equal(ui.imported.length, 1);
    assert.equal(ui.imported[0].name, "analysis.Rmd");
    assert.match(ui.imported[0].value.source, /x <- 7/);
    assert.match(ui.messages.join(" "), /YAML metadata was not retained/);
    assert.match(ui.messages.join(" "), /no code was executed/);
  });
  test("browser controller refuses busy, oversized and unconfirmed imports", async () => {
    const ui = controls(), input = tick.repeat(3) + "{r}\nprint(1)\n" + tick.repeat(3);
    ui.busy(true);
    await ui.rMarkdownFileInput.change([file(input)]);
    ui.busy(false);
    ui.allow(false);
    await ui.rMarkdownFileInput.change([file(input)]);
    ui.allow(true);
    await ui.rMarkdownFileInput.change([{name:"huge.Rmd",size:4*1024*1024+1,text:async()=>input}]);
    await ui.rMarkdownFileInput.change([file(tick.repeat(3) + "{sql}\nx\n" + tick.repeat(3))]);
    assert.equal(ui.imported.length, 0);
    assert.match(ui.messages.join(" "), /Wait for notebook execution/);
    assert.match(ui.messages.join(" "), /exceeds 4 MiB/);
    assert.match(ui.messages.join(" "), /import failed/);
  });
  test("browser R Markdown import controls and bootstrap remain syntactically valid", () => {
    const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
    for (const id of ["openRMarkdown","rMarkdownFile"])
      assert.ok(html.includes('id="' + id + '"'));
    assert.ok(html.includes('src="./notebook_rmarkdown_import.js"'));
    assert.ok(html.includes('rMarkdown:typeof FlowStudioRMarkdownImport === "undefined" ? null : FlowStudioRMarkdownImport'));
    assert.match(html, /ipynb\|fsnb\|rmd/);
    const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/);
    assert.ok(inline);
    assert.doesNotThrow(() => new vm.Script(inline[1]));
  });
})();
