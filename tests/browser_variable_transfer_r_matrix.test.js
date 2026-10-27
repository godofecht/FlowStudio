"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
require("../docs/app/variable_transfer.js");
const {create} = require("../docs/app/r_session.js");
const workerSource = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");

const numericRows = ["@TABLE@", "2", "3", "V1", "double",
  "1.5e+00", "@NA@", "3e+00", "V2", "double", "4e+00", "5e+00", "@NA@"];
const unicodeRows = ["@TABLE@", "2", "2", "V1", "character",
  "%C3%A9", "%E6%9D%B1%E4%BA%AC", "V2", "character", "%F0%9F%99%82", ""];
function sessionWithReply(reply) {
  const queries = [];
  class WebR {
    async init() {}
    close() {}
    async evalRRaw(query, type) {
      assert.equal(type, "string[]");
      queries.push(query);
      return reply;
    }
  }
  return {queries, session:create({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})})};
}
function worker() {
  const replies=[], queries=[];
  const py={async loadPackage(name){assert.equal(name,"numpy");},
    async runPythonAsync(query){queries.push(query);return "ok";}};
  const self={postMessage:message=>replies.push(message)};
  vm.runInNewContext(workerSource,{self,TextEncoder,importScripts:()=>{},
    loadPyodide:async()=>py,fetch:async()=>({ok:true,text:async()=>""})});
  return {queries,replies,send:(id,name,value)=>self.onmessage({
    data:{id,op:"import-numpy",code:name,value}
  })};
}
async function waitFor(h, count) {
  for (let i=0;i<150 && h.replies.length<count;i++)
    await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(h.replies.length,count);
}
function runPython(code){return spawnSync("python3",["-c",code],{encoding:"utf8"});}
function requireNumpy(t) {
  const result=runPython("import numpy");
  if (result.status===0) return true;
  if (process.env.FLOWSTUDIO_REQUIRE_PANDAS==="1")
    assert.fail("NumPy required in independent source CI: "+(result.stderr||result.error));
  t.skip("NumPy unavailable; no real ndarray acceptance claimed");
  return false;
}

test("webR exports a plain matrix using the existing bounded typed-table protocol", async () => {
  const h=sessionWithReply(numericRows);
  const result=await h.session.exportVariable("matrix_data");
  assert.equal(result.ok,true);
  assert.deepEqual(result.value,{kind:"table",columns:[
    {name:"V1",type:"number",values:[1.5,null,3]},
    {name:"V2",type:"number",values:[4,5,null]}
  ]});
  const query=h.queries[0];
  assert.match(query,/base::is.matrix\(v\) && !base::is.object\(v\)/);
  assert.match(query,/base::names\(base::attributes\(v\)\)/);
  assert.match(query,/base::as.data.frame.matrix\(v, optional=TRUE/);
  assert.match(query,/base::paste0\("V", base::seq_len\(base::ncol\(v\)\)\)/);
  assert.match(query,/base::nrow\(v\) > 128L/);
  assert.match(query,/d\[\[2L\]\] > 16L/);
});

test("matrix wire packet reaches actual 2D NumPy with column-major R ordering", async t => {
  const h=sessionWithReply(numericRows);
  const result=await h.session.exportVariable("m");
  const w=worker();
  w.send(1,"m_copy",result.value);
  await waitFor(w,1);
  assert.equal(w.replies[0].ok,true);
  assert.match(w.queries[0],/column_stack/);
  if (!requireNumpy(t)) return;
  const actual=runPython(w.queries[0]+"\nimport numpy as np\n"+
    "assert type(m_copy) is np.ndarray\n"+
    "assert m_copy.shape == (3,2) and m_copy.dtype == np.dtype('float64')\n"+
    "assert m_copy[0].tolist() == [1.5,4.0]\n"+
    "assert np.isnan(m_copy[1,0]) and m_copy[1,1] == 5\n"+
    "assert m_copy[2,0] == 3 and np.isnan(m_copy[2,1])\n");
  assert.equal(actual.status,0,actual.stderr);
});

test("character R matrices retain Unicode in real NumPy arrays", async t => {
  const h=sessionWithReply(unicodeRows);
  const packet=(await h.session.exportVariable("labels")).value;
  assert.deepEqual(packet.columns.map(c=>c.values),[["é","東京"],["🙂",""]]);
  const w=worker();w.send(1,"labels_copy",packet);await waitFor(w,1);
  assert.equal(w.replies[0].ok,true);
  if (!requireNumpy(t)) return;
  const actual=runPython(w.queries[0]+"\nimport numpy as np\n"+
    "assert type(labels_copy) is np.ndarray and labels_copy.shape == (2,2)\n"+
    "assert labels_copy.dtype.kind == 'U'\n"+
    "assert labels_copy.tolist() == [['é','🙂'],['東京','']]\n");
  assert.equal(actual.status,0,actual.stderr);
});

test("real Rscript exports numeric and logical matrices and rejects unsafe matrix metadata", async t => {
  const probe=spawnSync("Rscript",["--version"],{encoding:"utf8"});
  if (probe.error) return t.skip("Rscript unavailable locally; native acceptance required");
  const h=sessionWithReply(numericRows);
  await h.session.exportVariable("m");
  const query=h.queries[0];
  const positive=[
    ["m <- matrix(c(1.5, NA_real_, 3, 4, 5, NA_real_), nrow=3L)",
      ["@TABLE@","2","3","V1","double"]],
    ["m <- matrix(c(TRUE,FALSE,FALSE,TRUE), nrow=2L)",
      ["@TABLE@","2","2","V1","logical"]],
    ["m <- matrix(c('é','東京','🙂',''), nrow=2L)",
      ["@TABLE@","2","2","V1","character"]]
  ];
  for (const [setup,prefix] of positive) {
    const r=spawnSync("Rscript",["--vanilla","-e",
      setup+"\nresult <- "+query+"\ncat(paste(result, collapse='\\n'))"],{encoding:"utf8"});
    assert.equal(r.status,0,r.stderr);
    const rows=r.stdout.split("\n");
    assert.deepEqual(rows.slice(0,5),prefix);
    assert.equal(rows.length,3+Number(rows[1])*(2+Number(rows[2])));
  }
  const rejected=[
    "m <- matrix(1:4, nrow=2L, dimnames=list(NULL,c('a','b')))",
    "m <- structure(matrix(1:4, nrow=2L), custom=TRUE)",
    "m <- structure(matrix(1:4, nrow=2L), class='custom_matrix')",
    "m <- matrix(numeric(0), nrow=0L, ncol=2L)",
    "m <- matrix(1:129, ncol=1L)",
    "m <- matrix(1:17, nrow=1L)",
    "m <- matrix(c(Inf,1,2,3), nrow=2L)",
    "m <- matrix(c(NaN,1,2,3), nrow=2L)",
    "m <- matrix(c(9007199254740992,1,2,3), nrow=2L)"
  ];
  for (const setup of rejected) {
    const r=spawnSync("Rscript",["--vanilla","-e",setup+"\n"+query],{encoding:"utf8"});
    assert.notEqual(r.status,0,"Unsafe matrix accepted: "+setup);
  }
});
