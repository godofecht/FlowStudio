/* The Help pane for Flow, in the side panel next to Environment.
 *
 * F1 in a Flow buffer opens help for the name under the cursor; the search
 * box looks up any name or guide topic. Two sources answer:
 *
 *   - the Flow language server's hover at the cursor (typechecked signature
 *     and doc comment), when `flow lsp` runs (web/ide_flow_lsp.js)
 *   - POST /api/flow/help (src/flow_help.py): the toolchain's standard
 *     library declarations and doc comments, the language server's notes
 *     on built-ins and keywords, and the compiled examples and sections of
 *     docs/FLOW_FOR_AI.md
 *
 * Text is rendered with DOM nodes only. The small Markdown reader below
 * knows fenced code, bullets, paragraphs, `code`, **strong** and *em*. */
(function (root) {
"use strict";

const ROUTE = "/api/flow/help";
const QUERY = /^[^\u0000-\u001f]{0,80}$/;
const WORD = /[A-Za-z_][A-Za-z0-9_]*/g;

/* ---------- pure helpers (unit tested) ---------- */

/* The identifier that covers a 1-based column of a line, or "". */
function wordAt(line, column) {
  const text = String(line || "");
  const at = Math.max(0, Number(column) - 1);
  WORD.lastIndex = 0;
  let match;
  while ((match = WORD.exec(text))) {
    if (at >= match.index && at <= match.index + match[0].length) return match[0];
  }
  return "";
}

function validQuery(text) {
  return typeof text === "string" && QUERY.test(text);
}

/* Inline spans of one line of Markdown. */
function inline(text) {
  const spans = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\([^)]*\)/g;
  let last = 0, match;
  const source = String(text || "");
  while ((match = pattern.exec(source))) {
    if (match.index > last) spans.push({ type: "text", text: source.slice(last, match.index) });
    if (match[1] != null) spans.push({ type: "code", text: match[1] });
    else if (match[2] != null) spans.push({ type: "strong", text: match[2] });
    else if (match[3] != null) spans.push({ type: "em", text: match[3] });
    else spans.push({ type: "text", text: match[4] });
    last = pattern.lastIndex;
  }
  if (last < source.length) spans.push({ type: "text", text: source.slice(last) });
  return spans;
}

/* Blocks of a Markdown text: code, list (of inline span lists) and para. */
function blocks(markdown) {
  const out = [];
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let para = null, list = null;
  const flush = () => {
    if (para) out.push({ type: "para", spans: inline(para.join(" ")) });
    if (list) out.push({ type: "list", items: list.map(item => inline(item)) });
    para = null;
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```\s*([A-Za-z0-9_-]*)/.exec(line);
    if (fence) {
      flush();
      const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      out.push({ type: "code", lang: fence[1] || "", text: code.join("\n") });
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      if (para) flush();
      if (!list) list = [];
      list.push(bullet[1]);
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading) { flush(); out.push({ type: "para", spans: [{ type: "strong", text: heading[1] }] }); continue; }
    if (list) { list[list.length - 1] += " " + trimmed; continue; }
    if (!para) para = [];
    para.push(trimmed);
  }
  flush();
  return out;
}

/* The help reply checked and trimmed to what the pane draws. */
function normalizeReply(reply) {
  if (!reply || reply.ok !== true) return null;
  const text = value => typeof value === "string" ? value : "";
  const example = item => item && typeof item.code === "string" ?
    { title: text(item.title), code: item.code, output: text(item.output) } : null;
  const entries = (Array.isArray(reply.entries) ? reply.entries : []).slice(0, 8)
    .filter(entry => entry && typeof entry.name === "string")
    .map(entry => ({
      name: entry.name, kind: text(entry.kind), signature: text(entry.signature), doc: text(entry.doc),
      source: text(entry.source), path: text(entry.path), line: Number(entry.line) || 0, usage: text(entry.usage),
      examples: (Array.isArray(entry.examples) ? entry.examples : []).map(example).filter(Boolean).slice(0, 3)
    }));
  const related = (Array.isArray(reply.related) ? reply.related : []).slice(0, 60)
    .filter(item => item && typeof item.name === "string")
    .map(item => ({ name: item.name, kind: text(item.kind), source: text(item.source), summary: text(item.summary) }));
  return { query: text(reply.query), entries, related };
}

/* ---------- DOM ---------- */
function mount(doc, options = {}) {
  const host = doc.getElementById(options.hostId || "flowHelp");
  if (!host) return null;
  const request = options.fetch || (typeof root.fetch === "function" ? (url, init) => root.fetch(url, init) : null);
  const sidePanel = () => options.sidePanel || root.FlowStudioSidePanel || null;
  const h = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const form = h("form", "fh-search");
  form.setAttribute("role", "search");
  const input = h("input", "fh-input");
  input.type = "search";
  input.id = "flowHelpSearch";
  input.placeholder = "Search Flow help";
  input.setAttribute("aria-label", "Search Flow help");
  input.maxLength = 80;
  input.autocomplete = "off";
  input.spellcheck = false;
  const go = h("button", "fh-go", "Search");
  go.type = "submit";
  form.append(input, go);
  const result = h("div", "fh-result");
  result.id = "flowHelpResult";
  result.setAttribute("aria-live", "polite");
  host.replaceChildren(form, result);

  let generation = 0;
  form.addEventListener("submit", event => {
    event.preventDefault();
    void lookup(input.value.trim());
  });

  function spansInto(parent, spans) {
    for (const span of spans) {
      if (span.type === "code") parent.append(h("code", "", span.text));
      else if (span.type === "strong") parent.append(h("strong", "", span.text));
      else if (span.type === "em") parent.append(h("em", "", span.text));
      else parent.append(doc.createTextNode(span.text));
    }
  }
  function markdownInto(parent, markdown, codeClass) {
    for (const block of blocks(markdown)) {
      if (block.type === "code") {
        const pre = h("pre", codeClass || "fh-code");
        pre.append(h("code", "", block.text));
        parent.append(pre);
      } else if (block.type === "list") {
        const list = h("ul", "fh-list");
        for (const item of block.items) { const li = h("li"); spansInto(li, item); list.append(li); }
        parent.append(list);
      } else {
        const p = h("p");
        spansInto(p, block.spans);
        parent.append(p);
      }
    }
  }
  function linkButton(name, label) {
    const button = h("button", "fh-link", label || name);
    button.type = "button";
    button.addEventListener("click", () => { input.value = name; void lookup(name); });
    return button;
  }
  function renderEntry(entry) {
    const article = h("article", "fh-entry");
    article.dataset.kind = entry.kind;
    const head = h("header", "fh-head");
    head.append(h("h3", "fh-name", entry.name), h("span", "fh-kind", entry.kind === "guide" ? "guide" : entry.kind));
    article.append(head);
    const where = entry.source + (entry.path ? " · " + entry.path + (entry.line ? ":" + entry.line : "") : "");
    if (where.trim()) article.append(h("p", "fh-source", where));
    if (entry.signature) {
      const pre = h("pre", "fh-signature");
      pre.append(h("code", "", entry.signature));
      article.append(pre);
    }
    if (entry.doc) {
      const docs = h("div", "fh-doc");
      markdownInto(docs, entry.doc);
      article.append(docs);
    } else if (entry.kind !== "guide") {
      article.append(h("p", "fh-doc fh-muted", "No doc comment."));
    }
    if (entry.usage) {
      const usage = h("p", "fh-usage", "Import: ");
      usage.append(h("code", "", entry.usage));
      article.append(usage);
    }
    if (entry.examples.length) {
      article.append(h("h4", "fh-subhead", entry.examples.length === 1 ? "Example" : "Examples"));
      for (const example of entry.examples) {
        const figure = h("figure", "fh-example");
        if (example.title) figure.append(h("figcaption", "", "From the guide: " + example.title));
        const pre = h("pre", "fh-code");
        pre.append(h("code", "", example.code));
        figure.append(pre);
        if (example.output) {
          figure.append(h("div", "fh-output-label", "Output"));
          const out = h("pre", "fh-output");
          out.append(h("code", "", example.output));
          figure.append(out);
        }
        article.append(figure);
      }
    }
    return article;
  }
  function renderHover(name, hover) {
    const section = h("section", "fh-entry fh-hover");
    section.dataset.kind = "hover";
    const head = h("header", "fh-head");
    head.append(h("h3", "fh-name", name), h("span", "fh-kind", "at cursor"));
    section.append(head, h("p", "fh-source", "Flow language server"));
    const docs = h("div", "fh-doc");
    for (const text of hover) markdownInto(docs, text, "fh-signature");
    section.append(docs);
    return section;
  }
  function render(name, hover, reply) {
    const nodes = [];
    if (hover && hover.length) nodes.push(renderHover(name, hover));
    if (reply) {
      for (const entry of reply.entries) nodes.push(renderEntry(entry));
      if (!nodes.length && name)
        nodes.push(h("p", "fh-empty", "No Flow help for " + name + "."));
      if (reply.related.length) {
        const box = h("section", "fh-related");
        box.append(h("h4", "fh-subhead", name ? "Related" : "Guide topics"));
        const list = h("ul", "fh-related-list");
        for (const item of reply.related) {
          const li = h("li");
          li.append(linkButton(item.name));
          if (item.summary && item.kind !== "guide") li.append(h("span", "fh-summary", item.summary));
          list.append(li);
        }
        box.append(list);
        nodes.push(box);
      }
    } else if (!nodes.length) {
      nodes.push(h("p", "fh-empty", "Flow help is not available. The server did not answer."));
    }
    result.replaceChildren(...nodes);
    result.scrollTop = 0;
  }

  async function fetchHelp(query) {
    if (!request) return null;
    try {
      const response = await request(ROUTE, { method: "POST", body: query,
        headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" } });
      if (!response.ok) return null;
      return normalizeReply(JSON.parse(await response.text()));
    } catch (_) { return null; }
  }

  /* Look a name up and draw it. `hover` is the language server's Markdown
   * for the cursor, when F1 brought us here. */
  async function lookup(query, hover) {
    const name = String(query || "").trim();
    if (!validQuery(name)) return false;
    const mine = ++generation;
    host.dataset.state = "loading";
    host.dataset.query = name;
    result.replaceChildren(h("p", "fh-empty", name ? "Looking up " + name + " …" : "Loading topics …"));
    const reply = await fetchHelp(name);
    if (mine !== generation) return false;
    render(name, hover, reply);
    host.dataset.state = "ready";
    return true;
  }

  /* On a narrow window the layout keeps the side panel hidden, so the pane
   * moves into a dialog until it is closed. */
  const home = host.parentNode;
  let overlay = null;
  function overlayDialog() {
    if (overlay) return overlay;
    overlay = h("dialog", "fh-dialog");
    overlay.id = "flowHelpDialog";
    overlay.setAttribute("aria-label", "Flow help");
    const bar = h("div", "fh-dialog-head");
    const close = h("button", "fh-close", "Close");
    close.type = "button";
    close.addEventListener("click", () => overlay.close());
    bar.append(h("span", "fh-dialog-title", "Flow help"), close);
    overlay.append(bar);
    overlay.addEventListener("close", () => { if (home) home.append(host); });
    doc.body.append(overlay);
    return overlay;
  }
  function show() {
    const panel = sidePanel();
    if (panel && typeof panel.show === "function") panel.show("help");
    const right = doc.getElementById("rightPanel");
    const hidden = !right || right.getAttribute("aria-hidden") === "true" ||
      (right.offsetWidth === 0 && right.offsetHeight === 0);
    if (!hidden || typeof doc.createElement("dialog").showModal !== "function") return;
    const dialog = overlayDialog();
    dialog.append(host);
    if (!dialog.open) dialog.showModal();
  }

  /* F1: help for the name under the cursor of a Flow buffer. */
  async function helpAtCursor(editor) {
    show();
    const model = editor && editor.getModel && editor.getModel();
    const position = editor && editor.getPosition && editor.getPosition();
    if (!model || !position) { input.focus(); return false; }
    const name = wordAt(model.getLineContent(position.lineNumber), position.column);
    if (!name) { input.focus(); return lookup(""); }
    input.value = name;
    const lsp = root.FlowStudioFlowLsp;
    let hover = null;
    if (lsp && typeof lsp.hover === "function" && lsp.state && lsp.state() === "ready") {
      const mine = generation;
      host.dataset.state = "loading";
      try {
        const found = await Promise.race([lsp.hover(model, position),
          new Promise(resolve => setTimeout(() => resolve(null), 4000))]);
        hover = found && Array.isArray(found.contents) ? found.contents.map(item => item.value).filter(Boolean) : null;
      } catch (_) { hover = null; }
      if (mine !== generation) return false;
    }
    return lookup(name, hover);
  }

  /* Opening the tab with nothing shown lists the guide topics. */
  const tab = doc.getElementById("rpTab-help");
  if (tab) tab.addEventListener("click", () => { if (!host.dataset.state) void lookup(""); });

  return Object.freeze({ lookup, helpAtCursor, show, input, result,
    open(name) { show(); if (name) input.value = name; else input.focus(); return lookup(name || ""); } });
}

/* F1 belongs to Flow help in Flow buffers; other languages keep Monaco's
 * command palette. */
function bindF1(monaco, editor, help) {
  if (!monaco || !editor || !help || typeof editor.addCommand !== "function") return false;
  editor.addCommand(monaco.KeyCode.F1, () => {
    const model = editor.getModel();
    if (model && model.getLanguageId && model.getLanguageId() === "flow") void help.helpAtCursor(editor);
    else editor.trigger("flowstudio", "editor.action.quickCommand", null);
  });
  return true;
}

const api = { mount, bindF1, wordAt, validQuery, inline, blocks, normalizeReply, ROUTE };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.FlowStudioFlowHelpModule = api;
if (typeof document !== "undefined" && document.getElementById("flowHelp")) {
  try {
    const help = mount(document);
    root.FlowStudioFlowHelp = help;
    const bind = () => {
      const host = root.FlowStudioEditor;
      if (host && host.editor && root.FlowStudioMonaco) bindF1(root.FlowStudioMonaco, host.editor, help);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
    else bind();
  } catch (error) {
    if (root.console) root.console.error("FlowStudio Flow help failed to mount: " + (error && error.message));
  }
}
})(typeof globalThis !== "undefined" ? globalThis : this);
