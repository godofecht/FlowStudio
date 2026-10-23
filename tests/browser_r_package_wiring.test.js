"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];

test("published browser workspace parses and connects the selected runtime to package controls", () => {
  assert.ok(source, "inline browser controller must exist");
  assert.doesNotThrow(() => new vm.Script(source));
  assert.match(source, /language:\(\)=>\$\("language"\)\.value, rSession:getRSession/);
  assert.match(source, /packagePanel\.updateLanguage\?\.\(\)/);
  assert.match(source, /packagePanel\.clear\(\);\s*if \(\$\("language"\)\.value === "r"\)/);
});
test("browser package inputs are available for both R and Python", () => {
  assert.match(html, /id="packageName"/);
  assert.match(html, /id="installPackage"/);
  assert.match(html, /id="listPackages"/);
  assert.match(html, /src="\.\/packages_panel\.js"/);
  assert.match(html, /src="\.\/r_session\.js"/);
});
