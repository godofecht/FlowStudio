"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const native = require("../web/project.js");
const pages = require("../docs/app/project.js");

function file(name, initial) {
  let bytes = Buffer.from(initial);
  return {
    kind: "file", name,
    get bytes() { return Buffer.from(bytes); },
    set bytes(value) { bytes = Buffer.from(value); },
    async getFile() {
      const snapshot = Buffer.from(bytes);
      return {
        size: snapshot.length,
        async arrayBuffer() {
          return snapshot.buffer.slice(snapshot.byteOffset, snapshot.byteOffset + snapshot.byteLength);
        },
        async text() { throw Error("File.text() must not be used"); }
      };
    },
    async createWritable() {
      let pending = Buffer.from(bytes);
      return {
        async write(value) { pending = Buffer.from(value, "utf8"); },
        async close() { bytes = pending; },
        async abort() {}
      };
    }
  };
}
function directory(entries) {
  return {kind:"directory", name:"work", async *entries() { yield* entries; }};
}

for (const [label, api] of [["native",native],["Pages",pages]]) {
  test(label+" skips unsafe project encodings and refuses incomplete replace", async () => {
    const good=file("a.R",Buffer.from("x <- 1"));
    const invalid=file("b.py",Buffer.from([0x78,0x20,0x3d,0x20,0xc3,0x28]));
    const binary=file("c.flow",Buffer.from([0x78,0,0x31]));
    const root=directory([["a.R",good],["b.py",invalid],["c.flow",binary]]);
    const found=await api.searchProject(root,"x");
    assert.equal(found.scannedFiles,1);
    assert.equal(found.skippedUnsafe,2);
    assert.equal(found.matches.length,1);
    await assert.rejects(api.planProjectReplace(root,"x","y"),/unsafe-encoding/);
    assert.equal(good.bytes.toString(),"x <- 1");
  });
  test(label+" preserves UTF-8 BOM bytes through replace and undo", async () => {
    const original=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from("x <- 1\n")]);
    const target=file("analysis.R",original);
    const root=directory([["analysis.R",target]]);
    const plan=await api.planProjectReplace(root,"x","alpha");
    assert.equal(plan.matches,1);
    assert.equal(plan.files[0].before.charCodeAt(0),0xfeff);
    assert.deepEqual(await api.applyProjectReplacement(plan),{files:1,matches:1});
    assert.deepEqual(target.bytes,Buffer.concat([
      Buffer.from([0xef,0xbb,0xbf]),Buffer.from("alpha <- 1\n")]));
    await api.applyProjectReplacement(api.reverseProjectReplacement(plan));
    assert.deepEqual(target.bytes,original);
  });
  test(label+" refuses an unsafe external rewrite before any write", async () => {
    const target=file("a.R",Buffer.from("x <- 1"));
    const plan=await api.planProjectReplace(directory([["a.R",target]]),"x","z");
    target.bytes=Buffer.from([0x78,0xff]);
    await assert.rejects(api.applyProjectReplacement(plan),/not valid UTF-8/);
    assert.deepEqual(target.bytes,Buffer.from([0x78,0xff]));
  });
  test(label+" rejects malformed Unicode replacement before planning writes", async () => {
    const target=file("a.R",Buffer.from("x <- 1"));
    await assert.rejects(api.planProjectReplace(directory([["a.R",target]]),
      "x",String.fromCharCode(0xd800)),/invalid Unicode/);
    assert.equal(target.bytes.toString(),"x <- 1");
  });
}
