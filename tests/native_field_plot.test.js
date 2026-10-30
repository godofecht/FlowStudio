"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {parse, render} = require("../web/native_field_plot.js");

function frame(u, v) {
  return ["native-field-grayscott64-ok", "FLOWSTUDIO_FIELD_V1 4 2",
    "U " + u.join(" "), "V " + v.join(" "),
    "FLOWSTUDIO_FIELD_END", ""].join("\n");
}
const good = frame([1, .5, .75, 1], [0, .25, .125, 0]);

test("real native field protocol parses exact species and cells", () => {
  assert.equal(parse("ordinary Flow output\n"), null);
  assert.deepEqual(parse(good), {count:4, fields:[
    {name:"U", values:[1,.5,.75,1]},
    {name:"V", values:[0,.25,.125,0]}
  ]});
  assert.deepEqual(parse(frame(["1e0", ".5", "7.5e-1", "1"], ["0", "0.25", "0.125", "0"])).fields[0].values,
    [1,.5,.75,1]);
});

test("fail closed on malformed, spoofed, nonfinite and oversized field blocks", () => {
  for (const bad of [
    good.replace("4 2", "999999 2"), good.replace("4 2", "4 5"),
    good.replace("4 2", "4 0"), good.replace("4 2", "4 2 extra"),
    good.replace("4 2", "4 2\nFLOWSTUDIO_FIELD_V1 4 2"),
    good.replace("V 0", "U 0"), good.replace("V 0", "<script> 0"),
    good.replace("0.125", "NaN"), good.replace("0.125", "Infinity"),
    good.replace("0.125", "1e999"), good.replace("0.125", "1000001"),
    good.replace("0.125", "1,25"), good.replace("0.125", "0.1 0.2"),
    good.replace("FLOWSTUDIO_FIELD_END", "NO_END"),
    good + "FLOWSTUDIO_FIELD_END\n",
    "FLOWSTUDIO_FIELD_V1 4 2\nU 1 2 3 4\n"
  ]) assert.throws(() => parse(bad), undefined, bad);
  assert.throws(() => parse("x".repeat(131073)), /limit/);
});

test("render creates bounded, finite, escaped SVG paths without HTML injection", () => {
  class Element {
    constructor(tag) { this.tag = tag; this.attributes = {}; this.children = []; this.hidden = true; }
    setAttribute(k, v) { this.attributes[k] = v; }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
  }
  const doc = {createElement: tag => new Element(tag),
    createElementNS: (_ns, tag) => new Element(tag)};
  const container = new Element("div");
  assert.equal(render(doc, container, "plain output"), false);
  assert.equal(container.children.length, 0);
  assert.equal(render(doc, container, good), true);
  assert.equal(container.hidden, false);
  const [title, svg] = container.children;
  assert.equal(title.textContent, "Native Flow fields · 4 cells");
  assert.equal(svg.attributes["data-native-flow-field"], "true");
  const paths = svg.children.filter(child => child.tag === "path" &&
    child.attributes["data-field-name"]);
  assert.equal(paths.length, 2);
  for (const path of paths) {
    assert.equal((path.attributes.d.match(/[ML]/g) || []).length, 4);
    assert.doesNotMatch(path.attributes.d, /NaN|Infinity|<|>/);
  }
});
