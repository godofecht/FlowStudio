"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {parse, render} = require("../web/native_field_plot.js");

function grid(width, height, rows) {
  return ["native-tensor-grid-ok", "FLOWSTUDIO_GRID_V1 " +
    width + " " + height + " " + rows.length,
    ...rows.map(([name, values]) => name + " " + values.join(" ")),
    "FLOWSTUDIO_GRID_END"].join("\n");
}

class Element {
  constructor(tag) {
    this.tag = tag;
    this.attributes = {};
    this.children = [];
    this.hidden = true;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
}
const doc = {
  createElement: tag => new Element(tag),
  createElementNS: (_namespace, tag) => new Element(tag)
};

test("native 2D protocol parses exact rectangular dimensions and row-major cells", () => {
  const output = grid(3, 4, [["T", Array.from({length:12}, (_, i) => i - 6)]]);
  assert.deepEqual(parse(output), {width:3, height:4, fields:[
    {name:"T", values:[-6,-5,-4,-3,-2,-1,0,1,2,3,4,5]}
  ]});
  assert.equal(parse("ordinary Flow output"), null);
  assert.equal(parse("FLOWSTUDIO_GRID_V1not-a-frame"), null);
  assert.equal(parse("prefix FLOWSTUDIO_GRID_V1 3 3 1"), null);
  assert.equal(parse("ordinary output\n".repeat(10000)), null);
  assert.equal(parse("ordinary output\n".repeat(10000) +
    "FLOWSTUDIO_GRID_V1not-a-frame\n"), null);
});

test("2D grid protocol fails closed on invalid framing, values and resource bounds", () => {
  const good = grid(3, 3, [["T", [0,1,2,3,4,5,6,7,8]]]);
  for (const bad of [
    good.replace("3 3 1", "0 3 1"),
    good.replace("3 3 1", "33 3 1"),
    good.replace("3 3 1", "3 33 1"),
    good.replace("3 3 1", "3 3 3"),
    good.replace("3 3 1", "3 3 0"),
    good.replace("3 3 1", "3 3 1 extra"),
    good.replace("3 3 1", "3 3 2"),
    good.replace("T 0", "<script> 0"),
    good.replace("T 0", "T NaN"),
    good.replace("T 0", "T Infinity"),
    good.replace("T 0", "T 1e999"),
    good.replace("T 0", "T 1000001"),
    good.replace("T 0", "T 0 1"),
    good.replace("FLOWSTUDIO_GRID_END", "MISSING_END"),
    good + "\nFLOWSTUDIO_GRID_END",
    good + "\nFLOWSTUDIO_GRID_V1 3 3 1",
    good + "\nFLOWSTUDIO_FIELD_V1 3 1",
    grid(3, 3, [["T", [0,1,2,3,4,5,6,7,8]],
                ["T", [0,1,2,3,4,5,6,7,8]]])
  ]) assert.throws(() => parse(bad), undefined, bad.slice(0, 120));
  assert.throws(() => parse(good + "x".repeat(131073)), /limit/);
  assert.throws(() => parse("FLOWSTUDIO_GRID_V1\n"), /header/);
});

test("2D grid heatmap renders every actual cell with bounded finite geometry", () => {
  const container = new Element("div");
  const output = grid(4, 3, [["T", [0,1,2,3,4,5,6,7,8,9,10,11]],
    ["V", [11,10,9,8,7,6,5,4,3,2,1,0]]]);
  assert.equal(render(doc, container, output), true);
  const [title, svg] = container.children;
  assert.equal(title.textContent, "Native Flow grids · 4×3 cells");
  assert.equal(svg.attributes["data-native-flow-grid"], "true");
  assert.match(svg.attributes["aria-label"], /T, V/);
  const cells = svg.children.filter(child => child.tag === "rect");
  assert.equal(cells.length, 24);
  for (const [i, cell] of cells.entries()) {
    const field = i < 12 ? "T" : "V";
    const index = i % 12;
    assert.equal(cell.attributes["data-field-name"], field);
    assert.equal(Number(cell.attributes["data-grid-x"]), index % 4);
    assert.equal(Number(cell.attributes["data-grid-y"]), Math.floor(index / 4));
    assert.equal(Number(cell.attributes["data-grid-value"]),
      field === "T" ? index : 11 - index);
    for (const key of ["x", "y", "width", "height"])
      assert.ok(Number.isFinite(Number(cell.attributes[key])));
    assert.match(cell.attributes.fill, /^hsl\(\d+,65%,\d+%\)$/);
  }
  const ticks = svg.children.filter(child =>
    Object.hasOwn(child.attributes, "data-native-flow-grid-extreme"));
  assert.deepEqual(ticks.map(tick =>
    Number(tick.attributes["data-native-flow-grid-extreme"])), [0,11,0,11]);
});

test("deterministic 32x32 Fourier-mode grids preserve all 1024 coordinates", () => {
  const container = new Element("div");
  for (let seed = 1; seed <= 32; seed++) {
    const width = 3 + seed % 30, height = 3 + (seed * 7) % 30;
    const values = Array.from({length:width * height}, (_, i) =>
      (300 + Math.sin((i % width) * 0.5) * seed / 32).toPrecision(12));
    const output = grid(width, height, [["T", values]]);
    const parsed = parse(output);
    assert.equal(parsed.fields[0].values.length, width * height);
    assert.equal(render(doc, container, output), true);
    const cells = container.children[1].children.filter(child => child.tag === "rect");
    assert.equal(cells.length, width * height);
    assert.deepEqual(cells.map(cell => Number(cell.attributes["data-grid-value"])),
      values.map(Number));
  }
  const constant = grid(3, 3, [["T", Array(9).fill("300")]]);
  assert.equal(render(doc, container, constant), true);
  assert.equal(container.children[1].children.filter(child => child.tag === "rect")
    .every(cell => cell.attributes.fill === "hsl(120,65%,45%)"), true);
});
