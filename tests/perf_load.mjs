/* Load and interaction performance against the running native server:
 *   FLOWSTUDIO_URL=http://127.0.0.1:8751 node tests/perf_load.mjs
 *
 * Measures a cold load and a warm reload at 1440x900, deviceScaleFactor 2,
 * then the latency of common actions. Prints a table and fails when a
 * number goes over its budget. PERF_RUNS sets the number of cold loads
 * (default 3; the median is reported). PERF_JSON=<file> writes the raw
 * numbers. PERF_NO_ASSERT=1 prints without checking budgets.
 *
 * Budgets were set from measured numbers on an M-series Mac with headroom
 * for a slower CI machine. The cold load numbers depend on the machine, so
 * CI=1 widens them by PERF_CI_FACTOR (default 3). */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const URL = (process.env.FLOWSTUDIO_URL || 'http://127.0.0.1:8751').replace(/\/+$/, '') + '/';
const RUNS = Math.max(1, Number(process.env.PERF_RUNS || 3));
const SLACK = process.env.CI ? Number(process.env.PERF_CI_FACTOR || 3) : 1;

/* Every budget is in ms, KB or a count. */
const BUDGET = {
  html_ms: 150,              // document response
  fcp_ms: 450,               // first contentful paint
  editor_ms: 1300,           // Monaco shows lines of text
  long_task_max_ms: 600,     // the single longest main-thread task while loading
  warm_transfer_kb: 260,     // bytes over the wire on a reload
  warm_editor_ms: 1200,
  requests: 70,
  action_new_tab_ms: 50,
  action_switch_tab_ms: 50,
  action_open_file_ms: 80,
  action_open_panel_ms: 50,
  action_toggle_dock_ms: 50,
  action_open_menu_ms: 50,
  action_zoom_ms: 80,
  typing_p95_ms: 50,          // per keystroke in a 4000 line file
  console_flow_ms: 8000      // includes compiling Flow on the server
};

const INIT = () => {
  const perf = { longTasks: [], events: [], editorAt: 0 };
  globalThis.__perf = perf;
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) perf.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch (_) { /* older engines */ }
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) perf.events.push({ name: entry.name, duration: entry.duration, start: entry.startTime });
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch (_) { /* older engines */ }
  const mark = () => {
    if (!perf.editorAt && document.querySelector('.monaco-editor .view-line')) {
      perf.editorAt = performance.now();
      return true;
    }
    return false;
  };
  new MutationObserver((_, observer) => { if (mark()) observer.disconnect(); })
    .observe(document, { childList: true, subtree: true });
};

const median = list => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const round = value => Math.round(value * 10) / 10;

async function collectLoad(page) {
  await page.waitForFunction(() => globalThis.__perf && globalThis.__perf.editorAt > 0 &&
    globalThis.FlowStudioEditor && globalThis.FlowStudioEditor.editor, null, { timeout: 60000 });
  // Let the page settle so late long tasks are counted.
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map(entry => [entry.name, entry.startTime]));
    const resources = performance.getEntriesByType('resource');
    // Static files only; API calls (terminal polling, language server) are
    // counted apart.
    const api = resources.filter(entry => new URL(entry.name).pathname.startsWith('/api/'));
    const files = resources.filter(entry => !api.includes(entry));
    const all = [nav, ...files];
    const perf = globalThis.__perf;
    const tasks = perf.longTasks;
    return {
      html_ms: nav.responseEnd - nav.requestStart,
      fp_ms: paint['first-paint'] || 0,
      fcp_ms: paint['first-contentful-paint'] || 0,
      dcl_ms: nav.domContentLoadedEventEnd,
      load_ms: nav.loadEventEnd,
      editor_ms: perf.editorAt,
      requests: all.length,
      api_calls: api.length,
      body_kb: all.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0) / 1024,
      transfer_kb: all.reduce((sum, entry) => sum + (entry.transferSize || 0), 0) / 1024,
      long_tasks: tasks.length,
      long_task_max_ms: tasks.reduce((max, task) => Math.max(max, task.duration), 0),
      blocking_ms: tasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0),
      js_requests: files.filter(entry => entry.initiatorType === 'script' || /\.js$/.test(entry.name)).length,
      css_requests: files.filter(entry => /\.css$/.test(entry.name)).length
    };
  });
}

/* Runs fn in the page and returns the time until the next frame has been
 * produced: synchronous work plus style, layout and paint. */
const frameTimed = (page, body, arg) => page.evaluate(async ([source, value]) => {
  const fn = new Function('arg', 'return (async () => {' + source + '})()');
  const start = performance.now();
  await fn(value);
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  return performance.now() - start;
}, [body, arg]);

/* Static files carry an ETag and revalidate. A match is 304 with no body and
 * the same security headers. API replies are never stored. */
async function checkCaching() {
  for (const path of ['', 'ui/workbench.js', 'console.js']) {
    const first = await fetch(URL + path);
    await first.arrayBuffer();
    const etag = first.headers.get('etag');
    if (!etag || first.headers.get('cache-control') !== 'no-cache') throw new Error(`/${path}: no ETag or no-cache`);
    const again = await fetch(URL + path, { headers: { 'If-None-Match': etag } });
    const body = await again.arrayBuffer();
    if (again.status !== 304 || body.byteLength !== 0 || again.headers.get('etag') !== etag ||
        again.headers.get('x-content-type-options') !== 'nosniff' || again.headers.get('x-frame-options') !== 'SAMEORIGIN')
      throw new Error(`/${path}: revalidation gave ${again.status}`);
    const stale = await fetch(URL + path, { headers: { 'If-None-Match': '"stale"' } });
    if (stale.status !== 200 || !(await stale.arrayBuffer()).byteLength) throw new Error(`/${path}: a stale ETag did not refetch`);
  }
  const health = await fetch(URL + 'health');
  if (health.headers.get('cache-control') !== 'no-store' || health.headers.get('etag')) throw new Error('/health must not be stored');
}
await checkCaching();

const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const results = { cold: [], warm: null, actions: {} };
try {
  for (let run = 0; run < RUNS; run++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await context.addInitScript(INIT);
    const page = await context.newPage();
    await page.goto(URL);
    results.cold.push(await collectLoad(page));
    if (run === RUNS - 1) {
      await page.reload();
      results.warm = await collectLoad(page);
      results.actions = await measureActions(page);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

async function measureActions(page) {
  const out = {};
  const repeat = async (times, fn) => {
    const samples = [];
    for (let i = 0; i < times; i++) samples.push(await fn(i));
    return median(samples);
  };
  out.action_new_tab_ms = await repeat(5, () => frameTimed(page, 'document.getElementById("newDocumentTab").click();'));
  const ids = await page.evaluate(() => FlowStudioApp.documents.list().map(doc => doc.id));
  out.action_switch_tab_ms = await repeat(6, i => frameTimed(page,
    'FlowStudioApp.activateDocument(arg);', ids[i % ids.length]));
  const big = Array.from({ length: 4000 }, (_, i) => `let value_${i} = ${i} * 2 + 1  # line ${i}`).join('\n');
  out.action_open_file_ms = await repeat(3, i => frameTimed(page, `
    const text = arg.text;
    const handle = { kind: 'file', name: 'big_' + arg.i + '.flow',
      getFile: async () => new File([text], 'big_' + arg.i + '.flow') };
    await FlowStudioApp.openEditorHandle(handle, null);`, { text: big, i }));
  out.action_open_panel_ms = await repeat(4, i => frameTimed(page,
    i % 2 ? 'FlowStudioLayout.hide("right");' : 'FlowStudioSidePanel.show("environment");'));
  out.action_toggle_dock_ms = await repeat(4, () => frameTimed(page, 'FlowStudioLayout.toggle("dock");'));
  out.action_open_menu_ms = await repeat(4, () => frameTimed(page, `
    const trigger = document.querySelector('.menubar .menu .menu-trigger');
    trigger.click();`));
  await page.keyboard.press('Escape');
  out.action_zoom_ms = await repeat(4, i => frameTimed(page,
    'if (globalThis.FlowStudioZoom) FlowStudioZoom.step(arg);', i % 2 ? -1 : 1));
  await page.evaluate(() => globalThis.FlowStudioZoom && FlowStudioZoom.reset());

  // Typing in the 4000 line file: Event Timing durations per keystroke.
  await page.evaluate(() => { FlowStudioEditor.editor.focus(); FlowStudioEditor.editor.setPosition({ lineNumber: 2000, column: 1 }); });
  await page.evaluate(() => { globalThis.__perf.events.length = 0; });
  const typed = Date.now();
  await page.keyboard.type('let typed_here = value_10 + value_20 + value_30\n', { delay: 25 });
  const typingWall = Date.now() - typed;
  await page.waitForTimeout(300);
  const typing = await page.evaluate(() => {
    const keys = globalThis.__perf.events.filter(event => /^key|^input|beforeinput/.test(event.name)).map(event => event.duration);
    keys.sort((a, b) => a - b);
    return { count: keys.length, p95: keys.length ? keys[Math.floor(keys.length * 0.95)] : 0,
      max: keys.length ? keys[keys.length - 1] : 0 };
  });
  // Event Timing only reports events over 16 ms, so no entries means fast.
  out.typing_p95_ms = typing.p95;
  out.typing_slow_events = typing.count;
  out.typing_wall_ms_per_key = typingWall / 48;

  // Run Flow in the console prompt and wait for the answer.
  await page.waitForFunction(() => globalThis.FlowStudioConsoleSubmit, null, { timeout: 20000 });
  out.console_flow_ms = await page.evaluate(async () => {
    const select = document.getElementById('language');
    select.value = 'flow';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const transcript = () => (document.querySelector('.terminal-transcript') || {}).textContent || '';
    const before = transcript().length;
    const start = performance.now();
    FlowStudioConsoleSubmit('flow', '20 + 22');
    while (!(transcript().length > before && transcript().slice(before).includes('42'))) {
      if (performance.now() - start > 60000) return -1;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return performance.now() - start;
  });
  return out;
}

const cold = Object.fromEntries(Object.keys(results.cold[0]).map(key => [key, median(results.cold.map(run => run[key]))]));
const rows = [];
for (const [key, value] of Object.entries(cold)) rows.push(['cold ' + key, value]);
for (const [key, value] of Object.entries(results.warm)) rows.push(['warm ' + key, value]);
for (const [key, value] of Object.entries(results.actions)) rows.push([key, value]);
const width = Math.max(...rows.map(row => row[0].length));
console.log(`FlowStudio perf at ${URL} (1440x900 @2x, median of ${RUNS} cold loads)`);
for (const [key, value] of rows) console.log(key.padEnd(width + 2) + String(round(value)).padStart(9));
if (process.env.PERF_JSON) writeFileSync(process.env.PERF_JSON, JSON.stringify({ cold, runs: results.cold, warm: results.warm, actions: results.actions }, null, 2));

const checks = [
  ['html_ms', cold.html_ms, BUDGET.html_ms * SLACK],
  ['fcp_ms', cold.fcp_ms, BUDGET.fcp_ms * SLACK],
  ['editor_ms', cold.editor_ms, BUDGET.editor_ms * SLACK],
  ['long_task_max_ms', cold.long_task_max_ms, BUDGET.long_task_max_ms * SLACK],
  ['requests', cold.requests, BUDGET.requests],
  ['warm_transfer_kb', results.warm.transfer_kb, BUDGET.warm_transfer_kb],
  ['warm_editor_ms', results.warm.editor_ms, BUDGET.warm_editor_ms * SLACK],
  ...['action_new_tab_ms', 'action_switch_tab_ms', 'action_open_file_ms', 'action_open_panel_ms',
    'action_toggle_dock_ms', 'action_open_menu_ms', 'action_zoom_ms', 'typing_p95_ms', 'console_flow_ms']
    .map(key => [key, results.actions[key], BUDGET[key] * SLACK])
];
const failed = checks.filter(([, value, limit]) => !(value >= 0 && value <= limit));
if (process.env.PERF_NO_ASSERT) process.exit(0);
if (failed.length) {
  for (const [key, value, limit] of failed) console.error(`over budget: ${key} = ${round(value)} (budget ${round(limit)})`);
  process.exit(1);
}
console.log('All performance budgets met.');
