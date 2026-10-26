"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const core = require("../web/ide_completion_core.js");

const snapshot = [
  {name:"analysis", type:"list", children:[
    {name:"[[1]] model", type:"list", children:[
      {name:"[[1]] score", type:"double"},
      {name:"[[2]] scale", type:"double"},
      {name:"[[3]] invalid name", type:"integer"},
      {name:"[[4]] <script>", type:"character"}
    ]},
    {name:"[[2]] seed", type:"integer"},
    {name:"[[3]] model", type:"list", children:[]}
  ]},
  {name:"trap", type:"active binding", children:[{name:"[[1]] secret", type:"integer"}]},
  {name:"df", type:"list", children:undefined}
];

function providerHarness() {
  let source = fs.readFileSync(path.join(__dirname, "../frontend/completion.js"), "utf8");
  source = source.replace(/^import '\/ide_completion_core\.js';\s*/m, "")
    .replace(/^export function /gm, "function ");
  const context = {FlowStudioCompletionCore:core, AbortController, Date, Promise};
  vm.runInNewContext(source + "\nglobalThis.__provider = {registerCompletion, sessionSymbols};", context);
  const providers = {};
  const monaco = {languages:{
    CompletionItemKind:{Snippet:1,Keyword:2,Variable:3,Text:4},
    registerCompletionItemProvider(language, provider) {
      providers[language] = provider;
      return {dispose() {}};
    }
  }};
  const fetches = [];
  const fetchFn = async (route, options) => {
    fetches.push({route, options});
    return {ok:true, json:async()=>({variables:snapshot})};
  };
  context.__provider.registerCompletion(monaco, {documents:{active:()=>({})}}, fetchFn);
  async function complete(language, line) {
    const model = {
      getLineContent:()=>line,
      getValue:()=>line,
      getOffsetAt:()=>line.length,
      getWordUntilPosition:()=>({startColumn:line.length})
    };
    return providers[language].provideCompletionItems(model, {lineNumber:1,column:line.length+1});
  }
  return {providers, fetches, complete, api:context.__provider};
}

test("R $ completion reads only bounded native list child metadata", () => {
  assert.deepEqual(core.rMemberContext("analysis$model$sc"), {
    path:["analysis","model"], prefix:"sc"
  });
  assert.deepEqual(core.rMemberContext("analysis$"), {path:["analysis"],prefix:""});
  assert.deepEqual(core.rListMembers(snapshot, ["analysis","model"],"sc")
    .map(item=>item.label), ["scale","score"]);
  assert.deepEqual(core.rListMembers(snapshot, ["analysis"],"se")
    .map(item=>item.label), ["seed"]);
});

test("R member lookup does not execute, guess attributes, or trust malformed labels", () => {
  assert.deepEqual(core.rListMembers(snapshot,["trap"],""),[]);
  assert.deepEqual(core.rListMembers(snapshot,["df"],""),[]);
  assert.deepEqual(core.rListMembers(snapshot,["analysis","unknown"],""),[]);
  assert.deepEqual(core.rListMembers(snapshot,["analysis","model"],"")
    .map(item=>item.label), ["scale","score"]);
  assert.deepEqual(core.rListMembers([{name:"x",type:"list",
    children:Array(13).fill({name:"[[1]] a",type:"integer"})}],["x"],""),[]);
  assert.equal(core.rMemberContext('print("analysis$sc")'),null);
  assert.equal(core.rMemberContext("# analysis$sc"),null);
  assert.equal(core.rMemberContext("analysis$sc # comment"),null);
  assert.equal(core.rMemberContext("analysis$"+String.fromCharCode(96)+"unsafe"+String.fromCharCode(96)),null);
  assert.equal(core.rMemberContext("analysis$child$nested$too$deep"),null);
  assert.equal(core.rMemberContext("analysis[1]$sc"),null);
});

test("Monaco $ completion inserts only the member, preserving receiver expression", async () => {
  const app = providerHarness();
  assert.ok(app.providers.r.triggerCharacters.includes("$"));
  const result = await app.complete("r", "analysis$model$sc");
  assert.deepEqual(Array.from(result.suggestions, item=>item.label),["scale","score"]);
  assert.equal(result.suggestions[0].insertText,"scale");
  assert.equal(result.suggestions[0].range.startColumn, "analysis$model$".length+1);
  assert.equal(result.suggestions[0].range.endColumn, "analysis$model$sc".length+1);
  assert.equal(app.fetches[0].route, "/api/inspect/r");
  assert.equal(app.fetches[0].options.headers["X-FlowStudio-Intent"],"run");
  assert.deepEqual(Array.from((await app.complete("r","trap$")).suggestions),[]);
  assert.deepEqual(Array.from((await app.complete("r","analysis$zz")).suggestions),[]);
});

test("normal Python and R symbol completion continues to use the same inspector", async () => {
  const app = providerHarness();
  const r = await app.complete("r","anal");
  assert.ok(r.suggestions.some(item=>item.label==="analysis"));
  const python = await app.complete("python","anal");
  assert.ok(python.suggestions.some(item=>item.label==="analysis"));
  const names = await app.api.sessionSymbols(async()=>({ok:true,json:async()=>({variables:snapshot})}),"r");
  assert.deepEqual(Array.from(names),["analysis","trap","df"]);
});
