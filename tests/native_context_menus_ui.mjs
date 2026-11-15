/* Real Chromium acceptance for FlowStudio's right-click menus against the
 * running native server: node tests/native_context_menus_ui.mjs
 *
 * Right-clicks every surface (explorer, editor tabs, the Monaco editor,
 * console, terminal, Environment, Plots) and performs real actions through
 * the menus: files are renamed, duplicated and deleted on disk, code runs in
 * the native Python and Flow sessions, the terminal is a real shell, and the
 * clipboard is read back. Also checks keyboard opening, placement at the
 * window edge, open time, reduced motion, and layouts at 1440x900 (2x) and
 * 390x844. The folder picker is an origin-private folder (OPFS), whose
 * handles are real FileSystemDirectoryHandle objects. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const URL = process.env.FLOWSTUDIO_URL || 'http://127.0.0.1:8751/';
const SHOTS = 'build/ui';
await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push('pageerror: ' + error.message));
  page.on('console', message => {
    // 410 is a closed pty session; 422 is the deliberate Python NameError below.
    if (message.type() === 'error' && !/status of (410|422)/.test(message.text())) errors.push('console: ' + message.text());
  });
  page.on('dialog', dialog => dialog.accept());
};
const origin = new globalThis.URL(URL).origin;
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
await context.addInitScript(() => {
  globalThis.showDirectoryPicker = async () => {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle('ctxproj', { create: true });
  };
  // Records whether the app kept the browser's own menu away.
  addEventListener('contextmenu', event => { globalThis.__lastContextMenuPrevented = event.defaultPrevented; });
});
const page = await context.newPage();
watch(page);

/* ---------- helpers ---------- */
const menu = () => page.locator('.fs-cm').first();
const labels = () => page.evaluate(() => [...(document.querySelector('.fs-cm')?.querySelectorAll('.fs-cm-item .fs-cm-label') || [])].map(node => node.textContent));
const item = label => page.locator('.fs-cm .fs-cm-item').filter({ has: page.locator('.fs-cm-label', { hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).first();
async function choose(label) {
  const row = item(label);
  assert.equal(await row.count(), 1, label + ' is in the menu: ' + (await labels()).join(', '));
  assert.notEqual(await row.getAttribute('aria-disabled'), 'true', label + ' is enabled (' + (await row.getAttribute('data-reason')) + ')');
  await row.click();
  assert.equal(await page.locator('.fs-cm').count(), 0, 'the menu closes after ' + label);
}
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
const setClipboard = text => page.evaluate(value => navigator.clipboard.writeText(value), text);
const opfs = {
  list: () => page.evaluate(async () => {
    const out = [];
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('ctxproj');
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir.entries()) {
        const path = prefix ? prefix + '/' + name : name;
        out.push(path + (handle.kind === 'directory' ? '/' : ''));
        if (handle.kind === 'directory') await walk(handle, path);
      }
    }
    await walk(root, '');
    return out.sort();
  }),
  read: path => page.evaluate(async path => {
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('ctxproj');
    const parts = path.split('/');
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return (await (await dir.getFileHandle(parts.at(-1))).getFile()).text();
  }, path)
};
const row = rel => page.locator(`#explorer .ex-row[data-rel="${rel}"]`);
const transcript = () => page.evaluate(() => document.querySelector('.terminal-transcript').textContent);
const idle = () => page.waitForFunction(() => !/^Running/.test(document.getElementById('resultStatus').textContent) &&
  !document.getElementById('run').disabled, null, { timeout: 90000 });
const inViewport = box => page.evaluate(box => box.x >= 0 && box.y >= 0 && box.x + box.width <= innerWidth &&
  box.y + box.height <= innerHeight, box);

try {
  await page.goto(URL);
  await page.waitForFunction(() => globalThis.FlowStudioEditor?.editor && globalThis.FlowStudioWorkspaceExplorer &&
    globalThis.FlowStudioContextMenu && globalThis.FlowStudioEditorTabs && globalThis.FlowStudioSplitEditor &&
    globalThis.FlowStudioConsoleView && globalThis.FlowStudioPlotPane?.instance && globalThis.FlowStudioTerminal);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry('ctxproj', { recursive: true }); } catch (_) { /* first run */ }
    const proj = await root.getDirectoryHandle('ctxproj', { create: true });
    const write = async (dir, name, text) => {
      const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writer.write(text); await writer.close();
    };
    const src = await proj.getDirectoryHandle('src', { create: true });
    await write(src, 'calc.py', 'x = 21\nprint(x * 2)\n');
    await write(src, 'hello.py', 'print("ran from the explorer menu")\n');
    await write(src, 'notes.md', '# notes\n');
    await write(proj, 'a.txt', 'alpha\n');
    await write(proj, 'b.txt', 'beta\n');
    await write(proj, 'c.txt', 'gamma\n');
  });

  /* ==== 1. The component: no browser menu, placement, speed, motion ===== */
  await page.locator('.topbar').click({ button: 'right', position: { x: 600, y: 10 } });
  assert.equal(await page.locator('.fs-cm').count(), 1, 'app chrome gets the FlowStudio menu');
  assert.equal(await page.evaluate(() => __lastContextMenuPrevented), true, 'the browser menu stays off app surfaces');
  assert.deepEqual(await labels(), ['Copy', 'Command Palette']);
  assert.equal(await item('Copy').getAttribute('aria-disabled'), 'true', 'Copy without a selection is disabled');
  await item('Copy').hover();
  assert.equal(await page.locator('.fs-cm-tip').textContent(), 'Select some text first.', 'disabled items explain why on hover');
  assert.equal(await page.locator('.fs-cm-tip').isVisible(), true);
  const style = await page.evaluate(() => {
    const row = document.querySelector('.fs-cm .fs-cm-item');
    const menuNode = document.querySelector('.fs-cm');
    return { height: row.getBoundingClientRect().height, font: getComputedStyle(row).fontSize,
      role: menuNode.getAttribute('role'), itemRole: row.getAttribute('role'),
      key: document.querySelectorAll('.fs-cm .fs-cm-key')[1].textContent };
  });
  assert.deepEqual([style.height, style.font, style.role, style.itemRole], [28, '13px', 'menu', 'menuitem']);
  assert.match(style.key, /^(⌘K|Ctrl\+K)$/, 'shortcuts use the platform style');
  await choose('Command Palette');
  await page.waitForFunction(() => document.querySelector('dialog[open]'));
  await page.keyboard.press('Escape');

  // A native text field keeps the browser's own menu (copy, paste, spelling).
  await page.locator('#tab-search').click();
  await page.locator('#projectInclude').click({ button: 'right' });
  assert.equal(await page.locator('.fs-cm').count(), 0, 'no app menu over a text field');
  assert.equal(await page.evaluate(() => __lastContextMenuPrevented), false, 'the browser menu is kept in text fields');
  await page.keyboard.press('Escape');
  await page.locator('#tab-files').click();

  // Near the bottom-right corner the menu flips and stays on screen.
  await page.mouse.click(1436, 892, { button: 'right' });
  const corner = await menu().boundingBox();
  assert.ok(await inViewport(corner), 'menu clamped inside the window: ' + JSON.stringify(corner));
  assert.ok(corner.x + corner.width <= 1436 && corner.y + corner.height <= 892, 'flipped up and left of the pointer');
  // A pane the app scrolls by itself leaves it open; the wheel closes it.
  await page.evaluate(() => document.querySelector('.terminal-transcript').dispatchEvent(new Event('scroll')));
  assert.equal(await page.locator('.fs-cm').count(), 1, 'output scrolling a pane keeps the menu');
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => !document.querySelector('.fs-cm'));
  // A click elsewhere closes it too.
  await page.mouse.click(1436, 892, { button: 'right' });
  await page.mouse.click(700, 400);
  assert.equal(await page.locator('.fs-cm').count(), 0, 'outside click closes the menu');

  // Opening is fast: the median of five opens stays under one frame.
  const times = await page.evaluate(() => {
    const target = document.querySelector('#docTabs .doc-tab');
    const box = target.getBoundingClientRect();
    const out = [];
    for (let i = 0; i < 6; i++) {
      const start = performance.now();
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 5, clientY: box.bottom - 4 }));
      document.querySelector('.fs-cm').getBoundingClientRect();
      out.push(performance.now() - start);
      FlowStudioContextMenu.close();
    }
    return out.slice(1).sort((a, b) => a - b);
  });
  assert.ok(times[2] < 16, 'menu opens in under 16 ms (median ' + times[2].toFixed(2) + ' ms)');
  // Reduced motion switches the open animation off.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#docTabs .doc-tab').first().click({ button: 'right' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.fs-cm')).animationName), 'none');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#docTabs .doc-tab').first().click({ button: 'right' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.fs-cm')).animationName), 'fs-cm-in');
  await page.keyboard.press('Escape');

  /* ==== 2. Explorer ===================================================== */
  await page.locator('#explorer [data-action="openFolder"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#explorer .ex-row[data-rel]').length >= 4);
  await row('src').click();
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[data-rel="src/calc.py"]'));
  await row('src/hello.py').click({ button: 'right' });
  for (const label of ['Open', 'Open to the Side', 'Run', 'New File...', 'New Folder...', 'Find in Folder...',
    'Copy Path', 'Copy Relative Path', 'Duplicate', 'Rename...', 'Delete'])
    assert.equal(await item(label).count(), 1, label + ' in the explorer menu');
  assert.match(await item('Rename...').locator('.fs-cm-key').textContent(), /F2/);
  await page.screenshot({ path: `${SHOTS}/context-menu-explorer.png` });
  await choose('Copy Path');
  assert.equal(await clipboard(), 'ctxproj/src/hello.py');
  await row('src/hello.py').click({ button: 'right' });
  await choose('Copy Relative Path');
  assert.equal(await clipboard(), 'src/hello.py');

  // Run: the file opens and runs in the native Python session.
  await row('src/hello.py').click({ button: 'right' });
  await choose('Run');
  // Python output lands in the console's Python session tab.
  await page.locator('.terminal-tab[data-runtime="python"]').click({ timeout: 90000 });
  await page.waitForFunction(() => /ran from the explorer menu/.test(document.querySelector('.terminal-transcript').textContent),
    null, { timeout: 90000 }).catch(async error => {
    console.error(await page.evaluate(() => [document.getElementById('resultStatus').textContent, FlowStudioApp.documents.active()?.path,
      document.querySelector('.terminal-transcript').textContent.slice(-1500)]));
    throw error;
  });
  await idle();

  // Rename through the menu renames the file on disk.
  await row('src/notes.md').click({ button: 'right' });
  await choose('Rename...');
  await page.locator('#explorer .ex-input').fill('renamed.md');
  await page.locator('#explorer .ex-input').press('Enter');
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[data-rel="src/renamed.md"]'));
  assert.ok((await opfs.list()).includes('src/renamed.md') && !(await opfs.list()).includes('src/notes.md'), 'renamed on disk');

  // Duplicate writes "name copy.ext" with the same bytes.
  await row('a.txt').click({ button: 'right' });
  await choose('Duplicate');
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[data-rel="a copy.txt"]'));
  assert.equal(await opfs.read('a copy.txt'), 'alpha\n');

  // Multi-select: Cmd/Ctrl+click two files, then one menu acts on both.
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await row('b.txt').click();
  await row('c.txt').click({ modifiers: [mod] });
  assert.equal(await page.locator('#explorer .ex-row.is-multi').count(), 2, 'two rows selected');
  await row('c.txt').click({ button: 'right' });
  assert.equal(await item('Delete 2 Items').count(), 1, 'the menu speaks for the selection');
  assert.equal(await item('Rename...').getAttribute('aria-disabled'), 'true', 'rename needs one item');
  await choose('Copy Paths');
  assert.equal(await clipboard(), 'ctxproj/b.txt\nctxproj/c.txt');
  await row('c.txt').click({ button: 'right' });
  await choose('Delete 2 Items');
  await page.waitForFunction(() => !document.querySelector('#explorer .ex-row[data-rel="b.txt"]') &&
    !document.querySelector('#explorer .ex-row[data-rel="c.txt"]'));
  const afterDelete = await opfs.list();
  assert.ok(!afterDelete.includes('b.txt') && !afterDelete.includes('c.txt'), 'both deleted on disk');

  // Find in Folder scopes the search view to the folder.
  await row('src').click({ button: 'right' });
  await choose('Find in Folder...');
  assert.equal(await page.locator('#projectInclude').inputValue(), 'src/**');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'projectSearch');
  await page.locator('#tab-files').click();

  // Keyboard: Shift+F10 opens the menu on the focused row, first item focused,
  // and Escape gives focus back to the tree.
  await row('a.txt').click();
  await page.locator('#explorer .ex-tree').focus();
  await page.keyboard.press('Shift+F10');
  assert.equal(await page.locator('.fs-cm').count(), 1, 'Shift+F10 opens the explorer menu');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'menuitem');
  // Measured together: the tree re-renders rows, so a held handle can go stale.
  const gap = await page.evaluate(() => {
    const focused = document.querySelector('#explorer .ex-row[aria-selected="true"]').getBoundingClientRect();
    return document.querySelector('.fs-cm').getBoundingClientRect().top - focused.bottom;
  });
  assert.ok(Math.abs(gap - 2) <= 1, 'keyboard menu sits under the focused row (gap ' + gap + ')');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.fs-cm').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('ex-tree')), true, 'focus returns to the tree');

  // Open to the Side opens a split editor beside the main one.
  await row('src/calc.py').click({ button: 'right' });
  await choose('Open to the Side');
  await page.waitForFunction(() => document.querySelector('#splitEditor .fs-split-name')?.textContent === 'ctxproj/src/calc.py');
  assert.equal(await page.evaluate(() => FlowStudioSplitEditor.editor().getValue()), 'x = 21\nprint(x * 2)\n');
  await page.locator('#splitEditorClose').click();
  assert.equal(await page.locator('#splitEditor').count(), 0);

  /* ==== 3. Editor tabs ================================================== */
  await row('src/calc.py').click();
  await page.waitForFunction(() => FlowStudioEditor.editor.getValue().startsWith('x = 21'));
  await row('src/renamed.md').click();
  await row('a.txt').click();
  await page.waitForFunction(() => FlowStudioApp.documents.list().length >= 5);
  const tab = name => page.locator('#docTabs .doc-tab', { has: page.locator('.doc-tab-name', { hasText: new RegExp('^' + name.replace('.', '\\.') + '$') }) });
  await tab('calc.py').click({ button: 'right' });
  for (const label of ['Close', 'Close Others', 'Close to the Right', 'Close Saved', 'Close All', 'Copy Path',
    'Reveal in Explorer', 'Split Right', 'Pin']) assert.equal(await item(label).count(), 1, label + ' in the tab menu');
  await choose('Copy Path');
  assert.equal(await clipboard(), 'ctxproj/src/calc.py');
  // Pin keeps a tab through Close Others.
  await tab('hello.py').click({ button: 'right' });
  await choose('Pin');
  assert.equal(await tab('hello.py').getAttribute('data-pinned'), 'true');
  await tab('calc.py').click({ button: 'right' });
  await choose('Close Others');
  await page.waitForFunction(() => FlowStudioApp.documents.list().length === 2);
  assert.deepEqual(await page.$$eval('#docTabs .doc-tab .doc-tab-name', nodes => nodes.map(node => node.textContent).sort()),
    ['calc.py', 'hello.py'], 'Close Others closed every unpinned tab but this one');
  // Reveal in Explorer selects the file in the tree.
  await tab('hello.py').click({ button: 'right' });
  await choose('Reveal in Explorer');
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[aria-selected="true"]')?.dataset.rel === 'src/hello.py');
  // Keyboard on a tab, then Split Right through type-ahead and Enter.
  await tab('calc.py').click();
  await tab('calc.py').focus();
  await page.keyboard.press('Shift+F10');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), process.platform === 'darwin' ? 'Close⌘W' : 'CloseCtrl+W');
  await page.keyboard.type('sp');
  assert.match(await page.evaluate(() => document.activeElement.textContent), /^Split Right/, 'type-ahead finds Split Right');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#splitEditor .fs-split-name')?.textContent === 'ctxproj/src/calc.py');
  await page.locator('#splitEditorClose').click();
  await tab('hello.py').click({ button: 'right' });
  await choose('Unpin');
  assert.equal(await tab('hello.py').getAttribute('data-pinned'), null);

  /* ==== 4. Editor (Monaco's own menu, extended) ========================= */
  await tab('calc.py').click();
  await page.waitForFunction(() => FlowStudioEditor.editor.getModel().getLanguageId() === 'python');
  const pointAt = (line, column) => page.evaluate(([line, column]) => {
    const editor = FlowStudioEditor.editor;
    const spot = editor.getScrolledVisiblePosition({ lineNumber: line, column });
    const box = editor.getDomNode().getBoundingClientRect();
    return { x: box.left + spot.left + 2, y: box.top + spot.top + spot.height / 2 };
  }, [line, column]);
  const monacoLabels = () => page.$$eval('.context-view .monaco-menu .action-label:not(.separator)', nodes => nodes.map(node => node.textContent));
  const monacoChoose = async label => {
    const entry = page.locator('.context-view .monaco-menu .action-item', { has: page.locator('.action-label', { hasText: new RegExp('^' + label + '$') }) });
    assert.equal(await entry.count(), 1, label + ' in the editor menu: ' + (await monacoLabels()).join(', '));
    // Monaco ignores a release that lands before its menu has settled, so
    // point at the item first, as a person does.
    await entry.hover();
    await page.waitForTimeout(250);
    await entry.click();
    await page.waitForFunction(() => !document.querySelector('.context-view .monaco-menu'));
  };
  // Run Line: right-click line 1 with no selection.
  await page.evaluate(() => { FlowStudioEditor.editor.setPosition({ lineNumber: 1, column: 1 }); FlowStudioEditor.editor.focus(); });
  let at = await pointAt(1, 3);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.waitForSelector('.context-view .monaco-menu');
  const editorMenu = await monacoLabels();
  for (const label of ['Run Line in Console', 'Go to Definition', 'Rename Symbol', 'Edit with Assistant', 'Add Breakpoint',
    'Cut', 'Copy', 'Paste', 'Command Palette'])
    assert.ok(editorMenu.includes(label), label + ' in the editor menu: ' + editorMenu.join(', '));
  assert.ok(editorMenu.includes('Find References') || editorMenu.includes('Go to References'), 'references in the editor menu');
  assert.ok(!editorMenu.includes('Check Flow'), 'Check Flow only for Flow buffers');
  const monacoStyle = await page.evaluate(() => {
    const entry = document.querySelector('.context-view .monaco-menu .action-menu-item');
    return [entry.getBoundingClientRect().height, getComputedStyle(entry.querySelector('.action-label')).fontSize,
      getComputedStyle(document.querySelector('.context-view .monaco-menu')).backgroundColor];
  });
  assert.deepEqual(monacoStyle, [28, '13px', 'rgb(35, 38, 44)'], 'Monaco menu matches the app menus');
  await page.screenshot({ path: `${SHOTS}/context-menu-editor.png` });
  await monacoChoose('Run Line in Console');
  await idle();
  // Run Selection: select line 2 and right-click inside the selection.
  await page.evaluate(() => {
    const editor = FlowStudioEditor.editor;
    editor.setSelection({ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 13 });
    editor.focus();
  });
  at = await pointAt(2, 4);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.waitForSelector('.context-view .monaco-menu');
  assert.ok((await monacoLabels()).includes('Explain with Assistant'), 'Explain needs a selection and is offered with one');
  await monacoChoose('Run Selection in Console');
  await page.waitForFunction(() => /\b42\b/.test(document.querySelector('.terminal-transcript').textContent), null, { timeout: 90000 });
  await idle();
  // Add Breakpoint, then the same menu offers Remove Breakpoint.
  await page.evaluate(() => { FlowStudioEditor.editor.setPosition({ lineNumber: 2, column: 1 }); FlowStudioEditor.editor.focus(); });
  at = await pointAt(2, 3);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.waitForSelector('.context-view .monaco-menu');
  await monacoChoose('Add Breakpoint');
  await page.waitForFunction(() => document.querySelector('#monacoHost .dbg-bp'));
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.waitForSelector('.context-view .monaco-menu');
  await monacoChoose('Remove Breakpoint');
  await page.waitForFunction(() => !document.querySelector('#monacoHost .dbg-bp'));
  // Shift+F10 in the editor opens Monaco's menu from the keyboard.
  await page.evaluate(() => FlowStudioEditor.editor.focus());
  await page.keyboard.press('Shift+F10');
  await page.waitForSelector('.context-view .monaco-menu');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.context-view .monaco-menu'));

  /* ==== 5. Console ====================================================== */
  const output42 = page.locator('#console .term-output', { hasText: /^42\s*$/ }).last();
  await output42.click({ button: 'right' });
  for (const label of ['Copy', 'Copy Output of This Run', 'Copy Command', 'Run Again', 'Search', 'Clear'])
    assert.equal(await item(label).count(), 1, label + ' in the console menu');
  await page.screenshot({ path: `${SHOTS}/context-menu-console.png` });
  await choose('Copy Output of This Run');
  assert.equal(await clipboard(), '42\n');
  await output42.click({ button: 'right' });
  await choose('Copy Command');
  assert.equal(await clipboard(), 'print(x * 2)');
  const runs = () => page.locator('#console .term-run').count();
  const before = await runs();
  await output42.click({ button: 'right' });
  await choose('Run Again');
  await page.waitForFunction(count => document.querySelectorAll('#console .term-run').length === count + 1 &&
    document.querySelectorAll('#console .term-output').length >= 2, before, { timeout: 90000 });
  await idle();
  assert.equal(await page.locator('#console .term-output', { hasText: /^42\s*$/ }).count(), 2, 'the run ran again');
  // An error line offers Fix with Assistant.
  await page.evaluate(() => FlowStudioConsoleSubmit('python', 'undefined_name_zz + 1'));
  await idle();
  const errorLine = page.locator('#console .term-msg.term-error').last();
  await errorLine.waitFor();
  await errorLine.click({ button: 'right' });
  assert.equal(await item('Fix with Assistant').count(), 1, 'error lines offer Fix with Assistant');
  await choose('Fix with Assistant');
  await page.waitForFunction(() => document.getElementById('rpTab-assistant').getAttribute('aria-selected') === 'true');
  await page.waitForFunction(() => /NameError|undefined_name_zz/.test(document.getElementById('assistantRoot').textContent +
    (document.querySelector('#assistantRoot textarea')?.value || '')), null, { timeout: 15000 });
  await page.locator('#rpTab-environment').click();
  // Search and Clear.
  await page.locator('#console .term-run').last().click({ button: 'right' });
  await choose('Search');
  assert.equal(await page.locator('#terminalSearchInput').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'terminalSearchInput');
  await page.keyboard.press('Escape');
  // Keyboard: focus the transcript, Shift+F10, type-ahead, Escape returns focus.
  await page.locator('.terminal-transcript').focus();
  await page.keyboard.press('Shift+F10');
  assert.equal(await page.locator('.fs-cm').count(), 1, 'Shift+F10 opens the console menu (focus: ' +
    await page.evaluate(() => document.activeElement.className) + ')');
  await page.keyboard.type('r');
  assert.equal(await page.evaluate(() => document.activeElement.querySelector('.fs-cm-label').textContent), 'Run Again');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('terminal-transcript')), true,
    'Escape returns focus to the transcript');

  /* ==== 6. Environment ================================================== */
  await page.locator('#refreshPythonEnvironment').click();
  const variable = page.locator('#pythonEnvironment tr', { has: page.locator('td', { hasText: /^x$/ }) });
  await variable.waitFor({ timeout: 30000 });
  // Let the refresh land: the pane redraws its table when the reply comes.
  await page.waitForFunction(() => document.querySelector('#pythonEnvironment caption')?.textContent === 'Native Python variables');
  // The shared Python session may hold many variables; bring the row into
  // view first, since scrolling the pane under an open menu closes it.
  const rightClickVariable = async () => {
    await variable.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await variable.click({ button: 'right' });
  };
  await rightClickVariable();
  for (const label of ['View Data', 'Copy Value', 'Copy Name', 'Remove Variable', 'Refresh'])
    assert.equal(await item(label).count(), 1, label + ' in the variable menu');
  assert.equal(await item('View Data').getAttribute('aria-disabled'), 'true', 'an int has no data view');
  await choose('Copy Name');
  assert.equal(await clipboard(), 'x');
  await rightClickVariable();
  await choose('Copy Value');
  await page.waitForFunction(async () => (await navigator.clipboard.readText()) === '21');
  await rightClickVariable();
  await choose('Remove Variable');
  await page.waitForFunction(() => ![...document.querySelectorAll('#pythonEnvironment td')].some(cell => cell.textContent === 'x'),
    null, { timeout: 30000 });
  const gone = await page.evaluate(async () => (await (await fetch('/api/run/python', { method: 'POST', body: 'print("x" in globals())',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-FlowStudio-Intent': 'run' } })).text()).trim());
  assert.equal(gone, 'False', 'the variable is gone from the native Python session');

  // Console Clear empties the transcript.
  await page.locator('#console .term-run').last().click({ button: 'right' });
  await choose('Clear');
  assert.equal(await page.locator('#console .term-run').count(), 0);

  /* ==== 7. Plots ======================================================== */
  const SCRIPT = [
    'import flowstudio { plot, scatter }',
    'let mut xs: array<f64, 20> = [0.0; 20]',
    'let mut ys: array<f64, 20> = [0.0; 20]',
    'for i in 0..20 {',
    '    xs[i] = i as f64 * 0.5',
    '    ys[i] = xs[i] * xs[i]',
    '}',
    'plot(xs, ys)',
    'scatter(xs, ys)'
  ].join('\n');
  await page.evaluate(code => FlowStudioConsoleSubmit('flow', code), SCRIPT);
  await page.waitForFunction(() => FlowStudioPlotPane.instance.size() >= 2, null, { timeout: 120000 })
    .catch(async error => { console.error((await transcript()).slice(-2000)); throw error; });
  await idle();
  // A Flow plot brings the Plots view forward (clicking it again would fold the sidebar).
  if (await page.locator('#tab-plots').getAttribute('aria-selected') !== 'true') await page.locator('#tab-plots').click();
  const stage = page.locator('#plotStage');
  await stage.click({ button: 'right' });
  for (const label of ['Copy Image', 'Save as PNG...', 'Save as SVG...', 'Open in New Window', 'Previous Plot', 'Next Plot',
    'Delete Plot', 'Clear All Plots']) assert.equal(await item(label).count(), 1, label + ' in the plot menu');
  assert.equal(await item('Next Plot').getAttribute('aria-disabled'), 'true', 'the newest plot has no next');
  await choose('Copy Image');
  await page.waitForFunction(async () => {
    const items = await navigator.clipboard.read();
    return items.some(entry => entry.types.includes('image/png'));
  });
  await stage.click({ button: 'right' });
  const download = page.waitForEvent('download');
  await choose('Save as SVG...');
  assert.match((await download).suggestedFilename(), /^flowstudio-flow-plot-\d+\.svg$/);
  await stage.click({ button: 'right' });
  const popup = context.waitForEvent('page');
  await choose('Open in New Window');
  const opened = await popup;
  assert.match(opened.url(), /^blob:/, 'the plot opens in its own window');
  await opened.close();
  const plotsBefore = await page.evaluate(() => FlowStudioPlotPane.instance.size());
  await stage.click({ button: 'right' });
  await choose('Delete Plot');
  assert.equal(await page.evaluate(() => FlowStudioPlotPane.instance.size()), plotsBefore - 1, 'the plot was deleted');

  /* ==== 8. Terminal ===================================================== */
  await page.locator('#dockView-terminal').click();
  await page.waitForFunction(() => FlowStudioTerminal.active && FlowStudioTerminal.active.id);
  const screen = () => page.evaluate(() => {
    const buffer = FlowStudioTerminal.active.term.buffer.active;
    let text = '';
    for (let i = 0; i < buffer.length; i++) text += buffer.getLine(i).translateToString(true) + '\n';
    return text;
  });
  await page.locator('#shellTerminal .xterm').click();
  await page.keyboard.type('echo ctx_marker_$((40+2))');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const buffer = FlowStudioTerminal.active.term.buffer.active;
    for (let i = 0; i < buffer.length; i++) if (/^ctx_marker_42/.test(buffer.getLine(i).translateToString(true))) return true;
    return false;
  }, null, { timeout: 20000 });
  await page.locator('#shellTerminal .xterm-screen').click({ button: 'right' });
  for (const label of ['Copy', 'Paste', 'Select All', 'Clear', 'New Terminal', 'Kill Terminal'])
    assert.equal(await item(label).count(), 1, label + ' in the terminal menu');
  await choose('Select All');
  await page.locator('#shellTerminal .xterm-screen').click({ button: 'right' });
  await choose('Copy');
  assert.match(await clipboard(), /ctx_marker_42/, 'Copy takes the terminal selection');
  await setClipboard('echo pasted_$((7*6))');
  await page.locator('#shellTerminal .xterm-screen').click({ button: 'right' });
  await choose('Paste');
  await page.waitForFunction(() => {
    const buffer = FlowStudioTerminal.active.term.buffer.active;
    for (let i = 0; i < buffer.length; i++) if (/echo pasted_/.test(buffer.getLine(i).translateToString(true))) return true;
    return false;
  }, null, { timeout: 20000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const buffer = FlowStudioTerminal.active.term.buffer.active;
    for (let i = 0; i < buffer.length; i++) if (/^pasted_42/.test(buffer.getLine(i).translateToString(true))) return true;
    return false;
  }, null, { timeout: 20000 });
  await page.locator('#shellTerminal .xterm-screen').click({ button: 'right' });
  await choose('Clear');
  assert.doesNotMatch(await screen(), /ctx_marker_42/, 'Clear empties the scrollback');
  const shells = () => page.evaluate(() => FlowStudioTerminal.instances.length);
  const count = await shells();
  await page.locator('#shellTerminal .xterm-screen').click({ button: 'right' });
  await choose('New Terminal');
  await page.waitForFunction(n => FlowStudioTerminal.instances.length === n + 1 && FlowStudioTerminal.active.id, count);
  await page.locator('#shellTerminal .xt-instance:not([hidden]) .xterm-screen').click({ button: 'right' });
  await choose('Kill Terminal');
  await page.waitForFunction(n => FlowStudioTerminal.instances.length === n, count);

  /* ==== 9. Phone width ================================================== */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#docTabs .doc-tab').first().click({ button: 'right', position: { x: 10, y: 10 } });
  const phone = await menu().boundingBox();
  assert.ok(await inViewport(phone), 'menu inside a 390px window: ' + JSON.stringify(phone));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
  await page.screenshot({ path: `${SHOTS}/context-menu-390.png` });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#docTabs .doc-tab').first().click({ button: 'right' });
  await page.screenshot({ path: `${SHOTS}/context-menu-tabs.png` });
  await page.keyboard.press('Escape');

  assert.deepEqual(errors, [], 'no unexpected console errors');
  console.log('PASS native_context_menus_ui: explorer rename, duplicate, multi-select delete, copy paths, run, find in folder, ' +
    'open to the side; tabs close others, pin, reveal, split right; Monaco run line and selection, breakpoints, styled menu; ' +
    'console copy output, copy command, run again, fix with assistant, search, clear; environment copy name and value, remove; ' +
    'plots copy image, save SVG, new window, delete; terminal select all, copy, paste, clear, new, kill; keyboard opening, ' +
    'type-ahead, focus return, edge flip, open time, reduced motion, 1440x900 at 2x and 390x844');
} finally {
  await browser.close();
}
