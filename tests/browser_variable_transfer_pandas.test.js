"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");
const transfer = require("../docs/app/variable_transfer.js");

const workerSource = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
const expected = {kind:"table",columns:[
  {name:"score",type:"number",values:[1.25,null,2.5]},
  {name:"flag",type:"boolean",values:[true,null,false]},
  {name:"label",type:"string",values:["@NA@",null,"é"]}
]};

async function exportQuery() {
  const queries = [], replies = [];
  const py = {async runPythonAsync(query) {
    queries.push(query);
    return JSON.stringify(expected);
  }};
  const self = {postMessage:message=>replies.push(message)};
  vm.runInNewContext(workerSource, {self, TextEncoder, importScripts:()=>{},
    loadPyodide:async()=>py, fetch:async()=>({ok:true,text:async()=>""})});
  self.onmessage({data:{id:1,op:"export",code:"data"}});
  for (let i=0; i<100 && !replies.length; i++)
    await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(replies.length,1,"Pyodide export worker did not respond");
  assert.equal(replies[0].ok,true);
  assert.equal(queries.length,1);
  return queries[0];
}
function runPython(query, setup) {
  const lines=query.split("\n");
  lines[lines.length-1] = "print(" + lines.at(-1) + ")";
  return spawnSync("python3",["-c",setup+"\n"+lines.join("\n")],{encoding:"utf8"});
}

test("worker exports pandas only through the existing bounded typed-table packet", async () => {
  const query = await exportQuery();
  assert.match(query,/type\(_fs_transfer_obj\) is _fs_transfer_pd.DataFrame/);
  assert.match(query,/type\(_fs_transfer_obj.index\) is not _fs_transfer_pd.RangeIndex/);
  assert.match(query,/Unsupported pandas column dtype/);
  assert.match(query,/Invalid or duplicate pandas column name/);
  assert.match(query,/allow_nan=False/);
  assert.equal(transfer.validate(expected),expected);
});

test("plain dictionary transfers work without importing pandas", async t => {
  const probe=spawnSync("python3",["--version"],{encoding:"utf8"});
  if (probe.error) return t.skip("python3 unavailable");
  const query=await exportQuery();
  const result=runPython(query,
    "data = {'score': [1.25, None, 2.5], 'flag': [True, None, False], 'label': ['@NA@', None, 'é']}\n" +
    "assert 'pandas' not in __import__('sys').modules");
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),expected);
});

test("actual pandas nullable data frame transfers typed values and missing cells", async t => {
  const probe=spawnSync("python3",["-c","import pandas"],{encoding:"utf8"});
  if (probe.status!==0) {
    if (process.env.FLOWSTUDIO_REQUIRE_PANDAS === "1") assert.fail("pandas is required for independent CI acceptance: " + (probe.stderr || probe.error || "import failed"));
    return t.skip("pandas unavailable locally; not proof of pandas acceptance");
  }
  const query=await exportQuery();
  const setup = "import pandas as pd\n" +
    "data = pd.DataFrame({'score': pd.Series([1.25,None,2.5],dtype='Float64'), " +
    "'flag': pd.Series([True,None,False],dtype='boolean'), " +
    "'label': pd.Series(['@NA@',None,'é'],dtype='string')})";
  const result=runPython(query,setup);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),expected);
  assert.equal(transfer.validate(JSON.parse(result.stdout)).kind,"table");

  const plain=runPython(query,
    "import pandas as pd\n" +
    "data = pd.DataFrame({'score':[1.25,float('nan'),2.5]," +
    "'flag':[True,False,True], 'label':['a','b','c']})");
  assert.equal(plain.status,0,plain.stderr);
  const decoded=JSON.parse(plain.stdout);
  assert.deepEqual(decoded.columns[0].values,[1.25,null,2.5]);
  assert.deepEqual(decoded.columns[1].values,[true,false,true]);
});

test("fixed-width pandas numeric dtypes preserve exact values and reject unsafe uint64", async t => {
  const probe=spawnSync("python3",["-c","import pandas"],{encoding:"utf8"});
  if (probe.status!==0) {
    if (process.env.FLOWSTUDIO_REQUIRE_PANDAS === "1") assert.fail("pandas is required for numeric dtype acceptance: " + (probe.stderr || probe.error || "import failed"));
    return t.skip("pandas unavailable locally");
  }
  const query=await exportQuery();
  const result=runPython(query,
    "import pandas as pd\\n" +
    "data = pd.DataFrame({'half':pd.Series([1.5,2],dtype='float16')," +
    "'single':pd.Series([1.25,float('nan')],dtype='float32')," +
    "'signed':pd.Series([-2,3],dtype='int32')," +
    "'unsigned':pd.Series([4,5],dtype='uint32')})");
  assert.equal(result.status,0,result.stderr);
  const packet=JSON.parse(result.stdout);
  assert.deepEqual(packet,{kind:"table",columns:[
    {name:"half",type:"number",values:[1.5,2]},
    {name:"single",type:"number",values:[1.25,null]},
    {name:"signed",type:"number",values:[-2,3]},
    {name:"unsigned",type:"number",values:[4,5]}
  ]});
  assert.equal(transfer.validate(packet),packet);
  const unsafe=runPython(query,
    "import pandas as pd\\n" +
    "data = pd.DataFrame({'large':pd.Series([9007199254740992],dtype='uint64')})");
  assert.notEqual(unsafe.status,0,"uint64 above JS safe integer range must be rejected");
});

test("pandas export rejects lossy or unsafe frames before packet creation", async t => {
  const probe=spawnSync("python3",["-c","import pandas"],{encoding:"utf8"});
  if (probe.status!==0) {
    if (process.env.FLOWSTUDIO_REQUIRE_PANDAS === "1") assert.fail("pandas is required for independent CI rejection tests: " + (probe.stderr || probe.error || "import failed"));
    return t.skip("pandas unavailable locally");
  }
  const query=await exportQuery();
  const invalid=[
    "data = pd.DataFrame({'x':[1]},index=[5])",
    "data = pd.DataFrame({'x':[1]}); data.index = pd.RangeIndex(1,2)",
    "data = pd.DataFrame({'x':[1],'y':[2]}); data.columns=['x','x']",
    "data = pd.DataFrame({'bad-name':[1]})",
    "data = pd.DataFrame({'x':pd.Categorical(['a'])})",
    "data = pd.DataFrame({'x':[pd.Timestamp('2020-01-01')]})",
    "data = pd.DataFrame({'x':[float('inf')]})",
    "data = pd.DataFrame({'x':[None,None]})",
    "data = pd.DataFrame({'x':[1]*129})",
    "data = pd.DataFrame({'x':[]})",
    "class Custom(pd.DataFrame): pass\ndata = Custom({'x':[1]})",
    "class Trap:\n def __str__(self): raise RuntimeError('unexpected repr')\ndata = pd.DataFrame({'x':[Trap()]})"
  ];
  for (const definition of invalid) {
    const result=runPython(query,"import pandas as pd\n"+definition);
    assert.notEqual(result.status,0,"unexpectedly exported: "+definition);
    assert.doesNotMatch(result.stderr,/unexpected repr/);
  }
});
