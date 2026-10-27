/* FlowStudio outline panel: renders document symbols and jumps to them.
 * Parsing lives in ide_symbols.js; navigation is delegated to the app. */
(function (root) {
"use strict";

function mount(doc = document, options = {}) {
  const list = doc.getElementById("outlineList");
  if (!list) return null;
  const empty = doc.getElementById("outlineEmpty");
  const label = doc.getElementById("outlineLabel");
  const symbols = options.symbols || root.FlowStudioSymbols || null;
  const jump = typeof options.jump === "function" ? options.jump : () => false;
  let items = [];
  let active = null;

  function setMessage(message, muted = true) {
    if (!empty) return;
    empty.textContent = message;
    empty.hidden = false;
    if (empty.classList && typeof empty.classList.toggle === "function")
      empty.classList.toggle("muted", muted);
    if (empty.dataset) empty.dataset.state = muted ? "" : "error";
  }

  function buttonFor(symbol) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "outline-item";
    if (button.dataset) {
      button.dataset.line = String(symbol.line);
      button.dataset.column = String(symbol.column);
      button.dataset.kind = symbol.kind;
      button.dataset.depth = String(symbol.depth || 0);
    }
    if (button.style && typeof button.style.setProperty === "function") {
      button.style.setProperty("--depth", String(symbol.depth || 0));
    } else if (button.style) {
      button.style.paddingLeft = (6 + (symbol.depth || 0) * 12) + "px";
    }
    button.title = symbol.kind + " " + symbol.name + " \u2014 line " + symbol.line;
    const glyph = doc.createElement("span");
    glyph.className = "outline-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = symbols && typeof symbols.glyph === "function"
      ? symbols.glyph(symbol.kind) : "";
    const name = doc.createElement("span");
    name.className = "outline-name";
    name.textContent = symbol.name;
    button.append(glyph, name);
    if (symbol.detail) {
      const detail = doc.createElement("span");
      detail.className = "outline-detail";
      detail.textContent = symbol.detail;
      button.append(detail);
    }
    button.setAttribute("aria-label",
      symbol.kind + " " + symbol.name + ", line " + symbol.line);
    button.addEventListener("click", () => {
      active = symbol;
      jump(symbol.line, symbol.column);
    });
    return button;
  }

  function render(list_ = [], meta = {}) {
    items = Array.isArray(list_) ? list_.slice(0, symbols ? symbols.MAX_SYMBOLS : 400) : [];
    active = null;
    if (label) label.textContent = meta.label ? String(meta.label) : "";
    if (!items.length) {
      list.replaceChildren();
      setMessage(meta.language === "flow" || meta.language === "r" || meta.language === "python"
        ? "No document symbols found."
        : "Open a Flow, R or Python file to see its structure.");
      return 0;
    }
    list.replaceChildren(...items.map(symbol => {
      const row = doc.createElement("li");
      row.className = "outline-row";
      row.append(buttonFor(symbol));
      return row;
    }));
    if (empty) empty.hidden = true;
    if (symbols && items.length >= symbols.MAX_SYMBOLS) {
      const note = doc.createElement("li");
      note.className = "outline-row outline-note";
      note.textContent = "First " + symbols.MAX_SYMBOLS + " symbols only.";
      list.append(note);
    }
    return items.length;
  }

  /* Parse the buffer and render it. Parse failures are shown, never thrown. */
  function update(meta = {}) {
    if (!symbols) return 0;
    let parsed;
    try {
      parsed = symbols.parse(meta.language, typeof meta.text === "string" ? meta.text : "");
    } catch (error) {
      items = [];
      active = null;
      list.replaceChildren();
      setMessage(error && error.message ? error.message : String(error), false);
      return 0;
    }
    return render(parsed, meta);
  }

  function buttons() {
    return typeof list.querySelectorAll === "function"
      ? Array.from(list.querySelectorAll(".outline-item")) : [];
  }

  if (typeof list.addEventListener === "function") {
    list.addEventListener("keydown", event => {
      const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
      if (!keys.includes(event.key)) return;
      const rows = buttons();
      if (!rows.length) return;
      event.preventDefault();
      const index = rows.indexOf(doc.activeElement);
      let next = 0;
      if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % rows.length;
      else if (event.key === "ArrowUp") next = index < 0 ? rows.length - 1
        : (index - 1 + rows.length) % rows.length;
      else if (event.key === "End") next = rows.length - 1;
      rows[next].focus();
    });
  }

  return Object.freeze({
    render,
    update,
    count: () => items.length,
    selected: () => active,
    symbols: () => items.slice(),
    focusFirst() {
      const rows = buttons();
      if (!rows.length) return false;
      rows[0].focus();
      return true;
    }
  });
}

const api = Object.freeze({ mount });
root.FlowStudioOutline = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
