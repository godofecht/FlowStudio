/* Fixed, read-only queries for installed Python/R packages. */
(function (global) {
"use strict";
const SOURCES = Object.freeze({
  python: "print(''.join(((d.metadata.get('Name') or '').replace('\\t', '') + '\\t' + (d.version or '').replace('\\t', '') + '\\n') for d in sorted(__import__('importlib.metadata', fromlist=['distributions']).distributions(), key=lambda d: (d.metadata.get('Name') or '').casefold())), end='')",
  r: "local({ p <- installed.packages(); write.table(p[, c('Package', 'Version'), drop = FALSE], row.names = FALSE, col.names = FALSE, quote = FALSE, sep = '\\t') })"
});
if (typeof module !== "undefined" && module.exports) module.exports = SOURCES;
global.FlowStudioPackageQueries = SOURCES;
})(globalThis);
