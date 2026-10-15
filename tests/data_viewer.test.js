"use strict";
const assert = require("node:assert/strict");
const data = require("../web/data_viewer.js");
assert.equal(data.parseDelimited("x,y\n1,2").rows[0][1], "2");
assert.equal(data.viewRows(data.parseDelimited("n\n10\n2"), {sortColumn: 0}).rows[0].values[0], "2");
console.log("Data viewer smoke tests passed");

const quoted = data.parseDelimited('name,notes\r\n"Ada, A.","line 1\r\nline 2"\r\n');
assert.equal(quoted.rows[0][0], "Ada, A.");
assert.equal(quoted.rows[0][1], "line 1\r\nline 2");
const missing = data.parseDelimited("name,n\na,\nb,10\n");
assert.equal(data.viewRows(missing, {sortColumn:1, descending:true}).rows[1].values[0], "a");
assert.equal(data.viewRows(missing, {filter:"B"}).total, 1);
assert.equal(data.delimiterForName("table.TSV"), "\t");
