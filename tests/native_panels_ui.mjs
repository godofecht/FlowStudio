/* Real Chromium acceptance for the bottom panel and the Data and Packages
 * views against the running native server: node tests/native_panels_ui.mjs
 *
 * The terminal is a real login shell on a pty; the Data view reads real R
 * data frames through the native table route; Packages reads the real R
 * library. Nothing here installs or removes a package. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const URL = process.env.FLOWSTUDIO_URL || 'http://127.0.0.1:8751/';
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', error => errors.push('pageerror: ' + error.message));
page.on('console', message => { if (message.type() === 'error' && !/status of 410/.test(message.text())) errors.push('console: ' + message.text()); });
page.on('dialog', dialog => dialog.accept());
await page.goto(URL);
await page.waitForFunction(() => globalThis.FlowStudioTerminal && FlowStudioTerminal.active);

const screen = () => page.evaluate(() => {
  const buffer = FlowStudioTerminal.active.term.buffer.active;
  let text = '';
  for (let i = 0; i < buffer.length; i++) text += buffer.getLine(i).translateToString(true) + '\n';
  return text;
});

// ---- Terminal: a real shell, and quotes never open Search Everywhere ------
assert.equal(await page.locator('#dockView-terminal').getAttribute('aria-selected'), 'true');
await page.locator('#shellTerminal .xterm').click();
await page.keyboard.type('echo "fs-$((6*7))" "two words" && printf \'caf\\303\\251 \\342\\234\\223\\n\'\n', { delay: 15 });
await page.waitForFunction(() => {
  const b = FlowStudioTerminal.active.term.buffer.active;
  let t = ''; for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true) + '\n';
  return /^fs-42 two words$/m.test(t) && /café ✓/.test(t);
}, null, { timeout: 15000 });
assert.equal(await page.evaluate(() => document.getElementById('searchEverywhere').open), false);
// Inside the shell Ctrl+P belongs to readline history.
await page.keyboard.press('Control+p');
assert.equal(await page.evaluate(() => document.getElementById('searchEverywhere').open), false);
await page.keyboard.press('Control+c');
// Linux bash drops typed keys until it has redrawn the prompt after SIGINT;
// wait for a fresh, empty prompt line before typing again.
await page.waitForFunction(() => {
  const b = FlowStudioTerminal.active.term.buffer.active;
  const line = b.getLine(b.baseY + b.cursorY).translateToString(true);
  return /[$%#>] ?$/.test(line) && !/echo|printf/.test(line);
}, null, { timeout: 10000 }).catch(async error => {
  // Show what the shell printed, so a CI failure says why.
  console.error('terminal screen at timeout:\n' + JSON.stringify(await screen()));
  throw error;
});
// The pty follows the panel size.
await page.keyboard.type('stty size\n', { delay: 15 });
await page.waitForFunction(() => {
  const t = FlowStudioTerminal.active.term;
  const b = t.buffer.active; let s = '';
  for (let i = 0; i < b.length; i++) s += b.getLine(i).translateToString(true) + '\n';
  return new RegExp('^' + t.rows + ' ' + t.cols + '$', 'm').test(s);
}, null, { timeout: 10000 });
// A second terminal, then kill it.
await page.locator('#terminalAdd').click();
await page.waitForFunction(() => FlowStudioTerminal.instances.length === 2 && FlowStudioTerminal.active.id);
assert.equal(await page.locator('.xt-list .xt-tab').count(), 2);
await page.locator('#terminalKill').click();
await page.waitForFunction(() => FlowStudioTerminal.instances.length === 1);
assert.match(await screen(), /fs-42 two words/, 'the first terminal kept its scrollback');

// ---- Console drag: pulling the splitter up makes the panel taller ----------
const dock = () => page.evaluate(() => document.getElementById('consoleDock').getBoundingClientRect().height);
const before = await dock();
const bar = await page.locator('#dockSplitter').boundingBox();
await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
await page.mouse.down();
await page.mouse.move(bar.x + bar.width / 2, bar.y - 80, { steps: 6 });
await page.mouse.up();
assert.ok(await dock() > before + 60, `dock grew when dragged up (${before} -> ${await dock()})`);

// ---- Console view: bare Flow statements run ------------------------------
await page.locator('#dockView-console').click();
await page.locator('#consoleInput').click();
await page.keyboard.type('println("panel-check")');
await page.keyboard.press('Enter');
await page.waitForFunction(() => /panel-check/.test(document.getElementById('console').textContent), null, { timeout: 30000 });
assert.doesNotMatch(await page.locator('#console').textContent(), /does not define main/);

// ---- Data view: R frames open in the grid --------------------------------
await page.evaluate(() => fetch('/api/run/r', { method: 'POST', headers: { 'X-FlowStudio-Intent': 'run' },
  body: 'acceptance_iris <- iris; acceptance_n <- 3' }));
await page.locator('#tab-data').click();
await page.waitForFunction(() => document.querySelector('#dataSessionList .dv-row[data-name="acceptance_iris"]'), null, { timeout: 30000 });
assert.equal(await page.locator('#dataSessionList .dv-row[data-name="acceptance_n"]').count(), 0, 'vectors are not listed');
assert.equal(await page.locator('#dataSessionList .dv-row[data-name="acceptance_iris"] .dv-dims').textContent(), '150 × 5');
await page.locator('#dataSessionList .dv-row[data-name="acceptance_iris"]').click();
await page.waitForFunction(() => document.getElementById('dataGrid').open);
assert.match(await page.locator('.dg-range').textContent(), /of 150$/);
await page.locator('.dg-sort').first().click();
await page.locator('.dg-sort').first().click();
assert.equal(await page.locator('.dg-table tbody tr').first().locator('td').nth(1).textContent(), '7.9');
await page.locator('.dg-filter').fill('setosa');
await page.waitForFunction(() => /of 50 \(filtered from 150\)/.test(document.querySelector('.dg-range').textContent));
await page.keyboard.press('Escape');                 // clears the filter
await page.keyboard.press('Escape');                 // closes the grid
assert.equal(await page.evaluate(() => document.getElementById('dataGrid').open), false);

// ---- Packages: the real R library, filtered, with an install offer --------
await page.locator('#tab-packages').click();
await page.locator('#packagesKind-r').click();
await page.waitForFunction(() => /^R \S+, \d+ installed/.test(document.getElementById('packageSummary').textContent), null, { timeout: 30000 });
await page.locator('#packageQuery').fill('stats');
await page.waitForFunction(() => document.querySelector('#packageRows .pk-row[data-name="stats"]'));
assert.equal(await page.locator('#packageRows .pk-row[data-name="stats"] .pk-attach').isChecked(), true, 'stats is attached');
assert.equal(await page.locator('#packageRows .pk-offer').count(), 0, 'no install offer for an installed name');
await page.locator('#packageQuery').fill('flowstudio_not_a_package');
assert.equal(await page.locator('#packageRows .pk-offer').count(), 1);

assert.deepEqual(errors, []);
await browser.close();
console.log('PASS: real shell terminal, quotes and Ctrl+P stay in the shell, pty resize, terminal add and kill, dock drag direction, Flow console statements, R data grid, R packages');
