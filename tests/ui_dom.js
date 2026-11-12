"use strict";
/* Minimal DOM fake for UI engine tests (menubar, run widget, search
 * everywhere). Supports only what the engines use: attributes/dataset,
 * child mechanics with parentNode, query helpers with compound selectors,
 * click(), focus(), basic dialog open/close and document-level listener
 * collection. Not a general DOM replacement. */

class FakeNode {
  constructor(tag, className = "") {
    this.tag = tag;
    this.className = className;
    this.children = [];
    this.attributes = {};
    if (className) this.attributes["class"] = className;
    this.listeners = {};
    this.hidden = false;
    this.focused = false;
    this.parent = null;
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.open = false;
  }
  get dataset() {
    const data = {};
    for (const [name, value] of Object.entries(this.attributes)) {
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
        data[key] = value;
      }
    }
    return data;
  }
  append(...nodes) {
    for (const node of nodes) { node.parent = this; this.children.push(node); }
    return this;
  }
  replaceChildren(...nodes) { this.children = []; return this.append(...nodes); }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute(name) { return name in this.attributes; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  fire(name, event = {}) {
    const target = event.target || this;
    let node = this;                             // DOM-like bubbling to ancestors
    while (node && node instanceof FakeNode) {
      for (const fn of node.listeners[name] || [])
        fn({ target, currentTarget: node, ...event });
      node = node.parent;
    }
  }
  focus() { this.focused = true; }
  click() { this.fire("click", {}); }
  close() { this.open = false; this.hidden = true; }
  showModal() { this.open = true; this.hidden = false; }
  matches(selector) {
    return selector.split(",").some(part => matchesSingle(this, part.trim()));
  }
  closest(selector) {
    let node = this;
    while (node && node instanceof FakeNode) {
      if (node.matches(selector)) return node;
      node = node.parent;
    }
    return null;
  }
  querySelectorAll(selector) { return walkMatch(this, selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get parentNode() { return this.parent; }
  get parentElement() { return this.parent; }
}
function matchesSingle(node, selector) {
  /* Grammar: [tag]? followed by any mix of .class, #id and [attr='value']. */
  const parsed = selector.match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/);
  if (!parsed) return false;
  const [, tag, rest] = parsed;
  if (tag && (node.tag || "").toLowerCase() !== tag.toLowerCase()) return false;
  if (!rest) return true;
  for (const match of rest.matchAll(/([#.])([\w-]+)/g)) {
    if (match[1] === "#") {
      if (node.attributes.id !== match[2]) return false;
    } else {
      const tokens = String(node.className || "").split(/\s+/);
      if (!tokens.includes(match[2])) return false;
    }
  }
  for (const match of rest.matchAll(/\[([^\]]+)\]/g)) {
    const parsed2 = match[1].match(/^([\w-]+)(?:=(.*))?$/);
    if (!parsed2) return false;
    const [, name, rawValue] = parsed2;
    const value = node.attributes[name] ?? ((() => { const data = {}; for (const [key, val] of Object.entries(node.attributes)) if (key.startsWith("data-")) data[key.slice(5)] = val; return data[name]; })());
    if (rawValue === undefined) {
      if (value === undefined) return false;
    } else {
      const clean = rawValue.replace(/^['"]|['"]$/g, "");
      if (String(value) !== clean) return false;
    }
  }
  return true;
}
function walkMatch(root, selector) {
  const found = [];
  const visit = child => {
    for (const node of child.children || []) {
      if (node.matches(selector)) found.push(node);
      visit(node);
    }
  };
  visit(root);
  return found;
}

function makeDoc(elementMap = {}) {
  const ids = new Map(Object.entries(elementMap));
  const documentListeners = {};
  const doc = {
    getElementById: id => ids.get(id) || null,
    createElement: tag => new FakeNode(tag),
    querySelector: selector => {
      const find = roots => {
        for (const root of roots) {
          const walk = node => {
            for (const child of node.children || []) {
              if (child.matches(selector)) return child;
              const deeper = walk(child);
              if (deeper) return deeper;
            }
            return null;
          };
          const hit = walk(root);
          if (hit) return hit;
        }
        return null;
      };
      return find([...ids.values()]);
    },
    addEventListener: (name, fn) => { (documentListeners[name] ||= []).push(fn); },
    removeEventListener: (name, fn) => {
      documentListeners[name] = (documentListeners[name] || []).filter(item => item !== fn);
    },
    fireDocument: (name, event) => { for (const fn of documentListeners[name] || []) fn(event); },
    activeElement: null
  };
  doc.ids = ids;
  return doc;
}

function button({ id = null, role = "menuitem", className = "", label = "", dataset = {}, children = [] } = {}) {
  const node = new FakeNode("button", className);
  node.setAttribute("type", "button");
  if (role) node.setAttribute("role", role);
  if (id) node.setAttribute("id", id);
  for (const [key, value] of Object.entries(dataset)) node.setAttribute(key, value);
  node.textContent = label;
  node.append(...children);
  return node;
}

/* Build a menubar: menus = [{items:[{label, dataset, id}..., {sub:[...], label}]}] */
function menubarFixture(spec) {
  const bar = new FakeNode("nav", "menubar");
  const built = [];
  for (const menuSpec of spec) {
    const menu = new FakeNode("div", "menu");
    const trigger = new FakeNode("button", "menu-trigger");
    trigger.textContent = menuSpec.name;
    const popup = new FakeNode("div", "menu-popup");
    popup.hidden = true;
    const elements = [];
    for (const itemSpec of menuSpec.items) {
      if (itemSpec.sub) {
        const wrapper = new FakeNode("div", "menu-item");
        const parent = button({ label: itemSpec.label, dataset: { ...itemSpec.dataset, "data-sub": "" } });
        const sub = new FakeNode("div", "menu-popup menu-sub");
        sub.hidden = true;
        sub.setAttribute("data-fill", "recent");
        for (const childSpec of itemSpec.sub) {
          const child = button(childSpec);
          sub.append(child);
          elements.push({ item: child, spec: childSpec });
        }
        wrapper.append(parent, sub);
        popup.append(wrapper);
        elements.push({ item: parent, spec: itemSpec, sub });
      } else {
        const item = button(itemSpec);
        popup.append(item);
        elements.push({ item, spec: itemSpec });
      }
    }
    menu.append(trigger, popup);
    bar.append(menu);
    built.push({ name: menuSpec.name, trigger, popup, items: elements });
  }
  return { bar, menus: built };
}

module.exports = { FakeNode, makeDoc, button, menubarFixture };
