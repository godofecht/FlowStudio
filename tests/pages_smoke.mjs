import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const root = resolve('build/pages');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    assert(url.pathname.startsWith('/FlowStudio/'));
    const relative = decodeURIComponent(url.pathname.slice('/FlowStudio/'.length));
    const file = resolve(root, relative + (url.pathname.endsWith('/') ? 'index.html' : ''));
    assert(file.startsWith(root + '/'));
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('Missing static asset'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/FlowStudio/`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on('request', request => requests.push(request.url()));
  for (const entry of ['', 'app/']) {
    await page.goto(base + entry);
    await page.waitForFunction(() => Boolean(globalThis.FlowStudioEditor?.editor));
    assert.equal(await page.locator('.monaco-editor').isVisible(), true);
    assert.equal(await page.locator('.pages-notice').isVisible(), true);
    await page.evaluate(() => FlowStudioEditor.editor.setValue('function main() -> i32 { println("browser-flow-42"); println(6 * 7); return 0 }'));
    await page.locator('#run').click();
    await page.waitForFunction(() => !document.getElementById('run').disabled, undefined, { timeout: 120000 });
    assert.match(await page.locator('body').innerText(), /browser-flow-42\s+42/);
    // Exercise the worker under the repository prefix and continue one event later.
    await page.evaluate(async () => {
      const worker = MonacoEnvironment.getWorker();
      await new Promise((resolve, reject) => {
        worker.addEventListener('error', reject, { once: true });
        worker.addEventListener('message', resolve, { once: true });
        worker.postMessage({ vsWorker: 1, req: '1', method: '$ping', args: [] });
        setTimeout(resolve, 200);
      });
      worker.terminate();
      await new Promise(requestAnimationFrame);
    });
  }
  const cases = [
    ['function main() -> i32 { let mut s: i32 = 0; let mut i: i32 = 0; while i < 10 { s = s + i; i = i + 1 }; println(s); return 0 }', true, /45/],
    ['function main() -> i32 { println("lambda: λ"); return 0 }', true, /lambda: λ/],
    ['import std.math { sqrt }\nfunction main() -> i32 { println(sqrt(81.0)); return 0 }', true, /9/],
    ['function main() -> i32 { println(missing_symbol); return 0 }', false, /missing_symbol|undeclared|unresolved|unknown/i],
    ['function main() -> i32 { return 7 }', false, /code 7/],
    ['extern { function malloc(n: i64) -> ptr<u8> }\nfunction main() -> i32 { let p: ptr<u8> = malloc(2147483647); if p != null { return 1 }; println("allocation-bounded"); return 0 }', true, /allocation-bounded/],
    ['function main() -> i32 { while true { println("bounded-output") }; return 0 }', false, /output exceeds/],
    ['function main() -> i32 { while true {} return 0 }', false, /timed out/],
    ['function main() -> i32 { println("recovered-after-timeout"); return 0 }', true, /recovered-after-timeout/]
  ];
  for (const [source, ok, expected] of cases) {
    const result = await page.evaluate(async source => {
      const response = await fetch('/api/run/flow', { method: 'POST', body: source });
      return { ok: response.ok, output: await response.text() };
    }, source);
    assert.equal(result.ok, ok, result.output);
    assert.match(result.output, expected);
  }
  const field = await page.evaluate(async source => {
    const response = await fetch('/api/run/flow', { method: 'POST', body: source });
    return { ok: response.ok, output: await response.text() };
  }, await readFile('src/field_multiplier_differential.flow', 'utf8'));
  assert.equal(field.ok, true, field.output);
  execFileSync('python3', ['-c', 'import sys; from scripts.verify_native_field_arrays import parse_output, expected_output, verify; verify(parse_output(sys.stdin.buffer.read()), expected_output())'], { input: field.output });
  const mlir = await page.evaluate(async () => {
    const report = await (await fetch('/api/flow/backends')).json();
    const response = await fetch('/api/run/flow-mlir', { method: 'POST', body: 'function main() -> i32 { return 0 }' });
    return { report, ok: response.ok, output: await response.text() };
  });
  assert.equal(mlir.report.mlir.available, false);
  assert.equal(mlir.ok, false);
  assert.match(mlir.output, /MLIR lowering toolchain/);
  assert.equal(requests.some(url => new URL(url).pathname.startsWith('/api/')), false);
  assert(requests.some(url => url.endsWith('/FlowStudio/ui/editor.worker.js')));
  const revision = await page.locator('meta[name="flowstudio-revision"]').getAttribute('content');
  assert.equal(revision, JSON.parse(await readFile(root + '/revision.json', 'utf8')).revision);
  await page.goto(base + 'browser/');
  await page.waitForSelector('#source');
  assert.equal(await page.locator('#source').isVisible(), true);
  // The legacy browser workspace starts its optional CDN runtime asynchronously.
  assert.deepEqual(errors, []);
  console.log('PASS Pages: real Flow/Wasm execution at root and /app; 16 Field cells checked against independent Python, loops, Unicode, stdlib, diagnostics, exit codes, bounded output, timeout/recovery and zero server execution');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
