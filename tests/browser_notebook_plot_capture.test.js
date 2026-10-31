"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const capture = require("../docs/app/notebook_plot_capture.js");
const PNG = "iVBORw0KGgoAAAA=";
function documentWith(result = PNG) {
  const canvases = [];
  return {canvases, createElement(tag) {
    assert.equal(tag, "canvas");
    const canvas = {width:0, height:0, drawn:[],
      getContext:() => ({drawImage(image, x, y) { canvas.drawn.push([image, x, y]); }}),
      toDataURL:() => "data:image/png;base64," + result};
    canvases.push(canvas);
    return canvas;
  }};
}
test("captures bounded R ImageBitmaps as portable PNG and releases scratch canvases", () => {
  const document = documentWith();
  const images = [{width:504,height:360}, {width:640,height:480}];
  assert.deepEqual(capture.bitmapsToPng(images, document), [{png:PNG},{png:PNG}]);
  assert.equal(document.canvases.length, 2);
  assert.ok(document.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  assert.ok(document.canvases.every(canvas => canvas.drawn.length === 1));
});
test("rejects oversized, invalid, non-PNG and excessive bitmap captures", () => {
  const document = documentWith("iVBORw0KGgo" + "A".repeat(524289));
  assert.deepEqual(capture.bitmapsToPng([{width:100,height:100}], document), []);
  assert.deepEqual(capture.bitmapsToPng([{width:2049,height:10},{width:10,height:0}], document), []);
  assert.equal(document.canvases.length, 1);
  const valid = documentWith();
  assert.equal(capture.bitmapsToPng(Array.from({length:12}, () =>
    ({width:16,height:16})), valid).length, 8);
  assert.equal(valid.canvases.length, 8);
});
test("native R SVG becomes bounded PNG without retaining SVG or object URLs", async () => {
  const document = documentWith();
  const urls = [];
  class Image {
    naturalWidth = 504;
    naturalHeight = 360;
    set src(value) { urls.push(["load",value]); queueMicrotask(() => this.onload?.()); }
  }
  const environment = {document, Image, URL:{
    createObjectURL(blob) { assert.equal(blob.type,"image/svg+xml;charset=utf-8"); return "blob:plot"; },
    revokeObjectURL(url) { urls.push(["revoke",url]); }
  }};
  const plot = await capture.svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="504" height="360"></svg>', environment);
  assert.deepEqual(plot, {png:PNG});
  assert.deepEqual(urls, [["load","blob:plot"],["revoke","blob:plot"]]);
  assert.equal(document.canvases[0].width, 0);
});
test("native SVG rejects malformed/oversized sources before creating object URLs", async () => {
  const environment = {document:documentWith(), Image:class {}, URL:{
    createObjectURL() { throw Error("Must not create URL"); },
    revokeObjectURL() {}
  }};
  for (const svg of ["<script>alert(1)</script>", "<svg/>", "<svg>" + "x".repeat(60001) + "</svg>"])
    assert.equal(await capture.svgToPng(svg, environment), null);
});
