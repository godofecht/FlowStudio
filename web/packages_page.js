"use strict";
FlowStudioPackages.createInventory({
  request: fetch,
  doc: document,
  language: document.getElementById("packageLanguage"),
  refresh: document.getElementById("packageRefresh"),
  search: document.getElementById("packageSearch"),
  table: document.getElementById("packageTable"),
  status: document.getElementById("packageStatus")
});
