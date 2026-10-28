/* Shared fake-DOM fixture for the workspace terminal console tests.
 *
 * Supports the exact subset of DOM the terminal modules use: classList,
 * dataset, attributes, replaceChildren, querySelectorAll for the selectors the
 * mount code asks for, innerHTML/textContent semantics for assertions, and
 * form-field behaviour for the integrated prompt. */
"use strict";

class FakeElement {
  constructor(tag = "div") {
    this.tag = tag;
    this.className = "";
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.title = "";
    this.scrollTop = 0;
    this.scrollHeight = 40;
    this.clientHeight = 300;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.rows = 0;
    this.spellcheck = false;
    this.tabIndex = 0;
    this.parentElement = null;
    this._text = "";
    this._html = undefined;
    this.style = { height: "", setProperty(name, value) { this[name] = value; } };
  }
  get id() { return this.attributes.id || ""; }
  set id(next) { this.attributes.id = next; }
  get type() { return this.attributes.type || ""; }
  set type(next) { this.attributes.type = next; }
  append(...nodes) {
    for (const node of nodes) {
      if (node && node.parentElement) {
        const index = node.parentElement.children.indexOf(node);
        if (index >= 0) node.parentElement.children.splice(index, 1);
      }
      node.parentElement = this;
      this.children.push(node);
    }
    return this;
  }
  replaceChildren(...nodes) {
    for (const node of this.children) node.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  fire(name, event = {}) {
    for (const fn of this.listeners[name] || [])
      fn({ target: this, preventDefault() {}, stopPropagation() {}, ...event });
  }
  focus() { this.focused = true; }
  contains(node) {
    for (let walk = node; walk; walk = walk.parentElement)
      if (walk === this) return true;
    return false;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) {
    const has = Object.hasOwn(this.attributes, name);
    delete this.attributes[name];
    return has;
  }
  get classList() {
    const self = this;
    return {
      add(next) {
        const parts = self.className.split(/\s+/).filter(Boolean);
        if (!parts.includes(next)) parts.push(next);
        self.className = parts.join(" ");
      },
      toggle(next, force) {
        const parts = self.className.split(/\s+/).filter(Boolean);
        const present = parts.includes(next);
        const target = force === undefined ? !present : Boolean(force);
        if (target && !present) parts.push(next);
        if (!target) self.className = parts.filter(c => c !== next).join(" ");
      },
      contains(next) { return self.className.split(/\s+/).includes(next); }
    };
  }
  matches(selector) {
    if (selector.startsWith("#")) return this.attributes.id === selector.slice(1);
    if (selector.startsWith("."))
      return this.className.split(/\s+/).includes(selector.slice(1));
    const attribute = selector.match(/^\[([\w-]+)\]$/);
    if (attribute) {
      const key = attribute[1];
      return !!this.dataset[key] || Object.hasOwn(this.attributes, key);
    }
    return false;
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = node => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  get isComposing() { return false; }
  set innerHTML(next) {
    this._html = String(next);
    for (const child of this.children) child.parentElement = null;
    this.children = [];
  }
  get innerHTML() {
    return this._html !== undefined ? this._html : this.serialize();
  }
  get textContent() {
    return this._text +
      this.children.map(child => String(child.textContent ?? "")).join("");
  }
  set textContent(next) {
    this._text = String(next);
    for (const child of this.children) child.parentElement = null;
    this.children = [];
  }
  serialize() {
    const open = [];
    if (this.tag) {
      open.push("<" + this.tag);
      if (this.className) open.push(' class="' + this.className + '"');
      for (const [name, value] of Object.entries(this.attributes)) {
        if (name === "id" || name === "type") continue;
        open.push(` ${name}="${String(value).replace(/"/g, "&quot;")}"`);
      }
      open.push(">");
    }
    const body = this._html !== undefined ? this._html :
      String(this.textContent ?? "").replace(/&/g, "&amp;")
        .replace(/</g, "&lt;").replace(/>/g, "&gt;") +
      (this.children.length ?
        this.children.map(child => child.serialize()).join("") : "");
    return open.join("") + body + (this.tag ? "</" + this.tag + ">" : "");
  }
  toString() { return this.textContent; }
}

function createDocument(existing = new Map()) {
  const doc = {
    getElementById: id => existing.get(id) || null,
    createElement: tag => new FakeElement(tag),
    createTextNode: text => Object.assign(new FakeElement(""), { textContent: text }),
    listeners: {},
    addEventListener(name, fn) { (doc.listeners[name] ||= []).push(fn); }
  };
  return { doc, elements: existing, FakeElement };
}

module.exports = { FakeElement, createDocument };
