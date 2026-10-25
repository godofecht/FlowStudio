"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const engine = require("../docs/app/editor_find.js");
const {create} = require("../docs/app/find_panel.js");
function element(value = "") {
  return {
    value, checked:false, textContent:"", selectionStart:0, selectionEnd:0,
    handlers:{}, focused:false,
    addEventListener(name, fn) {(this.handlers[name] ||= []).push(fn);},
    dispatchEvent(event) {for (const fn of this.handlers[event.type] || []) fn(event);},
    focus() {this.focused = true;},
    setSelectionRange(start,end) {this.selectionStart=start;this.selectionEnd=end;},
    setRangeText(text,start,end) {
      this.value = this.value.slice(0,start)+text+this.value.slice(end);
      this.selectionStart=start;this.selectionEnd=start+text.length;
    },
    fire(name, data={}) {
      const event = {type:name, preventDefault(){this.prevented=true;}, ...data};
      this.dispatchEvent(event);
      return event;
    }
  };
}
function fixture(value="One one ONE") {
  const source=element(value), query=element(), replacement=element(), caseSensitive=element(), regex=element(), wholeWord=element();
  const status=element(), nextButton=element(), previousButton=element(), replaceButton=element(), allButton=element();
  let inputs=0;
  source.addEventListener("input",()=>inputs++);
  const api=create({source,query,replacement,caseSensitive,regex,wholeWord,status,nextButton,previousButton,
    replaceButton,allButton,document:{},engine});
  return {source,query,replacement,caseSensitive,regex,wholeWord,status,nextButton,previousButton,
    replaceButton,allButton,api,inputs:()=>inputs};
}
test("find navigates forwards/backwards with wrap, case sensitivity and status",()=>{
  const f=fixture();
  f.query.value="one";f.query.fire("input");
  assert.match(f.status.textContent,/3 matches/);
  assert.equal(f.api.move(),true);
  assert.deepEqual([f.source.selectionStart,f.source.selectionEnd],[0,3]);
  f.api.move();assert.equal(f.source.selectionStart,4);
  f.api.move();assert.equal(f.source.selectionStart,8);
  f.api.move();assert.equal(f.source.selectionStart,0);
  f.api.move(true);assert.equal(f.source.selectionStart,8);
  f.caseSensitive.checked=true;f.caseSensitive.fire("change");
  assert.match(f.status.textContent,/1 matches/);
  f.api.move();assert.equal(f.source.selectionStart,4);
});
test("replace selected match preserves other text and emits real input for drafts",()=>{
  const f=fixture("print(1)\nprint(2)");
  f.query.value="print";f.replacement.value="echo";
  assert.equal(f.api.move(),true);
  assert.equal(f.api.replaceOne(),true);
  assert.equal(f.source.value,"echo(1)\nprint(2)");
  assert.equal(f.inputs(),1);
  assert.equal(f.api.replaceOne(),false);
  assert.equal(f.inputs(),1);
  assert.match(f.status.textContent,/Select a matching occurrence/);
});
test("replace all updates editor and dispatches exactly one input",()=>{
  const f=fixture("α α\r\nα");
  f.query.value="α";f.replacement.value="beta";
  assert.equal(f.api.replaceAll(),3);
  assert.equal(f.source.value,"beta beta\r\nbeta");
  assert.equal(f.inputs(),1);
  assert.equal(f.api.replaceAll(),0);
  assert.equal(f.inputs(),1);
});
test("bounds reject replacement expansion, empty query and truncated match sets",()=>{
  const f=fixture("a".repeat(10001));
  f.query.value="a";f.replacement.value="b";
  assert.equal(f.api.replaceAll(),0);
  assert.equal(f.inputs(),0);
  assert.match(f.status.textContent,/10,000/);
  f.query.value="";assert.equal(f.api.replaceAll(),0);
  assert.match(f.status.textContent,/Enter text/);
  const g=fixture("a".repeat(300000));
  g.query.value="a";g.replacement.value="b".repeat(10000);
  assert.equal(g.api.replaceAll(),0);
  assert.equal(g.inputs(),0);
  assert.match(g.status.textContent,/10,000/);
  const h=fixture("abc");
  h.query.value="abc";h.replacement.value="x".repeat(10001);
  assert.equal(h.api.replaceAll(),0);
  assert.match(h.status.textContent,/10,000 characters/);
});
test("keyboard navigation intercepts only editor shortcuts and find Enter",()=>{
  const f=fixture("foo foo");
  f.query.value="foo";
  const find=f.source.fire("keydown",{key:"f",ctrlKey:true});
  assert.equal(find.prevented,true);assert.equal(f.query.focused,true);
  const replace=f.source.fire("keydown",{key:"h",metaKey:true});
  assert.equal(replace.prevented,true);assert.equal(f.replacement.focused,true);
  const next=f.source.fire("keydown",{key:"F3"});
  assert.equal(next.prevented,true);assert.equal(f.source.selectionStart,0);
  const previous=f.source.fire("keydown",{key:"F3",shiftKey:true});
  assert.equal(previous.prevented,true);assert.equal(f.source.selectionStart,4);
  const enter=f.query.fire("keydown",{key:"Enter"});
  assert.equal(enter.prevented,true);
  assert.equal(f.source.selectionStart,0);
  assert.equal(f.source.fire("keydown",{key:"f",altKey:true}).prevented,undefined);
});
test("Pages HTML loads search modules, accessible controls and drafts through input",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html, /<script src="\.\/editor_find\.js"><\/script>/);
  assert.match(html, /<script src="\.\/find_panel\.js"><\/script>/);
  for(const id of ["findQuery","replaceText","findCase","findRegex","findWholeWord","findPrevious","findNext","replaceOne","replaceAll","findStatus"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/FlowStudioFindPanel\.create/);
  assert.match(html,/source"\)\.addEventListener\("input", \(\) => \{ notebookEntries = \[\]; clearNotebookRecovery\(\); queueDraft\(\); \}\)/);
});

test("regex and whole-word toggles update real source matches and expand captures", () => {
  const f=fixture("cat1 cats cat2");
  f.query.value="(cat)(\\d)";
  f.regex.checked=true; f.regex.fire("change");
  assert.match(f.status.textContent,/2 matches/);
  f.replacement.value="$2-$1";
  assert.equal(f.api.move(),true);
  assert.equal(f.api.replaceOne(),true);
  assert.equal(f.source.value,"1-cat cats cat2");
  assert.equal(f.inputs(),1);
  f.query.value="cat";
  f.regex.checked=false; f.regex.fire("change");
  f.wholeWord.checked=true; f.wholeWord.fire("change");
  assert.match(f.status.textContent,/1 matches/);
  f.query.value="cats";f.query.fire("input");
  assert.match(f.status.textContent,/1 matches/);
});
test("invalid regex reports error without modifying source or drafts", () => {
  const f=fixture("print(42)");
  f.query.value="(";f.regex.checked=true;
  f.regex.fire("change");
  assert.match(f.status.textContent,/Invalid regular expression/);
  f.replacement.value="X";
  assert.equal(f.api.replaceAll(),0);
  assert.equal(f.source.value,"print(42)");
  assert.equal(f.inputs(),0);
});
