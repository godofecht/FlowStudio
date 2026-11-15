/* Real Chromium acceptance for Flow plots and Flow packages against the
 * running native server: node tests/native_flow_plots_packages_ui.mjs
 *
 * Plots: a console entry and a whole script draw with plot, scatter and
 * hist from src/flowstudio.flow. The figures land in the Plots pane, which
 * steps back and forward through them, zooms, and saves SVG and PNG files.
 *
 * Packages: a temporary folder becomes a Flow project through flow init,
 * gains a local path dependency through flow add --path and loses it again.
 * Nothing touches the network. Screenshots go to SCREENSHOT_DIR (default:
 * the system temporary folder) at 1440x900 and 390x844. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.FLOWSTUDIO_URL || 'http://127.0.0.1:8751/';
const SHOTS = process.env.SCREENSHOT_DIR || tmpdir();
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', error => errors.push('pageerror: ' + error.message));
page.on('console', message => {
  if (message.type() === 'error' && !/status of (410|422|503)/.test(message.text())) errors.push('console: ' + message.text());
});
page.on('dialog', dialog => dialog.accept());
await page.goto(URL);
await page.waitForFunction(() => globalThis.FlowStudioFlowSession && globalThis.FlowStudioConsoleSubmit &&
  globalThis.FlowStudioEditor && FlowStudioEditor.editor && globalThis.FlowStudioPlotPane && FlowStudioPlotPane.instance);
await page.evaluate(async () => { await FlowStudioFlowSession.client.reset(); });
await page.evaluate(() => {
  const select = document.getElementById('language');
  select.value = 'flow';
  select.dispatchEvent(new Event('change', { bubbles: true }));
});
const transcript = () => page.evaluate(() => document.querySelector('.terminal-transcript').textContent);
const position = () => page.locator('#plotPosition').textContent();
const caption = () => page.locator('#plotStage figcaption').textContent();
const idle = () => page.waitForFunction(() => document.getElementById('resultStatus').dataset.state !== '' &&
  !/^Running/.test(document.getElementById('resultStatus').textContent), null, { timeout: 90000 });

// ---- Console entries: Ctrl+Enter sends each statement to the session -----
const SCRIPT = [
  'import flowstudio { plot, scatter, hist, plot_title, plot_labels }',
  'let mut xs: array<f64, 40> = [0.0; 40]',
  'let mut ys: array<f64, 40> = [0.0; 40]',
  'for i in 0..40 {',
  '    xs[i] = i as f64 * 0.25',
  '    ys[i] = xs[i] * xs[i] - 4.0',
  '}',
  'plot_title("Console parabola")',
  'plot(xs, ys)'
].join('\n');
await page.evaluate(text => {
  const editor = FlowStudioEditor.editor;
  editor.setValue(text);
  editor.setSelection(editor.getModel().getFullModelRange());
  editor.focus();
}, SCRIPT);
const before = (await transcript()).length;
await page.keyboard.press('Control+Enter');
await page.waitForFunction(size => document.querySelector('.terminal-transcript').textContent.length > size &&
  /Flow plot 1 is in the Plots pane/.test(document.querySelector('.terminal-transcript').textContent), before, { timeout: 90000 })
  .catch(async error => { console.error('console at timeout:\n' + (await transcript()).slice(-3000)); throw error; });
await idle();
assert.equal(await page.locator('#tab-plots').getAttribute('aria-selected'), 'true', 'a Flow plot opens the Plots tab');
assert.equal(await position(), '1 of 1');
assert.equal(await caption(), 'Flow plot 1');
assert.doesNotMatch(await transcript(), /\u001e|FLOWSTUDIO-PLOT|<svg/, 'the frame never reaches the console');

// The console prompt reaches the same session: scatter from typed input.
const prompt = page.locator('.terminal-prompt-line textarea');
await prompt.click();
await prompt.fill('scatter(xs, ys)');
await prompt.press('Enter');
await page.waitForFunction(() => /Flow plot 2 is in the Plots pane/.test(document.querySelector('.terminal-transcript').textContent),
  null, { timeout: 90000 });
await idle();
assert.equal(await position(), '2 of 2');

// ---- A whole script with main(), through the Run button --------------------
await page.evaluate(() => {
  const editor = FlowStudioEditor.editor;
  editor.setValue([
    'import flowstudio { hist, plot_title, plot_labels }',
    '',
    'function main() -> i32 {',
    '    let mut v: array<f64, 200> = [0.0; 200]',
    '    for i in 0..200 {',
    '        let t: f64 = i as f64 / 199.0',
    '        v[i] = t * t * 10.0',
    '    }',
    '    println("script ran")',
    '    plot_title("Script histogram")',
    '    plot_labels("value", "count")',
    '    hist(v, 12)',
    '    return 0',
    '}',
    ''
  ].join('\n'));
  editor.setPosition({ lineNumber: 1, column: 1 });
});
await page.locator('#run').click();
await page.waitForFunction(() => /Flow plot 3 is in the Plots pane/.test(document.querySelector('.terminal-transcript').textContent),
  null, { timeout: 90000 });
await idle();
assert.match(await transcript(), /script ran/);
assert.equal(await position(), '3 of 3');
assert.equal(await page.locator('#plotStage figure[data-kind="svg"] img').count(), 1);

// ---- History: back and forward -------------------------------------------
await page.locator('#plotBack').click();
assert.equal(await position(), '2 of 3');
assert.equal(await caption(), 'Flow plot 2');
await page.locator('#plotBack').click();
assert.equal(await position(), '1 of 3');
assert.equal(await page.locator('#plotBack').isDisabled(), true, 'nothing before the first plot');
await page.locator('#plotStage').focus();
await page.keyboard.press('ArrowRight');
assert.equal(await position(), '2 of 3', 'the arrow keys step through the history');
await page.locator('#plotForward').click();
assert.equal(await position(), '3 of 3');
assert.equal(await page.locator('#plotForward').isDisabled(), true);

// ---- Zoom ----------------------------------------------------------------
await page.waitForFunction(() => document.querySelector('#plotStage img').complete);
const fitWidth = await page.evaluate(() => document.querySelector('#plotStage img').getBoundingClientRect().width);
await page.locator('#plotZoomIn').click();
const zoomLabel = await page.locator('#plotZoomFit').textContent();
assert.match(zoomLabel, /^\d+%$/, 'zoom shows its level');
const zoomed = await page.evaluate(() => document.querySelector('#plotStage img').getBoundingClientRect().width);
assert.ok(zoomed > fitWidth, `zoom in widens the plot (${fitWidth} -> ${zoomed})`);
await page.locator('#plotZoomFit').click();
assert.equal(await page.locator('#plotZoomFit').textContent(), 'Fit');

// ---- Export SVG and PNG --------------------------------------------------
const [svgDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#plotExportSvg').click()]);
assert.equal(svgDownload.suggestedFilename(), 'flowstudio-flow-plot-3.svg');
const svgText = readFileSync(await svgDownload.path(), 'utf8');
assert.match(svgText, /^<svg [^>]*data-flow-plot="hist"/);
assert.match(svgText, /Script histogram/);
assert.match(svgText, /<\/svg>$/);
const [pngDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#plotExportPng').click()]);
assert.equal(pngDownload.suggestedFilename(), 'flowstudio-flow-plot-3.png');
const png = readFileSync(await pngDownload.path());
assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'a real PNG');
assert.equal(png.readUInt32BE(16), 1280, 'PNG is drawn at twice the SVG width');
await page.screenshot({ path: join(SHOTS, 'flow-plots-1440.png') });

// ---- Packages: flow init, flow add --path, remove ------------------------
const base = mkdtempSync(join(tmpdir(), 'flowstudio-pkg-'));
const project = join(base, 'demo');
const library = join(base, 'tinylib');
mkdirSync(project);
mkdirSync(join(library, 'src'), { recursive: true });
writeFileSync(join(library, 'flow.toml'), '[package]\nname = "tinylib"\nversion = "0.3.0"\nentry = "src/main.flow"\n');
writeFileSync(join(library, 'src', 'main.flow'), 'export function seven() -> i32 {\n    return 7\n}\n');
try {
  await page.locator('#tab-packages').click();
  await page.locator('#packagesKind-flow').click();
  await page.locator('#flowPackagesFolder').fill(project);
  await page.locator('#flowPackagesOpen').click();
  await page.waitForSelector('#flowPackagesInit');
  assert.match(await page.locator('#packageSummary').textContent(), /No flow\.toml/);
  await page.locator('#flowPackagesInit').click();
  await page.waitForFunction(() => /0 Flow dependencies/.test(document.getElementById('packageSummary').textContent), null, { timeout: 120000 });
  assert.ok(existsSync(join(project, 'flow.toml')), 'flow init wrote flow.toml');
  assert.match(await page.locator('#packageLog').textContent(), /\$ flow init[\s\S]*Created flow\.toml/);

  await page.locator('#packageQuery').fill(library);
  await page.waitForSelector('#flowPackagesAdd');
  await page.locator('#flowPackagesAdd').click();
  await page.waitForSelector('#packageRows .pk-row[data-name="tinylib"]', { timeout: 120000 });
  assert.match(await page.locator('#packageLog').textContent(), /\$ flow add --path .* --name tinylib[\s\S]*Installed tinylib/);
  assert.match(await page.locator('#packageRows .pk-row[data-name="tinylib"] .pk-version').textContent(), /^path /);
  assert.match(readFileSync(join(project, 'flow.toml'), 'utf8'), /^tinylib = \{ path = /m);
  assert.ok(existsSync(join(project, 'flow_packages', 'tinylib', 'src', 'main.flow')), 'installed under flow_packages');
  await page.screenshot({ path: join(SHOTS, 'flow-packages-1440.png') });

  const row = page.locator('#packageRows .pk-row[data-name="tinylib"]');
  await row.hover();
  await row.getByRole('button', { name: 'Remove' }).click();
  await page.waitForFunction(() => !document.querySelector('#packageRows .pk-row[data-name="tinylib"]') &&
    /0 Flow dependencies/.test(document.getElementById('packageSummary').textContent), null, { timeout: 120000 });
  assert.match(await page.locator('#packageLog').textContent(), /Removed tinylib from flow\.toml[\s\S]*\$ flow sync/);
  assert.doesNotMatch(readFileSync(join(project, 'flow.toml'), 'utf8'), /tinylib/);
  assert.equal(existsSync(join(project, 'flow_packages', 'tinylib')), false, 'the installed copy is gone');

  // ---- Phone width: no sideways scroll in either view --------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(await overflow() <= 0, 'no horizontal scroll at 390px in Packages');
  await page.screenshot({ path: join(SHOTS, 'flow-packages-390.png') });
  await page.locator('#tab-plots').click();
  await page.waitForTimeout(200);
  assert.ok(await overflow() <= 0, 'no horizontal scroll at 390px in Plots');
  // The shell folds the sidebar away at phone width (web/ide_shell.js), so
  // the toolbar either fits the screen or is not laid out at all.
  const bar = await page.evaluate(() => {
    const box = document.querySelector('.plot-bar').getBoundingClientRect();
    return { right: box.right, shown: box.width > 0, width: innerWidth };
  });
  assert.ok(!bar.shown || bar.right <= bar.width + 1, 'the plot toolbar fits the phone width');
  await page.screenshot({ path: join(SHOTS, 'flow-plots-390.png') });
} finally {
  rmSync(base, { recursive: true, force: true });
}

assert.deepEqual(errors, [], 'no unexpected console errors');
await browser.close();
console.log('Flow plots and packages: console and script plots, history, zoom, SVG and PNG export, flow init/add/remove passed');
