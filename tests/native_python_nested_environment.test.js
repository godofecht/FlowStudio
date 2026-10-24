"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../web/index.html"), "utf8");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.textContent = "";
  }
  append(...children) { this.children.push(...children); }
}
test("native editor renders bounded nested metadata as inert text", () => {
  const match = /function renderPythonEnvironmentChild\(item, depth\) \{[\s\S]*?\n\}\n(?=async function refreshPythonEnvironment)/.exec(html);
  assert.ok(match, "actual native editor nested inspector function must exist");
  const context = {document:{createElement:tag => new Element(tag)}, Number};
  vm.runInNewContext(match[0], context);
  const render = context.renderPythonEnvironmentChild;
  const malicious = '<img src=x onerror=alert(1)>';
  const tree = render({
    name: malicious, type:"dict", size:1, children:[
      {name:'["payload"]', type:"list", size:1, children:[
        {name:"[0]", type:"str", size:10}
      ]}
    ]
  }, 0);
  assert.equal(tree.tag, "li");
  assert.equal(tree.children[0].tag, "details");
  assert.ok(tree.children[0].children[0].textContent.includes(malicious));
  assert.equal(tree.children[0].children[1].children[0].tag, "li");
  assert.equal(tree.children[0].children[1].children[0].children[0].tag, "details");
  assert.equal(render({name:"x", type:"str", children:Array(13).fill({name:"a",type:"str"})}, 0).children.length, 0);
  assert.equal(render({name:"x", type:"str"}, 3), null);
});
test("native environment refresh gates nested inspection to Python and validates shape", () => {
  assert.match(html, /selectedLanguage === "python" && Array\.isArray\(variable\.children\)/);
  assert.match(html, /variable\.children\.length <= 12/);
  assert.match(html, /row\.firstChild\.replaceChildren\(details\)/);
  assert.match(html, /fetch\("\/api\/inspect\/" \+ selectedLanguage/);
});
