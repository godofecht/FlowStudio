/* Real Chromium acceptance against the native Flow-owned localhost server.
 * Start ./build/flowstudio first, then run node tests/quarto_ui.mjs. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fence = '`'.repeat(3);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && response.url().startsWith('http://127.0.0.1:8751/'))
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('http://127.0.0.1:8751/app/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(globalThis.FlowStudioQuarto?.decode));
  const qmd = '---\ntitle: Example\nformat: html\n---\n\n' +
    fence + '{r}\n#| label: summary\nprint(42)\n' + fence + '\n';
  await page.locator('#quartoFile').setInputFiles({
    name: 'study.qmd', mimeType: 'text/markdown', buffer: Buffer.from(qmd)
  });
  await page.waitForFunction(() => document.querySelector('#source')?.value.includes('print(42)'));
  assert.match(await page.locator('#source').inputValue(), /# %% \[r\]/);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportQuarto').click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'study.qmd');
  const exported = await readFile(await download.path(), 'utf8');
  assert.match(exported, /format: html/);
  assert.match(exported, /print\(42\)/);
  assert.ok(exported.includes(fence + '{r summary}'));
  const disabled = fence + '{r}\n#| eval: false\nstop("must not run")\n' + fence + '\n';
  await page.locator('#quartoFile').setInputFiles({
    name: 'disabled.qmd', mimeType: 'text/markdown', buffer: Buffer.from(disabled)
  });
  await page.waitForFunction(() => document.querySelector('#source')?.value.includes('eval=FALSE'));
  assert.ok((await page.locator('#source').inputValue()).includes('# %% [markdown]'));
  const before = await page.locator('#source').inputValue();
  await page.locator('#quartoFile').setInputFiles({
    name: 'unsupported.qmd', mimeType: 'text/markdown',
    buffer: Buffer.from('---\nformat: pdf\n---\n')
  });
  await page.waitForFunction(() => document.body.textContent.includes('Quarto import failed'));
  assert.equal(await page.locator('#source').inputValue(), before);

  // Real Flow HTTP -> persistent Rscript debugger -> source textarea caret.
  // This exercises actual native R execution, not a mocked debugger result.
  await page.locator('#language').selectOption('r');
  await page.locator('#rRuntime').selectOption('native');
  const rSource = 'a <- 1L\nb <- a + 1L\nprint(b)';
  await page.locator('#source').fill(rSource);
  await page.locator('#rDebugStart').click();
  await page.waitForFunction(() =>
    document.querySelector('#rDebugOutput')?.textContent.includes('Next expression at line 1'));
  assert.equal(await page.locator('#source').evaluate(el => el.selectionStart), 0);
  await page.locator('#rDebugStep').click();
  await page.waitForFunction(() =>
    document.querySelector('#rDebugOutput')?.textContent.includes('Next expression at line 2'));
  assert.equal(await page.locator('#source').evaluate(el => el.selectionStart),
    rSource.indexOf('b <-'));
  // An edited buffer must never be moved by a later real debugger response.
  await page.locator('#source').fill('# changed\nb <- a + 1L\nprint(b)');
  await page.locator('#source').evaluate(el => el.setSelectionRange(0, 0));
  await page.locator('#rDebugStatus').click();
  await page.waitForFunction(() => !document.querySelector('#rDebugStatus')?.disabled);
  assert.match(await page.locator('#rDebugOutput').textContent(), /Next expression at line 2/);
  assert.equal(await page.locator('#source').evaluate(el => el.selectionStart), 0);
  await page.locator('#rDebugStop').click();
  await page.waitForFunction(() =>
    document.querySelector('#rDebugOutput')?.textContent.includes('R expression debugger: idle'));
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('PASS: real Chromium Quarto import/export and native R debugger source navigation');
} finally {
  await browser.close();
}
