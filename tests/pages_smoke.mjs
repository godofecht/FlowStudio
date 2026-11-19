import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('build/pages');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
    await page.evaluate(() => FlowStudioEditor.editor.setValue('function main() -> i32 { return 0 }'));
    await page.locator('#run').click();
    await page.waitForFunction(() => !document.getElementById('run').disabled);
    assert.match(await page.locator('body').innerText(), /Native execution requires the local FlowStudio app/);
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
  assert.equal(requests.some(url => new URL(url).pathname.startsWith('/api/')), false);
  assert(requests.some(url => url.endsWith('/FlowStudio/ui/editor.worker.js')));
  const revision = await page.locator('meta[name="flowstudio-revision"]').getAttribute('content');
  assert.equal(revision, JSON.parse(await readFile(root + '/revision.json', 'utf8')).revision);
  await page.goto(base + 'browser/');
  await page.waitForSelector('#source');
  assert.equal(await page.locator('#source').isVisible(), true);
  // The legacy browser workspace starts its optional CDN runtime asynchronously.
  assert.deepEqual(errors, []);
  console.log('PASS Pages: current Monaco workbench at root and /app, prefixed assets and worker, static execution boundary, browser workspace');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
