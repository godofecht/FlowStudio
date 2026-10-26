"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml, applySgr, render, MAX_RENDERED } = require("../web/terminal_render.js");

test("render escapes all HTML-significant characters", () => {
  const html = render('<script>alert("x&it\'s")</script>');
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&amp;it&#39;s&quot;\)&lt;\/script&gt;/);
});

test("basic SGR colors map to theme classes with balanced spans", () => {
  assert.equal(render("\x1b[31mred\x1b[0m plain"), '<span class="fs-red">red</span> plain');
  assert.equal(render("\x1b[32;1mgreen bold\x1b[0m"), '<span class="fs-green fs-bold">green bold</span>');
  assert.equal(render("a\x1b[1mb"), 'a<span class="fs-bold">b</span>');
});

test("unsupported SGR codes are dropped without leaking escape bytes", () => {
  assert.equal(render("\x1b[38;5;123mgrey"), "grey");
  assert.doesNotMatch(render("\x1b[38;5;123mgrey"), /\x1b/);
});

test("bold and dim compose and reset clears them", () => {
  assert.deepEqual(applySgr([31], []), ["fs-red"]);
  assert.deepEqual(applySgr([1], ["fs-red"]), ["fs-red", "fs-bold"]);
  assert.deepEqual(applySgr([22], ["fs-red", "fs-bold"]), ["fs-red"]);
  assert.deepEqual(applySgr([0], ["fs-red", "fs-bold"]), []);
});

test("color state persists across newlines like a real terminal", () => {
  const html = render("\x1b[36mcyan\nstill cyan\x1b[0m\nplain");
  assert.ok((html.match(/fs-cyan/g) || []).length >= 2);
  assert.match(html, /plain/);
});

test("prompt lines get the prompt class", () => {
  assert.match(render("> python [console]\nready"), /class="fs-prompt-line"/);
  assert.doesNotMatch(render("not a prompt"), /fs-prompt-line/);
});

test("error lines get the error class without needing ANSI", () => {
  assert.match(render("Traceback (most recent call last):"), /fs-error-line/);
  assert.match(render("TypeError: bad type"), /fs-error-line/);
  assert.match(render("error: unknown flag\nProcess exited"), /fs-error-line/g);
  assert.doesNotMatch(render("valueError is fine"), /fs-error-line/);
});

test("non-SGR control sequences and OSC strings are stripped", () => {
  assert.equal(render("\x1b[2Jclear\x1b]0;title\x07done"), "cleardone");
});

test("oversized buffers render only the trailing MAX_RENDERED bytes", () => {
  const long = "x".repeat(MAX_RENDERED + 10) + "tail";
  const html = render(long);
  assert.ok(html.length <= MAX_RENDERED);
  assert.match(html, /tail$/);
  assert.ok((html.match(/x/g) || []).length < MAX_RENDERED);
  assert.doesNotMatch(html, /undefined/);
});

test("module only exports its explicit surface", () => {
  assert.deepEqual(Object.keys(require("../web/terminal_render.js")),
    ["escapeHtml", "applySgr", "render", "MAX_RENDERED"]);
});
