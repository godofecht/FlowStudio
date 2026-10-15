"use strict";
const assert = require("node:assert/strict");
const data = require("../web/data_viewer.js");
assert.equal(data.parseDelimited("x,y\n1,2").rows[0][1], "2");
assert.equal(data.viewRows(data.parseDelimited("n\n10\n2"), {sortColumn: 0}).rows[0].values[0], "2");
console.log("Data viewer smoke tests passed");
