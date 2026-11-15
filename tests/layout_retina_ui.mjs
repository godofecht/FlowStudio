/* Retina layout and type check against the running native server:
 *   FLOWSTUDIO_URL=http://127.0.0.1:8751 node tests/layout_retina_ui.mjs
 *
 * Opens each surface of the workbench at 1440x900, 1280x800 and 390x844,
 * all at deviceScaleFactor 2, and at 1440x900 again with View zoom at 120%.
 * On every surface it checks that:
 *   - no visible text is smaller than 11 CSS px (the --text-xs floor),
 *   - primary UI text (menus, tabs, panel titles) is 13 px and the editor,
 *     console and terminal use 13 px mono,
 *   - text is not clipped by its box, unless the box ends it with an ellipsis,
 *   - controls in the title bar, the tab strip and the status bar do not
 *     overlap, and nothing leaves the window,
 *   - the page never scrolls sideways.
 * SHOTS=<dir> saves a screenshot of each surface. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = (process.env.FLOWSTUDIO_URL || 'http://127.0.0.1:8751').replace(/\/+$/, '') + '/';
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
const failures = [];

/* Runs in the page. Returns a list of problems on the current surface. */
const audit = () => {
  const problems = [];
  const W = innerWidth, H = innerHeight;
  const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom')) || 1;
  const visible = node => {
    if (!node.isConnected) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= H || rect.left >= W) return false;
    if (node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    for (let n = node; n && n !== document.documentElement; n = n.parentElement) {
      const style = getComputedStyle(n);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      if (style.clip === 'rect(0px, 0px, 0px, 0px)') return false;
    }
    return true;
  };
  const name = node => node.id ? '#' + node.id : node.tagName.toLowerCase() +
    (node.className && typeof node.className === 'string' ? '.' + node.className.trim().split(/\s+/).join('.') : '') +
    ' "' + (node.textContent || '').trim().slice(0, 24) + '"';
  // Elements that hold their own text.
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim()) continue;
    const owner = t.parentElement;
    if (!owner || texts.includes(owner)) continue;
    // Monaco and xterm draw their own text; SVG plot labels scale with the plot.
    if (owner.closest('.monaco-editor,.xterm,svg,script,style,noscript,textarea,select,option,.hidden-widget')) continue;
    texts.push(owner);
  }
  for (const node of texts) {
    if (!visible(node)) continue;
    const style = getComputedStyle(node);
    const size = parseFloat(style.fontSize);
    if (size < 11 * Math.min(1, zoom) - 0.01) problems.push(`text ${size}px under 11px: ${name(node)}`);
    // Clipped horizontally without an ellipsis, or vertically.
    const clipsX = /hidden|clip/.test(style.overflowX) && style.textOverflow !== 'ellipsis' && style.whiteSpace !== 'normal';
    if (clipsX && node.scrollWidth > node.clientWidth + 1) problems.push(`text clipped sideways: ${name(node)} ${node.scrollWidth}>${node.clientWidth}`);
    const clamped = style.webkitLineClamp && style.webkitLineClamp !== 'none';
    if (!clamped && /hidden|clip/.test(style.overflowY) && node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 2 &&
        node.childElementCount === 0 && !/auto|scroll/.test(style.overflowY))
      problems.push(`text clipped vertically: ${name(node)} ${node.scrollHeight}>${node.clientHeight}`);
    const rect = node.getBoundingClientRect();
    if (rect.right > W + 0.5 || rect.left < -0.5) problems.push(`text leaves the window: ${name(node)}`);
  }
  // Rows of controls whose items must not overlap.
  const rows = [
    ['.topbar', '.brand,.project-switcher,.menubar .menu-trigger,.command-launcher,.run-widget>*,.topbar [data-layout-toggle]'],
    ['.statusbar', ':scope>*'],
    ['#docTabs', '.doc-tab'],
    ['.dock>h2', '.dock-view,.xt-action,#clear']
  ];
  for (const [rowSelector, items] of rows) {
    const row = document.querySelector(rowSelector);
    if (!row || !visible(row)) continue;
    const nodes = Array.from(row.querySelectorAll(items)).filter(visible);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].contains(nodes[j]) || nodes[j].contains(nodes[i])) continue;
      const a = nodes[i].getBoundingClientRect(), b = nodes[j].getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)
        problems.push(`overlap in ${rowSelector}: ${name(nodes[i])} and ${name(nodes[j])}`);
    }
  }
  if (document.scrollingElement.scrollWidth > W + 0.5) problems.push('page scrolls sideways: ' + document.scrollingElement.scrollWidth);
  return problems;
};

/* Primary sizes, read at the default zoom. */
const sizes = page => page.evaluate(() => {
  const px = selector => {
    const node = document.querySelector(selector);
    return node ? parseFloat(getComputedStyle(node).fontSize) : null;
  };
  const editor = globalThis.FlowStudioEditor.editor;
  const options = globalThis.FlowStudioMonaco.editor.EditorOption;
  const terminal = globalThis.FlowStudioTerminal && globalThis.FlowStudioTerminal.active;
  return {
    menuTrigger: px('.menu-trigger'), docTab: px('.doc-tab'), dockTitle: px('.dock>h2'),
    menuItem: px('#menuFilePopup button'), statusbar: px('.statusbar'),
    editorFont: editor.getOption(options.fontSize), editorLine: editor.getOption(options.lineHeight),
    terminalFont: terminal ? terminal.term.options.fontSize : null,
    smoothing: getComputedStyle(document.body).webkitFontSmoothing
  };
});

const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 260))));

async function surfaces(page, width, label) {
  const checks = [];
  const check = async surface => {
    await settle(page);
    const problems = await page.evaluate(audit);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `${label}-${surface}.png`) });
    for (const problem of problems) failures.push(`${label} ${surface}: ${problem}`);
    checks.push(surface);
  };
  await check('workbench');
  // A long project name, and a wide UI font like the DejaVu Sans a Linux
  // machine falls back to, must not push the title bar off the screen.
  const restore = await page.evaluate(() => {
    const name = document.getElementById('projectName');
    const before = name.textContent;
    name.textContent = 'a-very-long-project-name-that-cannot-fit-in-the-explorer';
    document.documentElement.style.setProperty('--font-ui', 'Verdana, "DejaVu Sans", sans-serif');
    return before;
  });
  await check('long-name-wide-font');
  await page.evaluate(before => {
    document.getElementById('projectName').textContent = before;
    document.documentElement.style.removeProperty('--font-ui');
  }, restore);
  if (width > 900) {
    for (const menu of ['menuFile', 'menuView', 'menuRun']) {
      await page.locator(`#${menu} .menu-trigger`).click();
      await check(menu);
      await page.keyboard.press('Escape');
    }
  }
  await page.evaluate(() => document.getElementById('commandLauncher').click());
  await page.waitForFunction(() => document.getElementById('searchEverywhere').open);
  await page.locator('#seQuery').fill('run');
  await check('search-everywhere');
  await page.keyboard.press('Escape');
  for (const view of ['search', 'outline', 'plots', 'data', 'packages', 'examples', 'debug', 'files']) {
    await page.evaluate(id => document.getElementById('tab-' + id).click(), view);
    await check('sidebar-' + view);
  }
  if (width > 900) {
    for (const view of ['environment', 'preview', 'assistant', 'help']) {
      await page.evaluate(id => globalThis.FlowStudioSidePanel.show(id), view);
      await check('right-' + view);
    }
    await page.evaluate(() => globalThis.FlowStudioLayout.hide('right'));
  }
  for (const view of ['console', 'debug', 'terminal']) {
    await page.evaluate(id => globalThis.FlowStudioTerminal.show(id, { focus: false }), view);
    await check('dock-' + view);
  }
  return checks;
}

try {
  for (const [width, height, zoom] of [[1440, 900, 1], [1280, 800, 1], [390, 844, 1], [1440, 900, 1.2]]) {
    const label = `${width}x${height}${zoom === 1 ? '' : '-zoom' + Math.round(zoom * 100)}`;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    if (zoom !== 1) await context.addInitScript(level => { try { localStorage.setItem('flowstudio.zoom', String(level)); } catch (_) {} }, zoom);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(label + ' pageerror: ' + error.message));
    page.on('console', message => {
      if (message.type() === 'error' && !/status of (410|404|503)/.test(message.text())) errors.push(label + ' console: ' + message.text());
    });
    await page.goto(URL);
    await page.waitForFunction(() => globalThis.FlowStudioEditor && globalThis.FlowStudioEditor.editor &&
      globalThis.FlowStudioTerminal && globalThis.FlowStudioZoom, null, { timeout: 30000 });
    const font = await sizes(page);
    if (zoom === 1) {
      assert.equal(font.editorFont, 13, `${label}: editor text is 13px`);
      assert.equal(font.editorLine, 21, `${label}: editor line height is 21px`);
      assert.equal(font.terminalFont, 13, `${label}: terminal text is 13px`);
      assert.equal(font.statusbar, 12, `${label}: status bar text is 12px`);
      assert.equal(font.docTab, 13, `${label}: tab titles are 13px`);
      assert.equal(font.dockTitle, 13, `${label}: dock title is 13px`);
      if (width > 900) assert.equal(font.menuTrigger, 13, `${label}: menu titles are 13px`);
    } else {
      assert.equal(font.editorFont, Math.round(13 * zoom), `${label}: the editor follows the zoom`);
      assert.equal(font.terminalFont, Math.round(13 * zoom), `${label}: the terminal follows the zoom`);
      assert.equal(font.docTab, 13 * zoom, `${label}: the UI follows the zoom`);
    }
    assert.equal(font.smoothing, 'antialiased', `${label}: text is antialiased on the dark surfaces`);
    const checked = await surfaces(page, width, label);
    console.log(`${label}: ${checked.length} surfaces`);
    await context.close();
  }

  /* Zoom: the View menu and the keyboard both work, the level persists
   * across a reload, and the editor keeps clicking where the user points. */
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push('zoom pageerror: ' + error.message));
    await page.goto(URL);
    await page.waitForFunction(() => globalThis.FlowStudioZoom && globalThis.FlowStudioEditor && globalThis.FlowStudioEditor.editor);
    await page.locator('#menuView .menu-trigger').click();
    await page.getByRole('menuitem', { name: /Zoom in/ }).click();
    assert.equal(await page.evaluate(() => FlowStudioZoom.value()), 1.1, 'View > Zoom in steps to 110%');
    await page.evaluate(() => FlowStudioEditor.editor.focus());
    await page.keyboard.press('ControlOrMeta+Equal');
    assert.equal(await page.evaluate(() => FlowStudioZoom.value()), 1.2, 'Cmd+= zooms in');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.doc-tab')).fontSize), '15.6px');
    await page.reload();
    await page.waitForFunction(() => globalThis.FlowStudioZoom && globalThis.FlowStudioEditor && globalThis.FlowStudioEditor.editor);
    assert.equal(await page.evaluate(() => FlowStudioZoom.value()), 1.2, 'the zoom level persists');
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--zoom')), '1.2',
      'the saved zoom is applied before the bundle runs');
    // A click lands on the character under the pointer at 120%.
    await page.evaluate(() => { FlowStudioEditor.editor.setValue('alpha beta gamma\nsecond line'); });
    await settle(page);
    const target = await page.evaluate(() => {
      const editor = FlowStudioEditor.editor;
      const point = editor.getScrolledVisiblePosition({ lineNumber: 1, column: 8 });
      const box = editor.getDomNode().getBoundingClientRect();
      return { x: box.left + point.left + 2, y: box.top + point.top + point.height / 2 };
    });
    await page.mouse.click(target.x, target.y);
    assert.deepEqual(await page.evaluate(() => { const p = FlowStudioEditor.editor.getPosition(); return [p.lineNumber, p.column]; }), [1, 8],
      'a click at 120% puts the cursor where the pointer is');
    await page.keyboard.press('ControlOrMeta+Minus');
    assert.equal(await page.evaluate(() => FlowStudioZoom.value()), 1.1, 'Cmd+- zooms out');
    await page.keyboard.press('ControlOrMeta+Digit0');
    assert.equal(await page.evaluate(() => FlowStudioZoom.value()), 1, 'Cmd+0 resets');
    assert.equal(await page.evaluate(() => localStorage.getItem('flowstudio.zoom')), null, 'actual size clears the saved level');
    await context.close();
  }

  /* Reduced motion: every motion token is zero. */
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(URL);
    await page.waitForFunction(() => globalThis.FlowStudioEditor && globalThis.FlowStudioEditor.editor);
    const tokens = await page.evaluate(() => ['--dur-press', '--dur-fast', '--dur-base', '--dur-panel']
      .map(name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()));
    assert.deepEqual(tokens, ['0s', '0s', '0s', '0s'], 'reduced motion turns every duration off');
    await page.locator('#menuFile .menu-trigger').click();
    const animation = await page.evaluate(() => getComputedStyle(document.getElementById('menuFilePopup')).animationDuration);
    assert.equal(animation, '0s', 'menus appear without motion');
    await context.close();
  }

  assert.deepEqual(failures, [], 'layout problems');
  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS: type floor and primary sizes, no clipped text, overlap or sideways scroll at 1440x900, 1280x800, 390x844 and 120% zoom; zoom by menu and keyboard persists and keeps editor clicks exact; reduced motion');
} finally {
  await browser.close();
}
