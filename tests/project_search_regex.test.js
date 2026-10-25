"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const browser = require("../web/project.js");
const pages = require("../docs/app/project.js");

function file(name, text, size = text.length) {
  return {kind:"file",name,async getFile(){return {size,async text(){return text;}};}};
}
function directory(name, entries) {
  return {kind:"directory",name,async *entries(){yield* entries;}};
}
const fixture = text => directory("project", [
  ["src", directory("src", [["analysis.R",file("analysis.R",text)]])]
]);

for (const [name, module] of [["native",browser],["Pages",pages]]) {
  test(name + " project regex reports multiline captures with exact source offsets", async () => {
    const source = "a <- 1\nb <- 22\nx <- 3";
    const result = await module.searchProject(fixture(source),
      String.raw`(?<name>[ab]) <- \d+`, {regex:true,caseSensitive:true});
    assert.deepEqual(result.matches.map(hit => [hit.line,hit.column,hit.index,hit.text]),
      [[1,1,0,"a <- 1"],[2,1,7,"b <- 22"]]);
    assert.equal(result.matches[1].length,7);
    assert.equal(result.truncated,false);
    const anchored = await module.searchProject(fixture(source),"^b <-", {regex:true});
    assert.equal(anchored.matches.length,1);
    assert.equal(anchored.matches[0].line,2);
  });
  test(name + " project search supports Unicode whole words and literal metacharacters", async () => {
    const root=fixture("cat cats scat\nα αβ _α α_\nx.* xab");
    const words=await module.searchProject(root,"α",{wholeWord:true});
    assert.deepEqual(words.matches.map(hit=>[hit.line,hit.column]),[[2,1]]);
    const regex=await module.searchProject(root,"c.t",{regex:true,wholeWord:true});
    assert.equal(regex.matches.length,1);
    const literal=await module.searchProject(root,"x.*");
    assert.equal(literal.matches.length,1);
    assert.equal(literal.matches[0].text,"x.*");
  });
  test(name + " rejects invalid regex without partial results", async () => {
    await assert.rejects(module.searchProject(fixture("abc"),"(",{regex:true}),
      /Invalid regular expression/);
  });
  test(name + " bounds regex to 128 KiB per file, but retains 1 MiB literal search", async () => {
    const content="a".repeat(140000);
    const root=fixture(content);
    const regex=await module.searchProject(root,"z",{regex:true});
    assert.equal(regex.scannedFiles,0);
    assert.equal(regex.skippedLarge,1);
    const literal=await module.searchProject(root,"z");
    assert.equal(literal.scannedFiles,1);
    assert.equal(literal.skippedLarge,0);
  });
  test(name + " bounds zero-width regex matches and honours abort", async () => {
    const result=await module.searchProject(fixture("x".repeat(500)),"(?=x)",{regex:true});
    assert.equal(result.matches.length,200);
    assert.equal(result.truncated,true);
    assert.equal(result.matches[0].length,0);
    await assert.rejects(module.searchProject(fixture("a"),"a",{regex:true,
      signal:{aborted:true}}), error=>error.name==="AbortError");
  });
}
test("native embedded project search stays identical to tested source and wires regex UI",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../web/index.html"),"utf8");
  const source=fs.readFileSync(path.join(__dirname,"../web/project.js"),"utf8").trim();
  assert.ok(html.includes(source));
  for(const id of ["projectRegex","projectWholeWord","projectSearch","searchResults"])
    assert.ok(html.includes('id="'+id+'"'));
  assert.match(html,/project\.search\(query, \{ caseSensitive, regex, wholeWord \}\)/);
  assert.match(html,/selected !== hit\.text/);
});
