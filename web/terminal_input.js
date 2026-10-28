/* FlowStudio terminal prompt: an integrated, syntax-highlighted command editor.
 *
 * The prompt is not anchored chrome: workspace_console.js places it inside the
 * scrollable transcript as the next logical line after the latest output.
 * Input stays a real <textarea> (native caret, IME composition, selection and
 * clipboard), while a highlight overlay painted underneath colors Flow, Python
 * and R syntax. The overlay is presentation only; submitted code is always the
 * plain textarea value, never the highlighted markup.
 */
(function (root) {
"use strict";
const MAX_HIGHLIGHTED = 32768;   // Characters colorized before falling back to plain escape.

/* Resilient escape: the terminal renderer may not have loaded yet. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const KEYWORDS = Object.freeze({
  flow: new Set(["function", "let", "mut", "return", "if", "elif", "else", "for",
    "in", "to", "while", "break", "continue", "struct", "export", "extern",
    "enum", "match", "as", "and", "or", "not", "import", "true", "false", "null"]),
  python: new Set(["def", "class", "import", "from", "as", "if", "elif", "else",
    "for", "while", "break", "continue", "pass", "return", "yield", "with",
    "try", "except", "finally", "raise", "lambda", "global", "nonlocal", "del",
    "and", "or", "not", "is", "in", "True", "False", "None", "async", "await",
    "match", "case"]),
  r: new Set(["function", "if", "else", "for", "while", "repeat", "in", "next",
    "break", "return", "TRUE", "FALSE", "NULL", "NA", "Inf", "NaN"])
});

const FLOW_TYPES = /\b(?:i8|i16|i32|i64|u8|u16|u32|u64|f32|f64|bool|string|void)\b/;

function tokenize(code, runtime) {
  const keywords = KEYWORDS[runtime] || KEYWORDS.python;
  const comment = /#[^\n]*/y;
  const string = runtime === "python" ?
    /'''[\s\S]*?'''|"""[\s\S]*?"""|(?:[rbf]|rb|fr)?(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/y :
    /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/y;
  const number = runtime === "r" ?
    /\b0[xX][0-9a-fA-F]+L?\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?L?\b/y :
    /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y;
  const word = /[A-Za-z_][A-Za-z0-9_.]*/y;
  const out = [];
  let index = 0, plain = "";
  const flush = () => { if (plain) { out.push(escapeHtml(plain)); plain = ""; } };
  const within = (limit) => Math.min(limit, code.length);
  while (index < code.length) {
    const ch = code[index];
    if (ch === "#") {                       // comments in all three languages
      comment.lastIndex = index;
      const match = comment.exec(code);
      if (match) { flush(); out.push('<span class="tok-com">' +
        escapeHtml(match[0]) + "</span>"); index = comment.lastIndex; continue; }
    }
    if (ch === '"' || ch === "'" ||
        (runtime === "python" && (ch === "r" || ch === "R" || ch === "b" || ch === "B" ||
          ch === "f" || ch === "F") &&
          (code[index + 1] === '"' || code[index + 1] === "'"))) {
      string.lastIndex = index;
      const match = string.exec(code);
      if (match) { flush(); out.push('<span class="tok-str">' +
        escapeHtml(match[0]) + "</span>"); index = string.lastIndex; continue; }
    }
    if (/[0-9]/.test(ch) ||
        (/[xX]/.test(ch || "") && /[0-9]/.test(code[index - 1] || ""))) {
      number.lastIndex = index;
      const match = number.exec(code);
      if (match && match.index === index) {
        flush(); out.push('<span class="tok-num">' + escapeHtml(match[0]) + "</span>");
        index = number.lastIndex; continue;
      }
    }
    if (/[A-Za-z_.]/.test(ch)) {
      word.lastIndex = index;
      const match = word.exec(code);
      if (match) {
        const name = match[0];
        const bare = name.replace(/\.$/, "");
        let body = escapeHtml(name), cls = "";
        if (keywords.has(bare)) {
          cls = "tok-kw";
        } else if (runtime === "flow" && FLOW_TYPES.test(bare)) {
          cls = "tok-type";
        } else if (code[word.lastIndex] === "(" && !/(^|\.)(this|self)$/.test(bare)) {
          cls = "tok-fn";
        }
        if (bare.length !== name.length) body = escapeHtml(bare) + ".";
        flush();
        out.push(cls ? '<span class="' + cls + '">' + body + "</span>" : body);
        index = word.lastIndex; continue;
      }
    }
    plain += ch; index++;
  }
  flush();
  return out.join("");
}

/* Total bound: enormous inputs highlight only a truncated prefix; the rest is
 * escaped plain text so the prompt stays responsive. Textarea value remains
 * the submission source regardless. */
function highlight(code, runtime) {
  if (typeof code !== "string") return "";
  if (code.length > MAX_HIGHLIGHTED)
    return escapeHtml(code);
  return tokenize(code, runtime);
}

function createPrompt(doc, callbacks = {}) {
  const el = tag => doc.createElement(tag);
  const node = el("div");
  node.className = "terminal-prompt-line";
  const glyph = el("span");
  glyph.className = "terminal-prompt-glyph";
  glyph.setAttribute("aria-hidden", "true");
  const wrap = el("div");
  wrap.className = "terminal-inputwrap";
  const overlay = el("pre");
  overlay.className = "terminal-input-overlay";
  overlay.setAttribute("aria-hidden", "true");
  const field = el("textarea");
  field.id = "consoleInput";
  field.className = "terminal-input-field";
  field.rows = 1;
  field.spellcheck = false;
  field.setAttribute("autocomplete", "off");
  field.setAttribute("aria-label", "Interactive console command");
  wrap.append(overlay, field);
  node.append(glyph, wrap);

  let runtime = (callbacks.initialRuntime || "python").toLowerCase();
  let disabled = false;

  function paint() {
    glyph.textContent = (runtime === "r" ? "r" : runtime) + " ❯ ";
    overlay.innerHTML = highlight(field.value, runtime);
    overlay.scrollTop = field.scrollTop;
    autosize();
  }
  function autosize() {
    field.style.height = "auto";
    field.style.height = Math.max(field.scrollHeight, 20) + "px";
    overlay.style.height = field.style.height;
  }
  field.addEventListener("input", paint);
  field.addEventListener("scroll", () => { overlay.scrollTop = field.scrollTop; });
  function run() {
    if (field.isComposing) return;
    if (disabled) return;
    if (callbacks.onExecute) callbacks.onExecute(field);
  }
  field.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) &&
        ["f", "h", "s"].includes((event.key || "").toLowerCase())) {
      event.stopPropagation();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      run();
      return;
    }
    if (event.key === "ArrowUp" && !event.ctrlKey && !event.metaKey &&
        !event.altKey && !event.shiftKey &&
        (field.selectionStart === 0 || !field.value.includes("\n"))) {
      if (callbacks.onHistoryUp) { event.preventDefault(); callbacks.onHistoryUp(field); }
      return;
    }
    if (event.key === "ArrowDown" && !event.ctrlKey && !event.metaKey &&
        !event.altKey && !event.shiftKey &&
        (field.selectionStart === field.value.length || !field.value.includes("\n"))) {
      if (callbacks.onHistoryDown) { event.preventDefault(); callbacks.onHistoryDown(field); }
      return;
    }
    if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const start = field.selectionStart, end = field.selectionEnd;
      field.value = field.value.slice(0, start) + "  " + field.value.slice(end);
      field.selectionStart = field.selectionEnd = start + 2;
      paint();
      return;
    }
    if (event.key === "Escape" && !event.ctrlKey && !event.metaKey &&
        field.value.length) {
      event.preventDefault();
      field.value = "";
      paint();
    }
  });
  paint();
  return Object.freeze({
    node, field, overlay, glyph,
    get value() { return field.value; },
    set value(next) { field.value = next; paint(); },
    setRuntime(next) { runtime = String(next || "").toLowerCase(); paint(); },
    get runtime() { return runtime; },
    paint,
    focus() { field.focus(); },
    set(disabled) {
      disabled = Boolean(disabled);
      field.disabled = disabled;
      node.classList.toggle("terminal-prompt-disabled", disabled);
    }
  });
}

const api = Object.freeze({ highlight, escapeHtml, createPrompt, MAX_HIGHLIGHTED });
root.FlowStudioTerminalInput = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
