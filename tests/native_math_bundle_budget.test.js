"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// Exercise the real Chromium acceptance's compactor, not a duplicate alias
// table. Catch a >128 KiB production HTTP bundle before native browser CI.
const browserSource = readFileSync(path.join(__dirname, 'native_math_plot_ui.mjs'), 'utf8');
const start = browserSource.indexOf('function compactNativeMathLine(');
const end = browserSource.indexOf('const browser = await chromium.launch', start);
assert.ok(start >= 0 && end > start, 'Browser source compactor was not found');
const { compactNativeMathLine, compactNativeMathIdentifiers } =
  new Function(browserSource.slice(start, end) +
    '\nreturn { compactNativeMathLine, compactNativeMathIdentifiers };')();

const common = [
  'src/math_dimensions.flow',
  'src/math_expression_ir.flow',
  'src/math_expression_source.flow'
];
const advanced = [...common, 'src/math_equation.flow', 'src/math_static.flow'];
const cases = [
  ['source', [...common, 'src/math_expression_source_http_smoke.flow'], false, false],
  ['trigonometry', [...advanced, 'src/math_trigonometry_smoke.flow'], false, true],
  ['hyperbolic', [...advanced, 'src/math_hyperbolic_smoke.flow'], false, true],
  ['three-unknown SI', [...advanced, 'src/math_dimension_triple.flow',
    'src/math_dimension_variable.flow', 'src/math_dimension_variable_smoke.flow'], true, true],
  ['four-dimension SI', [...advanced, 'src/math_dimension_four.flow',
    'src/math_dimension_four_smoke.flow'], true, true],
  ['four-unknown SI', [...advanced, 'src/math_dimension_four.flow',
    'src/math_dimension_variable_four.flow', 'src/math_dimension_variable_four_http_smoke.flow'], true, true]
];

function browserBundle(files, tightenEquals, tightenMathOps, name) {
  const modules = files.slice(0, -1).map(path => path.slice(4, -5));
  let source = files.map(path => readFileSync(require('node:path').join(__dirname, '..', path), 'utf8')
    .split(/\r?\n/)
    .filter(line => !modules.some(module => line.startsWith('import .' + module + ' {')))
    .filter(line => line.trim() && !line.trimStart().startsWith('#'))
    .map(line => compactNativeMathLine(line, tightenEquals, tightenMathOps)).join('\n')
  ).join('\n');
  if (name === 'four-unknown SI') {
    source = source
      .replaceAll(/\bidentifier_matches\b/g, 'idmatch')
      .replaceAll(/\bsolve_math_equations_variable_constraints_four_unknown_dimensions\b/g, 'solve4')
      .replaceAll(/\boutput_dimension\b/g, 'outdim')
      .replaceAll(/\bsame_dimension\b/g, 'samedim')
      .replaceAll(/\bsource_start\b/g, 'srcstart')
      .replaceAll(/\bsource_error\b/g, 'srcerr')
      .replaceAll(/\bdimensionless\b/g, 'dimless');
  }
  return compactNativeMathIdentifiers(source);
}

for (const [name, files, tightenEquals, tightenMathOps] of cases) {
  test('actual ' + name + ' Monaco native Flow bundle fits 128 KiB', () => {
    const source = browserBundle(files, tightenEquals, tightenMathOps, name);
    const bytes = Buffer.byteLength(source, 'utf8');
    assert.ok(bytes < 128 * 1024,
      name + ' bundle has ' + bytes + ' UTF-8 bytes, exceeding the 131072-byte production HTTP cap');
    assert.match(source, /function main\(/, 'Executable main must remain in the bundle');
  });
}

test('compaction preserves quoted Unicode, escaped strings and byte-aware budget', () => {
  const literal = 'let message: string = "µm ≡ ＝ \\"quoted\\" # not a comment" # comment';
  const compacted = compactNativeMathIdentifiers(compactNativeMathLine(literal, true, true));
  assert.ok(compacted.includes('"µm ≡ ＝ \\"quoted\\" # not a comment"'));
  assert.ok(!compacted.includes(' # comment'));
  assert.equal(Buffer.byteLength('＝', 'utf8'), 3);
  assert.ok(Buffer.byteLength('＝', 'utf8') > '＝'.length);
});
