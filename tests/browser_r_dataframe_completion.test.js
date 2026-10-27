"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const {INSPECT, parseInspection, create} = require("../docs/app/r_session.js");
const {rListMembers, rMemberContext, prefixAt} = require("../docs/app/completion.js");

const row = (depth, name, type, more = false) =>
  [String(depth), name, type, "", ""].map((part, index) =>
    index ? encodeURIComponent(part) : part).concat(more ? "1" : "0").join("\t");

test("R data.frame columns complete from bounded inspector metadata", () => {
  const inspected = parseInspection(["@0",
    row(0, "data", "data.frame"),
    row(1, "[[1]] score", "column"),
    row(1, "[[2]] scale", "column"),
    row(1, "[[3]] if", "column"),
    row(1, "[[4]] unsafe-name", "column"),
    row(0, "nested", "list"),
    row(1, "[[1]] frame", "data.frame"),
    row(2, "[[1]] signal", "column")]);
  assert.deepEqual(rListMembers(inspected.variables, ["data"], "sc").map(x=>x.label),
    ["scale", "score"]);
  assert.deepEqual(rListMembers(inspected.variables, ["nested","frame"], "si").map(x=>x.label),
    ["signal"]);
  assert.deepEqual(rListMembers(inspected.variables, ["data"], "").map(x=>x.label),
    ["scale", "score"]);
  assert.deepEqual(rMemberContext("data$sc"), {path:["data"],prefix:"sc"});
  assert.deepEqual(prefixAt({value:"data$sc",selectionStart:7,selectionEnd:7},"r").memberPath, ["data"]);
});

test("R column completion rejects classed objects, malformed trees and unsafe paths", () => {
  const bad = [{name:"obj",type:"custom",children:[{name:"[[1]] secret",type:"column"}]},
    {name:"active",type:"active binding",children:[{name:"[[1]] trap",type:"column"}]},
    {name:"frame",type:"data.frame",children:[{name:"[[1]] safe",type:"column"}]}];
  assert.deepEqual(rListMembers(bad,["obj"],""),[]);
  assert.deepEqual(rListMembers(bad,["active"],""),[]);
  assert.deepEqual(rListMembers(bad,["frame","safe"],""),[]);
  assert.deepEqual(rListMembers(bad,["frame"],"sa").map(x=>x.label),["safe"]);
  assert.deepEqual(rListMembers(bad,["frame;evil()"],""),[]);
  assert.throws(()=>parseInspection(["@0",row(0,"x","double"),row(1,"[[1]] injected","column")]));
  assert.throws(()=>parseInspection(["@0",row(0,"df","data.frame"),
    ...Array.from({length:13},(_,i)=>row(1,"[["+(i+1)+"]] x"+i,"column"))]));
});

test("webR session uses the actual bounded inspection query for columns", async () => {
  const calls = [];
  class WebR {
    async init() {}
    async evalRRaw(query, type) {
      calls.push({query,type});
      return ["@0",row(0,"df","data.frame"),row(1,"[[1]] score","column")];
    }
  }
  const session = create({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})});
  const result = await session.inspect();
  assert.equal(result.ok,true);
  assert.deepEqual(rListMembers(result.variables,["df"],"sc").map(x=>x.label),["score"]);
  assert.equal(calls[0].query,INSPECT);
  assert.equal(calls[0].type,"string[]");
  assert.match(INSPECT,/base::identical\(classes, "data.frame"\)/);
  assert.match(INSPECT,/push\(depth \+ 1L, label, "column"/);
});

test("real Rscript inspector enumerates exact data.frame names without active bindings", t => {
  const probe = spawnSync("Rscript",["--version"],{encoding:"utf8"});
  if (probe.error) return t.skip("Rscript unavailable locally; native CI required");
  const setup = [
    "df <- data.frame(score=1:3, scale=c(2,3,4), check.names=FALSE)",
    "nested <- list(frame=df)",
    "custom <- structure(list(secret=1), class='custom')",
    "many <- as.data.frame(setNames(as.list(1:13), paste0('c',1:13)))",
    "tripped <- FALSE",
    "makeActiveBinding('trap', function() { tripped <<- TRUE; stop('invoked') }, .GlobalEnv)"
  ].join("\n");
  const program = setup + "\n._rows <- " + INSPECT +
    "\ncat(base::paste(._rows,collapse='\\n'), '\\n', sep='')" +
    "\ncat(if (tripped) 'ACTIVE_CALLED' else 'ACTIVE_SAFE', '\\n', sep='')";
  const proc = spawnSync("Rscript",["--vanilla","-e",program],
    {encoding:"utf8",timeout:30000,maxBuffer:1024*1024});
  assert.equal(proc.status,0,proc.stderr || proc.error?.message);
  const rows = proc.stdout.trimEnd().split(/\r?\n/);
  assert.equal(rows.pop(),"ACTIVE_SAFE");
  const vars = parseInspection(rows).variables;
  assert.deepEqual(rListMembers(vars,["df"],"sc").map(x=>x.label),["scale","score"]);
  assert.deepEqual(rListMembers(vars,["nested","frame"],"sc").map(x=>x.label),["scale","score"]);
  assert.deepEqual(rListMembers(vars,["many"],"c").map(x=>x.label),
    Array.from({length:12},(_,i)=>"c"+(i+1)).sort());
  assert.equal(vars.find(v=>v.name==="many").truncated,true);
  assert.equal(vars.find(v=>v.name==="custom").children,undefined);
  assert.equal(vars.find(v=>v.name==="trap").type,"active binding");
});
