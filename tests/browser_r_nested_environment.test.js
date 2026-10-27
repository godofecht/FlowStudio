"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");
const {INSPECT, parseInspection, create} = require("../docs/app/r_session.js");

const encode = value => encodeURIComponent(value);
const row = (depth, name, type, shape = "", preview = "", more = false) =>
  [depth, name, type, shape, preview].map((value, i) =>
    i === 0 ? String(value) : encode(value)).concat(more ? "1" : "0").join("\t");

test("bounded nested R metadata reconstructs two levels and preserves shape", () => {
  const result = parseInspection(["@1",
    row(0, "analysis", "list", "", "list [2]"),
    row(1, "[[1]] model", "list", "", "list [1]"),
    row(2, "[[1]] score", "double", "", "0.75"),
    row(1, "[[2]] matrix", "matrix/array (double)", "2 x 3", "double [6]"),
    row(0, "trap", "active binding", "", "<not evaluated>")]);
  assert.equal(result.truncated, true);
  assert.equal(result.variables.length, 2);
  assert.deepEqual(result.variables[0].children[0].children[0], {
    name:"[[1]] score", type:"double", shape:null, preview:"0.75"
  });
  assert.deepEqual(result.variables[0].children[1].shape, ["2", "3"]);
  assert.equal(result.variables[1].type, "active binding");
});

test("malformed R inspection responses fail closed", () => {
  for (const rows of [
    [], ["bad"], ["@0", row(1, "orphan", "integer")],
    ["@0", row(0, "scalar", "double"), row(1, "child", "integer")],
    ["@0", row(0, "x", "list"), row(2, "skipped", "double")],
    ["@0", "0\t%ZZ\tlist\t\t\t0"],
    ["@0", row(0, "x", "list").replace(/\t0$/, "\t2")],
    ["@0", row(0, "x".repeat(161), "list")],
    ["@0", row(0, "x", "list"), ...Array.from({length:13}, (_,i)=>row(1, "[["+i+"]]", "double"))],
    ["@0", ...Array.from({length:129}, (_,i)=>row(0, "v"+i, "double"))]
  ]) assert.throws(() => parseInspection(rows));
});

test("webR inspect uses the actual bounded query and never evaluates source in JavaScript", async () => {
  const calls = [];
  class WebR {
    async init() {}
    async evalRRaw(query, type) {
      calls.push({query, type});
      return ["@0", row(0, "items", "list", "", "list [1]"),
        row(1, "[[1]] alpha", "integer", "", "3")];
    }
  }
  const session = create({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})});
  const result = await session.inspect();
  assert.equal(result.ok, true);
  assert.equal(result.variables[0].children[0].preview, "3");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, INSPECT);
  assert.equal(calls[0].type, "string[]");
  assert.match(INSPECT, /base::bindingIsActive\(name, base::globalenv\(\)\)/);
  assert.doesNotMatch(INSPECT, /capture\.output\(str\(/);
});

test("Pages environment renders expandable metadata as text without HTML injection", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  const start = html.indexOf("function renderEnvironment(variables, truncated = false) {");
  const end = html.indexOf("async function run(", start);
  assert.ok(start >= 0 && end > start);
  class Node {
    constructor(tag) { this.tag=tag; this.children=[]; this.textContent=""; this.attributes={}; }
    setAttribute(k,v) { this.attributes[k]=v; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children=nodes; }
    addEventListener() {}
  }
  const target = new Node("div");
  const context = {document:{createElement:tag=>new Node(tag)},
    environmentData:{clear(){}}, $:id=>id==="environment"?target:{value:"r"}};
  vm.runInNewContext(html.slice(start,end), context);
  context.renderEnvironment([{name:"items",type:"list",shape:null,preview:"list [1]",
    children:[{name:"[[1]]",type:"character",shape:null,preview:"<img onerror=alert(1)>"}]}],true);
  const flatten = node => [node, ...node.children.flatMap(flatten)];
  const nodes = flatten(target);
  assert.ok(nodes.some(n=>n.tag==="details"));
  assert.ok(nodes.some(n=>n.tag==="summary"));
  assert.ok(nodes.some(n=>n.tag==="caption" && /truncated/.test(n.textContent)));
  assert.ok(nodes.some(n=>n.tag==="span" && n.textContent.includes("<img onerror=alert(1)>")));
  assert.equal(nodes.some(n=>n.tag==="img"),false);
});

test("generated inspector runs under real Rscript, avoids active bindings and bounds lists", t => {
  const version = spawnSync("Rscript", ["--version"], {encoding:"utf8"});
  if (version.error) return t.skip("Rscript unavailable outside native acceptance");
  const setup = [
    'items <- list(alpha=3L, child=list(beta="ok"), many=as.list(1:20))',
    'mat <- matrix(1:6, nrow=2)',
    'df <- data.frame(x=1:3, y=c("a","b","c"))',
    'object <- structure(list(secret=7), class="custom")',
    'tripped <- FALSE',
    'head <- function(...) stop("masked head executed")',
    'ls <- function(...) stop("masked ls executed")',
    'paste <- function(...) stop("masked paste executed")',
    'bindingIsActive <- function(...) stop("masked binding check executed")',
    'makeActiveBinding("trap", function() { assign("tripped", TRUE, envir=.GlobalEnv); stop("active binding invoked") }, .GlobalEnv)',
    'delayedAssign("broken", stop("lazy binding failure"), assign.env=.GlobalEnv)',
    '.GlobalEnv <- new.env(parent=emptyenv())'
  ].join("\n");
  const program = setup + "\n._fs_rows <- " + INSPECT +
    '\ncat(base::paste(._fs_rows, collapse="\\n"), "\\n", sep="")' +
    '\ncat(if (tripped) "ACTIVE_CALLED" else "ACTIVE_SAFE", "\\n", sep="")';
  const proc = spawnSync("Rscript", ["--vanilla", "-e", program],
    {encoding:"utf8", timeout:30000, maxBuffer:1024*1024});
  assert.equal(proc.status,0,proc.stderr || proc.error?.message);
  const lines = proc.stdout.trimEnd().split(/\r?\n/);
  assert.equal(lines.pop(),"ACTIVE_SAFE");
  let result;
  try { result = parseInspection(lines); }
  catch (error) {
    throw Error("Rscript emitted invalid inspector rows: " + error.message +
      "; rows=" + JSON.stringify(lines.slice(0, 24)));
  }
  const byName = Object.fromEntries(result.variables.map(v=>[v.name,v]));
  assert.equal(byName.trap.type,"active binding");
  assert.equal(byName.broken.type,"unavailable");
  assert.equal(byName.df.type,"data.frame");
  assert.deepEqual(byName.df.shape,["3","2"]);
  assert.deepEqual(byName.mat.shape,["2","3"]);
  assert.equal(byName.object.children,undefined);
  assert.equal(byName.items.children[0].preview,"3");
  assert.equal(byName.items.children[1].children[0].preview,"ok");
  assert.equal(byName.items.children[2].children.length,12);
  assert.equal(byName.items.children[2].truncated,true);
});
