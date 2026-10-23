"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {create} = require("../docs/app/plot_history.js");
function element(tag) {
  return {
    tag, children: [], attributes: {},
    get firstChild() { return this.children[0] || null; },
    setAttribute(key, value) { this.attributes[key] = value; },
    append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; }
  };
}
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
function setup() {
  global.document = {createElement:element};
  const target = element("workspace");
  return {target, history:create(target)};
}
test("plot save links contain only validated PNG data and stable filenames", () => {
  const {target,history} = setup();
  assert.equal(history.append([{number:3,png:PNG}]),1);
  const [image,save,zoom] = target.firstChild.children;
  assert.equal(image.tag,"img");
  assert.equal(save.tag,"a");
  assert.equal(save.href,"data:image/png;base64,"+PNG);
  assert.equal(save.download,"flowstudio-figure-3.png");
  assert.equal(zoom.tag,"button");
});
test("zoom is reversible and exposes aria-pressed state", () => {
  const {target,history} = setup();
  history.append([{number:4,png:PNG}]);
  const [image,,zoom] = target.firstChild.children;
  zoom.onclick();
  assert.equal(zoom.attributes["aria-pressed"],"true");
  assert.equal(image.attributes.style,"max-width:none;height:auto");
  zoom.onclick();
  assert.equal(zoom.attributes["aria-pressed"],"false");
  assert.equal(image.attributes.style,"max-width:100%;height:auto");
});
test("reset clears owned plots without deleting a CSV viewer", () => {
  const {target,history} = setup();
  history.append([{number:1,png:PNG}]);
  history.clear();
  assert.equal(target.firstChild,null);
  history.append([{number:2,png:PNG}]);
  const viewer = element("iframe");
  target.replaceChildren(viewer);
  history.clear();
  assert.equal(target.firstChild,viewer);
});
