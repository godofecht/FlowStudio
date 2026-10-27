"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");
const transfer = require("../docs/app/variable_transfer.js");

const workerSource = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
const packet = {kind:"table",columns:[
  {name:"score",type:"number",values:[1.25,null,2.5]},
  {name:"flag",type:"boolean",values:[true,null,false]},
  {name:"label",type:"string",values:["@NA@",null,"é"]},
  {name:"missing",type:"number",values:[null,null,null]}
]};
const control = value => ({value,disabled:false,addEventListener(){}});
function harness(options={}) {
  const queries=[], loaded=[], replies=[];
  const py = {
    async loadPackage(name) {
      loaded.push(name);
      if (options.loadError) throw Error("pandas package unavailable");
    },
    async runPythonAsync(query) { queries.push(query); return options.ack || "ok"; }
  };
  const self={postMessage:reply=>replies.push(reply)};
  vm.runInNewContext(workerSource,{self,TextEncoder,importScripts:()=>{},
    loadPyodide:async()=>py,fetch:async()=>({ok:true,text:async()=>""})});
  return {queries,loaded,replies,send:(id,op,name,value)=>self.onmessage({
    data:{id,op,code:name,value}
  })};
}
async function wait(h,n) {
  for (let i=0;i<100 && h.replies.length<n;i++)
    await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(h.replies.length,n,"worker did not respond");
}
function python(source) {
  return spawnSync("python3",["-c",source],{encoding:"utf8"});
}

test("R to pandas option is explicitly wired in the real browser workspace", () => {
  assert.match(html,/id="transferAsPandas" type="checkbox"/);
  assert.match(html,/pandas:\$\("transferAsPandas"\)/);
  assert.match(html,/R table → pandas DataFrame/);
});

test("controller opts into pandas only for R tables; normal transfers are unchanged", async () => {
  const direction=control("r-to-python"), source=control("data"), destination=control("copy");
  const button=control(""), pandas={checked:true}, calls=[], notices=[];
  let busy=false;
  const rSession=()=>({
    exportVariable:async name=>{calls.push(["r-export",name]);return {ok:true,value:packet};},
    importVariable:async(name,value)=>{calls.push(["r-import",name,value]);return {ok:true};}
  });
  const controller=transfer.create({direction,source,destination,button,pandas,rSession,
    python:async(op,name,value)=>{calls.push(["python",op,name,value]);return op==="export"?{ok:true,value:packet}:{ok:true};},
    notice:message=>notices.push(message),isBusy:()=>busy,setBusy:value=>{busy=value;},
    generation:()=>0});
  assert.equal(await controller.transfer(),true);
  assert.deepEqual(calls[1],["python","import-pandas","copy",packet]);
  assert.match(notices.at(-1),/as pandas DataFrame/);
  pandas.checked=false;
  assert.equal(await controller.transfer(),true);
  assert.equal(calls[3][1],"import");
  pandas.checked=true;
  direction.value="python-to-r";
  assert.equal(await controller.transfer(),true);
  assert.deepEqual(calls.slice(4).map(call=>call[0]),["python","r-import"]);
  assert.equal(calls[4][1],"export");
  assert.equal(button.disabled,false);
  assert.equal(busy,false);
});

test("pandas mode rejects non-table R values before Python mutation", async () => {
  let imported=0, busy=false;const notices=[];
  const controller=transfer.create({
    direction:control("r-to-python"),source:control("x"),destination:control("copy"),
    button:control(""),pandas:{checked:true},
    rSession:()=>({exportVariable:async()=>({ok:true,value:{kind:"scalar",type:"number",values:[2]}})}),
    python:async()=>{imported++;return {ok:true};},
    notice:s=>notices.push(s),isBusy:()=>busy,setBusy:v=>{busy=v;},generation:()=>0
  });
  assert.equal(await controller.transfer(),false);
  assert.equal(imported,0);
  assert.match(notices.at(-1),/requires an R data.frame/);
  assert.equal(busy,false);
});

test("worker only loads pandas after a bounded typed table passes preflight", async () => {
  const h=harness();
  h.send(1,"import-pandas","copy",packet);
  h.send(2,"import-pandas","copy",{kind:"scalar",type:"number",values:[1]});
  h.send(3,"import-pandas","copy",{kind:"table",columns:[{name:"x",type:"number",values:[Infinity]}]});
  h.send(4,"import-pandas","bad-name",packet);
  h.send(5,"import-pandas","copy",{kind:"table",columns:[packet.columns[0],packet.columns[0]]});
  await wait(h,5);
  assert.deepEqual(h.replies.slice().sort((a,b)=>a.id-b.id).map(reply=>reply.ok),
    [true,false,false,false,false]);
  assert.deepEqual(h.loaded,["pandas"]);
  assert.equal(h.queries.length,1);
  assert.match(h.queries[0],/dtype=_fs_transfer_dtype/);
  assert.match(h.queries[0],/globals\(\)\["copy"\] = _fs_transfer_frame/);
  assert.ok(h.queries[0].indexOf("_fs_transfer_frame =") <
    h.queries[0].indexOf('globals()["copy"] ='));
});

test("missing pandas or a failed acknowledgement never reports transfer success", async () => {
  const missing=harness({loadError:true});
  missing.send(1,"import-pandas","copy",packet);
  await wait(missing,1);
  assert.equal(missing.replies[0].ok,false);
  assert.match(missing.replies[0].output,/pandas package unavailable/);
  assert.equal(missing.queries.length,0);
  const rejected=harness({ack:"unexpected"});
  rejected.send(2,"import-pandas","copy",packet);
  await wait(rejected,1);
  assert.equal(rejected.replies[0].ok,false);
  assert.match(rejected.replies[0].output,/did not acknowledge/);
});

test("actual CPython pandas import preserves order, nullable types, missing cells and Unicode", async t => {
  const probe=python("import pandas");
  if (probe.status!==0) {
    if (process.env.FLOWSTUDIO_REQUIRE_PANDAS==="1")
      assert.fail("pandas is required for independent CI acceptance: "+(probe.stderr||probe.error));
    return t.skip("pandas unavailable locally; not evidence of pandas acceptance");
  }
  const h=harness();
  h.send(1,"import-pandas","copied",packet);
  await wait(h,1);
  const result=python(h.queries[0]+"\n"+
    "import pandas as pd\n"+
    "assert type(copied) is pd.DataFrame\n"+
    "assert list(copied.columns) == ['score','flag','label','missing']\n"+
    "assert list(map(str,copied.dtypes)) == ['Float64','boolean','string','Float64']\n"+
    "assert copied['score'].tolist()[0] == 1.25\n"+
    "assert copied['score'].isna().tolist() == [False,True,False]\n"+
    "assert copied['flag'].isna().tolist() == [False,True,False]\n"+
    "assert copied['label'].tolist()[0] == '@NA@'\n"+
    "assert copied['label'].tolist()[2] == 'é'\n"+
    "assert copied['missing'].isna().all()\n");
  assert.equal(result.status,0,result.stderr);
  const empty={kind:"table",columns:[{name:"score",type:"number",values:[]}]};
  const z=harness();
  z.send(1,"import-pandas","empty",empty);
  await wait(z,1);
  const zero=python(z.queries[0]+"\nassert empty.shape == (0,1)\nassert str(empty.dtypes.iloc[0]) == 'Float64'\n");
  assert.equal(zero.status,0,zero.stderr);
});

test("pandas construction failure does not overwrite an existing destination", async t => {
  const probe=python("import pandas");
  if (probe.status!==0) {
    if (process.env.FLOWSTUDIO_REQUIRE_PANDAS==="1")
      assert.fail("pandas required for atomic import acceptance: "+(probe.stderr||probe.error));
    return t.skip("pandas unavailable locally");
  }
  const h=harness();
  h.send(1,"import-pandas","copied",packet);
  await wait(h,1);
  const indented=h.queries[0].split("\n").map(line=>"    "+line).join("\n");
  const result=python(
    "import pandas as pd\n"+
    "copied = 'unchanged'\n"+
    "def fail(*args,**kwargs): raise RuntimeError('constructor failed')\n"+
    "pd.Series = fail\n"+
    "try:\n"+indented+"\n"+
    "except RuntimeError:\n    pass\n"+
    "assert copied == 'unchanged'\n");
  assert.equal(result.status,0,result.stderr);
});
