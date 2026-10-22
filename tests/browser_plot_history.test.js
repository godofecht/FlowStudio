"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {create, LIMIT} = require("../docs/app/plot_history.js");
function element(tag) {
  return {
    tag, children: [], attributes: {},
    get firstChild() { return this.children[0] || null; },
    setAttribute(name, value) {this.attributes[name] = value;},
    append(child) {this.children.push(child);},
    replaceChildren(...children) {this.children = children;}
  };
}
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
function setup() {
  global.document = {createElement: element};
  const target = element("workspace");
  return {history:create(target), target};
}
test("plots render with DOM elements, never HTML injection", () => {
  const {history,target} = setup();
  assert.equal(history.append([{number:1,png:PNG}]),1);
  const image = target.firstChild.children[0];
  assert.equal(image.tag,"img");
  assert.equal(image.alt,"Python figure 1");
});
test("rejects malformed and oversized images", () => {
  const {history} = setup();
  assert.equal(history.append([{number:1,png:"<script>"},{number:2,png:"A".repeat(1398108)}]),0);
});
test("history is bounded", () => {
  const {history,target} = setup();
  for (let i=0;i<LIMIT+3;i++) history.append([{number:i,png:PNG}]);
  assert.equal(history.size(),LIMIT);
  assert.equal(target.firstChild.children[0].alt,"Python figure 3");
});
test("reset clears only an owned plot view", () => {
  const {history,target} = setup();
  history.append([{number:1,png:PNG}]);
  history.clear();
  assert.equal(target.children.length,0);
  history.append([{number:2,png:PNG}]);
  const viewer = element("iframe");
  target.replaceChildren(viewer);
  history.clear();
  assert.equal(target.firstChild,viewer);
});
