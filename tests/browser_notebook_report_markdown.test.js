"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const report = require("../docs/app/notebook_report.js");
const notebook = cells => JSON.stringify({nbformat:4, cells});

test("fenced R/Python/Flow code remains inert and escapes raw HTML", () => {
  const html = report.markdown("\`\`\`python\nprint('<script>')\n\`\`\`\n\n~~~r\nx <- 1\n~~~\n\n\`\`\`flow\nprintln(\"hi\")\n\`\`\`");
  assert.match(html, /<pre><code class="language-python">print\(&#39;&lt;script&gt;&#39;\)<\/code><\/pre>/);
  assert.match(html, /<pre><code class="language-r">x &lt;- 1<\/code><\/pre>/);
  assert.match(html, /<pre><code class="language-flow">println\(&quot;hi&quot;\)<\/code><\/pre>/);
  assert.doesNotMatch(html, /<script>/);
});
test("fences close only with matching character and sufficient length", () => {
  const html = report.markdown("~~~~r\nx <- 1\n~~~\n\`\`\`\n~~~~");
  assert.match(html, /x &lt;- 1\n~~~\n\`\`\`<\/code>/);
});
test("unterminated code fences are emitted as escaped code, not dropped", () => {
  const html = report.markdown("\`\`\`r\nx <- '<img>'");
  assert.match(html, /<pre><code class="language-r">x &lt;- &#39;&lt;img&gt;&#39;<\/code><\/pre>/);
});
test("untrusted fence info cannot become an HTML attribute", () => {
  const html = report.markdown('\`\`\`html" onclick="alert(1)\n<script>\n\`\`\`');
  assert.match(html, /<pre><code>&lt;script&gt;<\/code><\/pre>/);
  assert.doesNotMatch(html, /onclick=/);
});
test("inline backtick code is escaped and unmatched delimiters stay literal", () => {
  const html = report.markdown("Use \`x < y\` and \`\`a \` b\`\` then \`unfinished");
  assert.match(html, /<code>x &lt; y<\/code>/);
  assert.match(html, /<code>a \` b<\/code>/);
  assert.match(html, /\`unfinished/);
});
test("ordered and unordered lists, quotes and thematic breaks render distinctly", () => {
  const html = report.markdown("1. one\n2. two\n- three\n- four\n\n> <script>\n> next\n\n---");
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(html, /<ul><li>three<\/li><li>four<\/li><\/ul>/);
  assert.match(html, /<blockquote><p>&lt;script&gt;<br>next<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
});
test("Jupyter text/markdown output renders without executing HTML or external links", () => {
  const html = report.render(notebook([{cell_type:"code", source:"x", outputs:[
    {output_type:"display_data", data:{"text/markdown":"# Result\n\`\`\`r\nx <- 1\n\`\`\`\n<script>alert(1)</script>\n[link](https://evil.example)"}}
  ]}]));
  assert.match(html, /<div class="markdown-output">/);
  assert.match(html, /<pre><code class="language-r">x &lt;- 1<\/code><\/pre>/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<a href=/);
  assert.match(html, /default-src 'none'/);
});
test("Markdown output takes precedence over plain-text fallback", () => {
  const html = report.render(notebook([{cell_type:"code", source:"x", outputs:[
    {output_type:"execute_result", data:{"text/markdown":"# Markdown","text/plain":"FALLBACK"}}
  ]}]));
  assert.match(html, /<h1>Markdown<\/h1>/);
  assert.doesNotMatch(html, /FALLBACK/);
});
test("Markdown output rejects malformed or oversized MIME values", () => {
  const output = value => notebook([{cell_type:"code", source:"x", outputs:[
    {output_type:"display_data", data:{"text/markdown":value}}
  ]}]);
  assert.throws(() => report.render(output({html:"bad"})), /Invalid notebook text/);
  assert.throws(() => report.render(output("x".repeat(131073))), /Output exceeds 128 KiB/);
});
