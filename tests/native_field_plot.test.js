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
  assert.equal(parse("ordinary output\n".repeat(10000)), null);
  const largeOrdinary = "ordinary output\n".repeat(10000);
  assert.equal(parse(largeOrdinary + "FLOWSTUDIO_FIELD_V1not-a-frame\n"), null);
  assert.equal(parse(largeOrdinary + "prefix FLOWSTUDIO_FIELD_V1 4 2\n"), null);
  assert.equal(parse("FLOWSTUDIO_FIELD_V1not-a-frame\n"), null);
  assert.deepEqual(parse(good.replace(" 4 2", "\t4\t2")), {count:4, fields:[
    {name:"U", values:[1,.5,.75,1]},
    {name:"V", values:[0,.25,.125,0]}
  ]});
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
  assert.throws(() => parse(good + "x".repeat(131073)), /limit/);
  assert.throws(() => parse("FLOWSTUDIO_FIELD_V1\n"), /header/);
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
  const ticks = svg.children.filter(child =>
    Object.hasOwn(child.attributes, "data-native-flow-axis-value"));
  assert.deepEqual(ticks.map(tick => Number(tick.attributes["data-native-flow-axis-value"])),
    [1, 0]);
  assert.equal(svg.children.filter(child =>
    child.attributes["data-native-flow-zero-axis"]).length, 0);
  for (const path of paths) {
    assert.equal((path.attributes.d.match(/[ML]/g) || []).length, 4);
    assert.doesNotMatch(path.attributes.d, /NaN|Infinity|<|>/);
  }
});

test("deterministic bounded 1D fields survive 120 seeded sizes and species counts", () => {
  for (let seed = 1; seed <= 120; seed++) {
    let state = seed;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const count = 3 + seed % 510, species = 1 + seed % 4;
    const rows = Array.from({length:species}, (_, j) => "F" + j + " " +
      Array.from({length:count}, () => ((random() - .5) * 2).toExponential(9)).join(" "));
    const data = parse(["FLOWSTUDIO_FIELD_V1 " + count + " " + species,
      ...rows, "FLOWSTUDIO_FIELD_END"].join("\n"));
    assert.equal(data.count, count);
    assert.equal(data.fields.length, species);
    assert.ok(data.fields.every(field => field.values.length === count &&
      field.values.every(Number.isFinite)));
  }
});


test("all bounded seeded fields render finite, in-range SVG coordinates", () => {
  class Element {
    constructor(tag) { this.tag = tag; this.attributes = {}; this.children = []; this.hidden = true; }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
  }
  const doc = {createElement: tag => new Element(tag),
    createElementNS: (_namespace, tag) => new Element(tag)};
  const container = new Element("div");
  for (let seed = 1; seed <= 120; seed++) {
    const count = 3 + seed % 510;
    const species = 1 + seed % 4;
    const rows = Array.from({length:species}, (_, j) => {
      const values = Array.from({length:count}, (_, i) =>
        ((i - count / 2) * (j + 1) * (seed % 2 ? 1 : -1) / count).toExponential(9));
      return "F" + j + " " + values.join(" ");
    });
    const output = ["FLOWSTUDIO_FIELD_V1 " + count + " " + species,
      ...rows, "FLOWSTUDIO_FIELD_END"].join("\n");
    assert.equal(render(doc, container, output), true);
    const svg = container.children[1];
    const paths = svg.children.filter(child => child.attributes["data-field-name"]);
    assert.equal(paths.length, species);
    for (const path of paths) {
      const points = [...path.attributes.d.matchAll(/([ML])([0-9.]+),([0-9.]+)/g)];
      assert.equal(points.length, count);
      assert.equal(points.map(point => point[0]).join(" "), path.attributes.d);
      for (const point of points) {
        const x = Number(point[2]), y = Number(point[3]);
        assert.ok(Number.isFinite(x) && x >= 48 && x <= 616);
        assert.ok(Number.isFinite(y) && y >= 24 && y <= 214);
      }
    }
  }
});

test("computed zero baseline follows signed field extrema", () => {
  class Element {
    constructor(tag) { this.tag = tag; this.attributes = {}; this.children = []; }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
  }
  const doc = {createElement: tag => new Element(tag),
    createElementNS: (_namespace, tag) => new Element(tag)};
  const container = new Element("div");
  assert.equal(render(doc, container, frame([-1, 0, 1, 2], [0, 0, 0, 0])), true);
  const svg = container.children[1];
  const zero = svg.children.filter(child =>
    child.attributes["data-native-flow-zero-axis"] === "true");
  assert.equal(zero.length, 1);
  assert.equal(zero[0].tag, "line");
  assert.equal(Number(zero[0].attributes.y1), Number(zero[0].attributes.y2));
  assert.ok(Math.abs(Number(zero[0].attributes.y1) - (214 - 190 / 3)) < 1e-10);
  const ticks = svg.children.filter(child =>
    Object.hasOwn(child.attributes, "data-native-flow-axis-value"));
  assert.deepEqual(ticks.map(tick => Number(tick.attributes["data-native-flow-axis-value"])),
    [2, -1]);
});

test("constant and near-equal fields retain truthful finite axis geometry", () => {
  class Element {
    constructor(tag) { this.tag = tag; this.attributes = {}; this.children = []; }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
  }
  const doc = {createElement: tag => new Element(tag),
    createElementNS: (_namespace, tag) => new Element(tag)};
  const container = new Element("div");
  for (const value of [0, 1, -1, 1000000, -1000000]) {
    const output = ["FLOWSTUDIO_FIELD_V1 3 1",
      "C " + [value, value, value].join(" "), "FLOWSTUDIO_FIELD_END"].join("\n");
    assert.equal(render(doc, container, output), true);
    const svg = container.children[1];
    const path = svg.children.find(child => child.attributes["data-field-name"] === "C");
    const points = [...path.attributes.d.matchAll(/([ML])([0-9.]+),([0-9.]+)/g)];
    assert.deepEqual(points.map(point => Number(point[3])), [119, 119, 119]);
    const ticks = svg.children.filter(child =>
      Object.hasOwn(child.attributes, "data-native-flow-axis-value"));
    const [top, bottom] = ticks.map(tick =>
      Number(tick.attributes["data-native-flow-axis-value"]));
    assert.ok(top > value && bottom < value);
    assert.equal(svg.children.filter(child =>
      child.attributes["data-native-flow-zero-axis"]).length, 0);
  }
  for (const values of [
    [999999.9999999998, 999999.9999999999, 1000000],
    [-Number.MIN_VALUE, 0, Number.MIN_VALUE]
  ]) {
    const output = ["FLOWSTUDIO_FIELD_V1 3 1",
      "C " + values.join(" "), "FLOWSTUDIO_FIELD_END"].join("\n");
    assert.equal(render(doc, container, output), true);
    const svg = container.children[1];
    const path = svg.children.find(child => child.attributes["data-field-name"] === "C");
    const points = [...path.attributes.d.matchAll(/([ML])([0-9.]+),([0-9.]+)/g)];
    assert.deepEqual(points.map(point => Number(point[3])), [214, 119, 24]);
    const ticks = svg.children.filter(child =>
      Object.hasOwn(child.attributes, "data-native-flow-axis-value"));
    assert.equal(ticks.length, 2);
    assert.notEqual(ticks[0].textContent, ticks[1].textContent,
      "distinct computed extrema must never display identical axis labels");
    assert.equal(Number(ticks[0].attributes["data-native-flow-axis-value"]), values[2]);
    assert.equal(Number(ticks[1].attributes["data-native-flow-axis-value"]), values[0]);
    if (values[2] === 1000000) {
      assert.equal(ticks[0].textContent, "1000000");
      assert.equal(ticks[1].textContent, "999999.9999999998");
      assert.equal(svg.attributes.viewBox, "-100 0 740 260",
        "expanded gutter must keep full-precision axis labels visible");
    }
  }
});
