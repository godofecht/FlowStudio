/* Real Chromium acceptance against the running native server:
 *   node tests/native_workbench_polish_ui.mjs
 *
 * Covers the FlowStudio MCP in the Terminal, the Flow backend menu, the
 * explorer project name, and the interaction fixes listed in the PR that
 * added this file. The Terminal part puts a fake `claude` on PATH that only
 * records its arguments, so no model starts. SHOTS=<dir> saves screenshots
 * at 1440x900, 1100x800 and 390x844 for a visual check. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.FLOWSTUDIO_URL || 'http://127.0.0.1:8751/';
const ORIGIN = new globalThis.URL(URL).origin;
const SHOTS = process.env.SHOTS || '';
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push('pageerror: ' + error.message));
  page.on('console', message => { if (message.type() === 'error' && !/status of 410/.test(message.text())) errors.push('console: ' + message.text()); });
  page.on('dialog', dialog => dialog.accept());
};
const fresh = async (width, height, init) => {
  const context = await browser.newContext({ viewport: { width, height } });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  watch(page);
  return { context, page };
};
const ready = page => page.waitForFunction(() => globalThis.FlowStudioTerminal && globalThis.FlowStudioFlowBackendMenu &&
  globalThis.FlowStudioFlowBackendMenu.state.probed(), null, { timeout: 20000 });
const activeId = page => page.evaluate(() => {
  const a = document.activeElement;
  return a ? (a.id || a.className || a.tagName) + ' @' + (a.closest('[id]') || {}).id : '';
});
const newProject = async (page, name) => {
  await page.locator('#projectSwitcher').click();
  await page.locator('#projectMenu [role="menuitem"]', { hasText: 'New project' }).click();
  await page.locator('#npName').fill(name);
  await page.keyboard.press('Enter');
  await page.waitForFunction(n => document.querySelector('.ex-title-text')?.textContent === n &&
    globalThis.FlowStudioProjects.current()?.name === n, name, { timeout: 15000 });
  await page.waitForTimeout(100);
};
const tmp = mkdtempSync(join(tmpdir(), 'fs-polish-'));

try {
  /* ---- 1. Interaction fixes on a fresh page ------------------------------ */
  {
    const { context, page } = await fresh(1440, 900);
    await page.goto(URL);
    await ready(page);
    await page.waitForTimeout(400);
    // The terminal opens in the dock without taking the keyboard from the editor.
    assert.match(await activeId(page), /@monacoHost/, 'the editor has focus after load');

    // Ctrl+Shift+E and Ctrl+Shift+F work while the editor has focus.
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('Control+Shift+E');
    await page.waitForTimeout(150);
    assert.match(await activeId(page), /^ex-primary @/, 'with no folder, Ctrl+Shift+E focuses the explorer empty state');
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('Control+Shift+F');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'projectSearch', 'Ctrl+Shift+F searches the folder');

    // Run shows it is busy while a run is in flight, then clears.
    await page.evaluate(() => {
      globalThis.__busySeen = false;
      new MutationObserver(() => {
        if (document.getElementById('run').getAttribute('aria-busy') === 'true') globalThis.__busySeen = true;
      }).observe(document.getElementById('run'), { attributes: true });
    });
    await page.locator('#run').click();
    await page.waitForFunction(() => globalThis.__busySeen, null, { timeout: 10000 });
    await page.waitForFunction(() => !document.getElementById('run').disabled, null, { timeout: 90000 });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#run').getAttribute('aria-busy'), null, 'busy clears when the run ends');
    // The console run line names the backend.
    await page.waitForFunction(() => /on the C backend/.test(document.getElementById('terminalRoot').innerText), null, { timeout: 10000 });
    // A new tab at the end of an overflowing strip is scrolled into view.
    for (let i = 0; i < 14; i++) await page.locator('#newDocumentTab').click();
    await page.waitForTimeout(250);
    const strip = await page.evaluate(() => {
      const s = document.getElementById('docTabs');
      const a = s.querySelector('[aria-selected="true"]').getBoundingClientRect(), b = s.getBoundingClientRect();
      return { overflow: s.scrollWidth > s.clientWidth, visible: a.left >= b.left - 1 && a.right <= b.right + 1 };
    });
    assert.ok(strip.overflow, 'the tab strip overflows');
    assert.ok(strip.visible, 'the active tab is visible');

    await context.close();
  }

  /* ---- 2. FlowStudio MCP in the Terminal ---------------------------------- */
  {
    const log = join(tmp, 'argv.log');
    const fakeDir = join(tmp, 'fakebin');
    rmSync(fakeDir, { recursive: true, force: true });
    await import('node:fs').then(fs => fs.mkdirSync(fakeDir));
    writeFileSync(join(fakeDir, 'claude'),
      `#!/bin/sh\npython3 -c 'import json, sys; print(json.dumps(sys.argv[1:]))' "$@" >> "${log}"\n`);
    chmodSync(join(fakeDir, 'claude'), 0o755);
    const { context, page } = await fresh(1440, 900);
    await page.goto(URL);
    await ready(page);
    await page.locator('#dockView-terminal').click();
    await page.waitForFunction(() => FlowStudioTerminal.active && FlowStudioTerminal.active.id);
    const screen = () => page.evaluate(() => {
      const b = FlowStudioTerminal.active.term.buffer.active;
      let t = ''; for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true) + '\n';
      return t;
    });
    await page.waitForFunction(() => {
      const b = FlowStudioTerminal.active.term.buffer.active;
      let t = ''; for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true) + '\n';
      return /FlowStudio MCP tools are ready for claude and codex/.test(t);
    }, null, { timeout: 15000 });
    await page.locator('#shellTerminal .xterm').click();
    await page.keyboard.type(`echo "fs-mcp|$(command -v claude)|$FLOWSTUDIO_URL|\${FLOWSTUDIO_MCP##*/}"\n`, { delay: 5 });
    await page.waitForFunction(() => {
      const b = FlowStudioTerminal.active.term.buffer.active;
      let t = ''; for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true) + '\n';
      return /^fs-mcp\|\S+/m.test(t);
    }, null, { timeout: 20000 }).catch(async error => { console.error(await screen()); throw error; });
    const line = (await screen()).match(/^fs-mcp\|([^|\s]+)\|([^|\s]+)\|(\S+)$/m);
    assert.ok(line, 'the shell printed the probe line');
    assert.match(line[1], /\/mcp\/terminal\/bin\/claude$/, 'claude resolves to the FlowStudio wrapper first');
    assert.equal(line[2], ORIGIN, 'FLOWSTUDIO_URL names this server');
    assert.equal(line[3], 'flowstudio_mcp.py');
    // The wrapper runs the next claude on PATH (the fake) with the MCP server.
    // PATH holds only the wrapper, the fake and the system folders, so a real
    // claude can never start here, and the arguments are ones it would reject.
    await page.keyboard.type(`PATH="$FLOWSTUDIO_TERMINAL_BIN:${fakeDir}:/usr/bin:/bin" claude --fs-probe "two words"; echo fs-done-$?\n`, { delay: 5 });
    await page.waitForFunction(() => {
      const b = FlowStudioTerminal.active.term.buffer.active;
      let t = ''; for (let i = 0; i < b.length; i++) t += b.getLine(i).translateToString(true) + '\n';
      return /^fs-done-0$/m.test(t);
    }, null, { timeout: 20000 }).catch(async error => { console.error(await screen()); throw error; });
    assert.ok(existsSync(log), 'the fake claude ran');
    const argv = JSON.parse(readFileSync(log, 'utf8').trim().split('\n').pop());
    assert.deepEqual(argv.slice(1), ['--fs-probe', 'two words'], 'user arguments pass through in order');
    const config = JSON.parse(argv[0].replace(/^--mcp-config=/, ''));
    assert.deepEqual(config.mcpServers.flowstudio.env, { FLOWSTUDIO_URL: ORIGIN });
    assert.match(config.mcpServers.flowstudio.args[0], /\/mcp\/flowstudio_mcp\.py$/);
    await context.close();
  }

  /* ---- 3. Backend menu: keyboard, availability, per-project memory -------- */
  {
    const { context, page } = await fresh(1440, 900);
    await page.goto(URL);
    await ready(page);
    const mlirAvailable = await page.evaluate(() => FlowStudioFlowBackendMenu.state.available('mlir'));
    const button = page.locator('#flowBackendButton');
    assert.equal((await button.textContent()).trim(), 'C');
    assert.match(await page.locator('#run').getAttribute('title'), /^Run with the Flow C backend/);
    await button.focus();
    await page.keyboard.press('Enter');
    assert.equal(await button.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'flowBackendItem-c', 'focus lands on the checked backend');
    const items = page.locator('#flowBackendMenu [role="menuitemradio"]');
    assert.equal(await items.count(), 2);
    for (const id of ['c', 'mlir'])
      assert.ok((await page.locator(`#flowBackendItem-${id} .bm-desc`).textContent()).length > 10, id + ' has a description');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#flowBackendMenu').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'flowBackendButton', 'Escape returns focus');

    await newProject(page, 'fs-backend-alpha');
    if (mlirAvailable === true) {
      await button.focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#flowBackend').inputValue(), 'mlir');
      assert.equal((await button.textContent()).trim(), 'MLIR');
      assert.match(await page.locator('#run').getAttribute('title'), /^Run with the Flow MLIR backend/);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'flowBackendButton');
      await newProject(page, 'fs-backend-beta');
      assert.equal(await page.locator('#flowBackend').inputValue(), '', 'a new project starts on C');
      await page.locator('#projectSwitcher').click();
      await page.locator('#projectMenu [role="menuitem"]', { hasText: 'fs-backend-alpha' }).click();
      await page.waitForFunction(() => document.querySelector('.ex-title-text')?.textContent === 'fs-backend-alpha');
      await page.waitForFunction(() => document.getElementById('flowBackend').value === 'mlir', null, { timeout: 5000 });
      assert.equal((await button.textContent()).trim(), 'MLIR', 'the project keeps its backend');
    } else {
      console.log('MLIR is not available on this machine; checking the disabled state only');
    }
    await context.close();

    // MLIR missing (the probe answer is replaced): the item is disabled with
    // the reason, and a remembered MLIR choice runs on C.
    const missing = await fresh(1440, 900, () => {
      try { localStorage.setItem('flowstudio.flowBackend.v1', JSON.stringify({ projects: {}, last: 'mlir' })); } catch (_) {}
    });
    await missing.page.route('**/api/flow/backends', route => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ c: { available: true }, mlir: { available: false, reason: 'MLIR tools not found. Test reason.' } }) }));
    await missing.page.goto(URL);
    await ready(missing.page);
    assert.equal(await missing.page.locator('#flowBackend').inputValue(), '', 'runs fall back to C');
    await missing.page.locator('#flowBackendButton').click();
    const mlir = missing.page.locator('#flowBackendItem-mlir');
    assert.equal(await mlir.getAttribute('aria-disabled'), 'true');
    assert.equal(await mlir.locator('.bm-status').textContent(), 'MLIR tools not found. Test reason.');
    await mlir.click({ force: true });
    assert.equal(await missing.page.locator('#flowBackend').inputValue(), '', 'a disabled backend cannot be chosen');
    assert.match(await missing.page.locator('#flowBackendButton').getAttribute('aria-label'), /not available/);
    await missing.context.close();
  }

  /* ---- 4. Explorer name and layout at three sizes ------------------------- */
  const layout = () => {
    const W = innerWidth, problems = [];
    const visible = n => {
      for (let p = n; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
      }
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const name = n => n.id ? '#' + n.id : n.className;
    const controls = [...document.querySelectorAll('.topbar button, .topbar select, .dock h2 button, .doc-tabs-row > button, .statusbar *')]
      .filter(n => visible(n) && !n.closest('[hidden], .menu-popup, dialog'));
    for (const n of controls) {
      const r = n.getBoundingClientRect();
      if (r.right > W + 0.5 || r.left < -0.5) problems.push('offscreen ' + name(n));
    }
    const top = controls.filter(n => n.closest('.topbar') && n.tagName === 'BUTTON');
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
      if (top[i].contains(top[j]) || top[j].contains(top[i])) continue;
      const a = top[i].getBoundingClientRect(), b = top[j].getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)
        problems.push('overlap ' + name(top[i]) + ' ' + name(top[j]));
    }
    if (document.documentElement.scrollWidth > W) problems.push('page scrolls sideways');
    return problems;
  };
  for (const [width, height] of [[1440, 900], [1100, 800], [390, 844]]) {
    const { context, page } = await fresh(width, height);
    await page.goto(URL);
    await ready(page);
    if (width > 600) {
      await newProject(page, 'polyglot-pipeline-analysis');
      await page.mouse.move(width - 4, height / 2);       // explorer not hovered
      const title = await page.evaluate(() => {
        const t = document.querySelector('.ex-title-text');
        return { full: t.scrollWidth <= t.clientWidth, tip: document.querySelector('.ex-title').title };
      });
      assert.ok(title.full, `${width}px: the project name is not cut off when it fits`);
      assert.equal(title.tip, 'polyglot-pipeline-analysis');
      // A name that cannot fit is cut with an ellipsis and keeps its tooltip.
      const long = 'a-very-long-project-name-that-cannot-fit-in-the-explorer';
      await newProject(page, long);
      const cut = await page.evaluate(() => {
        const t = document.querySelector('.ex-title-text');
        return { cut: t.scrollWidth > t.clientWidth, ellipsis: getComputedStyle(t).textOverflow, tip: document.querySelector('.ex-title').title };
      });
      assert.ok(cut.cut && cut.ellipsis === 'ellipsis', 'a long name truncates with an ellipsis');
      assert.equal(cut.tip, long);
    }
    await page.mouse.move(width / 2, height / 2);
    assert.deepEqual(await page.evaluate(layout), [], `${width}x${height} layout`);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `polish-${width}.png`) });
    await page.locator('#flowBackendButton').click();
    const menu = await page.locator('#flowBackendMenu').boundingBox();
    assert.ok(menu.x >= 0 && menu.x + menu.width <= width + 0.5, `${width}px: the backend menu stays on screen`);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `polish-menu-${width}.png`) });
    await context.close();
  }

  assert.deepEqual(errors, []);
  console.log('PASS: editor keeps focus on load, explorer and folder-search shortcuts from the editor, active tab revealed, Run busy state, backend on the run line, FlowStudio MCP in the Terminal, backend menu keyboard, availability and per-project memory, explorer name width, layout at three sizes');
} finally {
  rmSync(tmp, { recursive: true, force: true });
  await browser.close();
}
