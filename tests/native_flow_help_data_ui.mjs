/* Real Chromium acceptance for Flow help and the Flow data viewer, against
 * the running native server: node tests/native_flow_help_data_ui.mjs
 *
 *   1. Help by search: the Help tab looks up io_read_text and shows its
 *      standard library signature, doc comment, import line and an example.
 *   2. Help by F1: F1 on `sqrt` in a Flow script opens the Help tab on sqrt.
 *      When `flow lsp` runs, its hover text for the cursor comes first.
 *   3. Data viewer: an array of structs typed into the Flow console shows in
 *      the Environment; clicking its name opens a sortable grid with one row
 *      per element and one column per field. A 5,000 element array opens
 *      with a note that only the first 1,000 rows are shown.
 *
 * Screenshots go to build/ui/ at 1440x900 and 390x844. Any console error
 * other than the expected 4xx/503 statuses fails the run. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.FLOWSTUDIO_URL || 'http://127.0.0.1:8751/';
const SHOTS = 'build/ui';
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push('pageerror: ' + error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/status of (410|422|503)/.test(message.text())) errors.push('console: ' + message.text());
  });
};

async function ready(page) {
  await page.goto(URL);
  await page.waitForFunction(() => globalThis.FlowStudioFlowHelp && globalThis.FlowStudioFlowData &&
    globalThis.FlowStudioFlowSession && globalThis.FlowStudioConsoleSubmit &&
    globalThis.FlowStudioEditor && FlowStudioEditor.editor && globalThis.FlowStudioDataView &&
    FlowStudioDataView.instance, null, { timeout: 30000 });
  await page.evaluate(() => {
    const select = document.getElementById('language');
    select.value = 'flow';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
watch(page);
try {
  await ready(page);
  await page.evaluate(async () => { await FlowStudioFlowSession.client.reset(); });

  /* ---- 1. Help by search ---- */
  await page.evaluate(() => FlowStudioLayout && FlowStudioLayout.show && FlowStudioLayout.show('right'));
  await page.click('#rpTab-help');
  await page.waitForSelector('#flowHelp[data-state="ready"] .fh-related .fh-link', { timeout: 20000 });
  assert.match(await page.textContent('#flowHelpResult'), /Arrays and spans/, 'the empty pane lists guide topics');
  await page.fill('#flowHelpSearch', 'io_read_text');
  await page.press('#flowHelpSearch', 'Enter');
  await page.waitForFunction(() => document.getElementById('flowHelp').dataset.query === 'io_read_text' &&
    document.getElementById('flowHelp').dataset.state === 'ready', null, { timeout: 20000 });
  const searched = await page.evaluate(() => {
    const entry = document.querySelector('#flowHelpResult .fh-entry[data-kind="function"]');
    return entry && {
      name: entry.querySelector('.fh-name').textContent,
      signature: entry.querySelector('.fh-signature').textContent,
      doc: entry.querySelector('.fh-doc').textContent,
      usage: entry.querySelector('.fh-usage').textContent,
      source: entry.querySelector('.fh-source').textContent,
      examples: entry.querySelectorAll('.fh-example').length
    };
  });
  assert.ok(searched, 'a function entry for io_read_text');
  assert.equal(searched.name, 'io_read_text');
  assert.match(searched.signature, /^function io_read_text\(path: string\) -> FileRead$/);
  assert.match(searched.doc, /UTF-8/, 'the doc comment from lib/stdlib/io.flow');
  assert.equal(searched.usage, 'Import: import std.io { io_read_text }');
  assert.match(searched.source, /lib\/stdlib\/io\.flow:\d+/);
  assert.ok(searched.examples >= 1, 'an example from the guide');
  // A related name is a link that looks itself up.
  await page.fill('#flowHelpSearch', 'Structs');
  await page.press('#flowHelpSearch', 'Enter');
  await page.waitForFunction(() => document.getElementById('flowHelp').dataset.query === 'Structs' &&
    document.getElementById('flowHelp').dataset.state === 'ready');
  assert.ok(await page.$('#flowHelpResult .fh-entry[data-kind="guide"] .fh-example .fh-code'), 'a guide topic with its example');
  await page.screenshot({ path: SHOTS + '/flow-help-search-1440.png' });

  /* ---- 2. Help by F1 ---- */
  await page.click('#rpTab-environment');
  await page.evaluate(() => {
    const editor = FlowStudioEditor.editor;
    editor.setValue('let root = sqrt(2.0)\nroot\n');
    editor.setPosition({ lineNumber: 1, column: 14 });
    editor.focus();
  });
  const lspReady = await page.evaluate(async () => {
    const lsp = globalThis.FlowStudioFlowLsp;
    for (let i = 0; i < 100 && lsp && (lsp.state() === 'idle' || lsp.state() === 'starting'); i++)
      await new Promise(resolve => setTimeout(resolve, 100));
    return !!lsp && lsp.state() === 'ready';
  });
  await page.keyboard.press('F1');
  await page.waitForFunction(() => document.getElementById('flowHelp').dataset.query === 'sqrt' &&
    document.getElementById('flowHelp').dataset.state === 'ready', null, { timeout: 20000 });
  assert.equal(await page.getAttribute('#rpTab-help', 'aria-selected'), 'true', 'F1 shows the Help tab');
  assert.equal(await page.inputValue('#flowHelpSearch'), 'sqrt');
  const f1 = await page.evaluate(() => Array.from(document.querySelectorAll('#flowHelpResult .fh-entry'))
    .map(entry => ({ kind: entry.dataset.kind, name: entry.querySelector('.fh-name').textContent,
      text: entry.textContent })));
  assert.ok(f1.some(entry => entry.name === 'sqrt' && /function sqrt\(x: f(32|64)\) -> f(32|64)/.test(entry.text)),
    'a sqrt entry with its signature: ' + JSON.stringify(f1.map(e => e.kind + ':' + e.name)));
  assert.ok(f1.some(entry => /Square root/.test(entry.text)), 'the sqrt doc text');
  if (lspReady) {
    assert.equal(f1[0].kind, 'hover', 'the language server hover comes first');
    assert.match(f1[0].text, /sqrt/);
  }
  console.log('F1 checked with the language server ' + (lspReady ? 'running' : 'not available'));
  await page.screenshot({ path: SHOTS + '/flow-help-f1-1440.png' });

  /* ---- 3. Data viewer from the Flow console ---- */
  await page.click('#rpTab-environment');
  await page.evaluate(() => FlowStudioTerminal.show('console'));
  const prompt = page.locator('.terminal-prompt-line textarea');
  const transcript = () => page.evaluate(() => document.querySelector('.terminal-transcript').textContent);
  const enter = async (line, expect) => {
    // Each entry is one command line whose data-state leaves "running" when
    // it finishes; its output follows it in the transcript.
    const before = await page.evaluate(() => document.querySelectorAll('#console .term-run').length);
    await prompt.click();
    await prompt.fill(line);
    await prompt.press('Enter');
    try {
      await page.waitForFunction(([count, text]) => {
        const runs = document.querySelectorAll('#console .term-run');
        if (runs.length <= count) return false;
        const last = runs[runs.length - 1];
        if (last.dataset.state === 'running') return false;
        let after = '';
        for (let node = last.nextElementSibling; node && !node.classList.contains('term-run'); node = node.nextElementSibling)
          after += node.textContent;
        return !text || after.includes(text);
      }, [before, expect], { timeout: 90000 });
    } catch (error) {
      console.error('Console transcript:\n' + (await transcript()).slice(-1500));
      throw error;
    }
  };
  await enter('struct City { name: string, lat: f64, pop: i64 }');
  await enter('let cities = [City { name: "Oslo", lat: 59.9, pop: 709000 }, City { name: "Cairo", lat: 30.0, pop: 9540000 }, City { name: "Lima", lat: -12.0, pop: 10000000 }]');
  await enter('cities[1].pop', '9540000');
  await page.evaluate(() => FlowStudioSidePanel.show('environment'));
  await page.click('#refreshPythonEnvironment');
  await page.waitForSelector('#pythonEnvironment tr[data-name="cities"] button.flow-env-view', { timeout: 30000 });
  await page.screenshot({ path: SHOTS + '/flow-environment-1440.png' });
  await page.click('#pythonEnvironment tr[data-name="cities"] button.flow-env-view');
  await page.waitForFunction(() => document.getElementById('dataGrid').open &&
    document.querySelector('#dataGrid .dg-name').textContent === 'cities', null, { timeout: 30000 });
  const grid = () => page.evaluate(() => ({
    meta: document.querySelector('#dataGrid .dg-meta').textContent,
    head: Array.from(document.querySelectorAll('#dataGrid thead .dg-col')).map(cell => cell.textContent),
    rows: Array.from(document.querySelectorAll('#dataGrid tbody tr')).map(row =>
      Array.from(row.children).slice(1).map(cell => cell.textContent)),
    range: document.querySelector('#dataGrid .dg-range').textContent,
    note: document.getElementById('dataGridNote') && document.getElementById('dataGridNote').textContent
  }));
  let shown = await grid();
  assert.deepEqual(shown.head, ['name', 'lat', 'pop']);
  assert.deepEqual(shown.rows, [['Oslo', '59.9', '709000'], ['Cairo', '30.0', '9540000'], ['Lima', '-12.0', '10000000']]);
  assert.equal(shown.meta, 'Flow  array<City, 3>  3 rows × 3 columns');
  assert.equal(shown.range, 'Rows 1 to 3 of 3');
  assert.equal(shown.note, null, 'no truncation note for a whole value');
  // Sort by latitude, numerically.
  await page.click('#dataGrid thead th:nth-child(3) .dg-sort');
  shown = await grid();
  assert.deepEqual(shown.rows.map(row => row[0]), ['Lima', 'Cairo', 'Oslo']);
  await page.click('#dataGrid thead th:nth-child(3) .dg-sort');
  shown = await grid();
  assert.deepEqual(shown.rows.map(row => row[0]), ['Oslo', 'Cairo', 'Lima']);
  await page.screenshot({ path: SHOTS + '/flow-data-viewer-1440.png' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('dataGrid').open);

  // A large array is not kept by the session but still opens, truncated.
  await enter('let wave = [0.25; 5000]');
  await page.click('#refreshPythonEnvironment');
  await page.waitForSelector('#pythonEnvironment tr[data-name="wave"] button.flow-env-view', { timeout: 30000 });
  await page.click('#pythonEnvironment tr[data-name="wave"] button.flow-env-view');
  await page.waitForFunction(() => document.getElementById('dataGrid').open &&
    document.querySelector('#dataGrid .dg-name').textContent === 'wave', null, { timeout: 30000 });
  shown = await grid();
  assert.deepEqual(shown.head, ['value']);
  assert.match(shown.meta, /^Flow {2}array<f(32|64), 5000> {2}5,000 rows × 1 column$/);
  assert.equal(shown.note, 'Showing the first 1,000 of 5,000 rows.');
  assert.match(shown.range, /of 1,000$/);
  await page.screenshot({ path: SHOTS + '/flow-data-viewer-truncated-1440.png' });
  await page.keyboard.press('Escape');
  // The dialog's close event comes a task later; the note leaves with it.
  await page.waitForFunction(() => !document.getElementById('dataGrid').open &&
    !document.getElementById('dataGridNote'), null, { timeout: 5000 });

  /* ---- phone width ---- */
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  watch(phone);
  await ready(phone);
  await phone.evaluate(() => FlowStudioFlowHelp.open('sqrt'));
  await phone.waitForFunction(() => document.getElementById('flowHelp').dataset.query === 'sqrt' &&
    document.getElementById('flowHelp').dataset.state === 'ready', null, { timeout: 20000 });
  // The side panel does not fit beside the editor, so Help is a dialog.
  const phoneHelp = await phone.evaluate(() => {
    const dialog = document.getElementById('flowHelpDialog');
    const entry = document.querySelector('#flowHelp .fh-entry');
    const box = entry && entry.getBoundingClientRect();
    return { open: !!(dialog && dialog.open && dialog.contains(document.getElementById('flowHelp'))),
      visible: !!box && box.width > 200 && box.right <= window.innerWidth + 1 };
  });
  assert.deepEqual(phoneHelp, { open: true, visible: true });
  let overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, 'no sideways scroll at 390px: ' + overflow);
  await phone.screenshot({ path: SHOTS + '/flow-help-390.png' });
  await phone.click('#flowHelpDialog .fh-close');
  await phone.waitForFunction(() => !document.getElementById('flowHelpDialog').open &&
    document.getElementById('rpView-help').contains(document.getElementById('flowHelp')));
  await phone.evaluate(() => FlowStudioFlowData.open('cities'));
  await phone.waitForFunction(() => document.getElementById('dataGrid').open, null, { timeout: 30000 });
  const phoneGrid = await phone.evaluate(() => {
    const name = document.querySelector('#dataGrid .dg-name').getBoundingClientRect();
    const filter = document.querySelector('#dataGrid .dg-filter').getBoundingClientRect();
    return { separate: name.bottom <= filter.top || name.right <= filter.left,
      rows: document.querySelectorAll('#dataGrid tbody tr').length };
  });
  assert.deepEqual(phoneGrid, { separate: true, rows: 3 }, 'the grid title and filter do not overlap at 390px');
  overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, 'no sideways scroll with the grid open: ' + overflow);
  await phone.screenshot({ path: SHOTS + '/flow-data-viewer-390.png' });
  await phone.close();

  await page.evaluate(async () => { await FlowStudioFlowSession.client.reset(); });
  assert.deepEqual(errors, []);
  console.log('PASS: Flow help by search and F1, Environment opens arrays of structs in a sortable grid, ' +
    'large arrays open truncated with a note, layouts at 1440x900 and 390x844');
} catch (error) {
  await page.screenshot({ path: SHOTS + '/flow-help-data-failure.png' }).catch(() => {});
  console.error('Status: ' + await page.evaluate(() => document.getElementById('resultStatus').textContent).catch(() => '?'));
  console.error('Errors: ' + JSON.stringify(errors));
  throw error;
} finally {
  await browser.close();
}
