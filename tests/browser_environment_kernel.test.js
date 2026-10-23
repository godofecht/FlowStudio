"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const worker = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
test("browser table integration is wired to persistent Python and R runtimes", () => {
  assert.match(html, /src="\.\/data_viewer\.js"/);
  assert.match(html, /src="\.\/environment_data\.js"/);
  assert.match(html, /getRSession\(\)\.table\(name\)/);
  assert.match(html, /request\("table", name\)/);
  assert.match(html, /viewEnvironmentVariable\(variable\.name\)/);
  assert.match(html, /environmentData\.clear\(\)/);
  const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(inline);
  assert.doesNotThrow(() => new vm.Script(inline[1]));
});
test("Python worker rejects expression injection and uses real bounded helper", async () => {
  const messages = [];
  let imported = 0, written = "";
  const py = {
    FS:{writeFile(name,source){written=name+":"+source;}},
    async runPythonAsync(code) {
      assert.match(code, /_fs_data_capture\.capture\("records", globals\(\)\)/);
      return JSON.stringify({columns:["a"],rows:[["1"]],totalRows:1,truncated:false});
    }
  };
  const context = {
    self:{postMessage:message=>messages.push(message)},
    TextEncoder, console,
    importScripts:()=>{imported++;},
    loadPyodide:async()=>py,
    fetch:async()=>({ok:true,text:async()=>"# Python table capture helper"})
  };
  vm.runInNewContext(worker, context, {filename:"python-worker.js"});
  context.self.onmessage({data:{id:1,op:"table",code:"records"}});
  for (let i=0;i<20 && !messages.length;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(messages.length,1);
  assert.equal(messages[0].ok,true);
  assert.equal(messages[0].table.rows[0][0],"1");
  assert.match(written,/flowstudio_data_capture\.py/);
  assert.equal(imported,1);
  context.self.onmessage({data:{id:2,op:"table",code:"records);system('bad')"}});
  for (let i=0;i<20 && messages.length<2;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(messages[1].ok,false);
  assert.equal(imported,1);
});
