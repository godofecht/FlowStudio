/* Real Chromium acceptance for the workspace explorer against the running
 * native server: node tests/native_explorer_ui.mjs
 *
 * The folder picker is replaced with a directory in the browser's
 * origin-private file system (OPFS). OPFS handles are real
 * FileSystemDirectoryHandle objects, so every create, rename, move and
 * delete goes through the same File System Access calls a user folder does. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const URL = process.env.FLOWSTUDIO_URL || 'http://127.0.0.1:8751/';
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push('pageerror: ' + error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on('dialog', dialog => dialog.accept());
};
const pickerScript = () => {
  globalThis.showDirectoryPicker = async () => {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle('proj', { create: true });
  };
};

/* Helpers that read the real OPFS state from inside the page. */
const opfs = {
  list: page => page.evaluate(async () => {
    const out = [];
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('proj');
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
  read: (page, path) => page.evaluate(async path => {
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('proj');
    const parts = path.split('/');
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return (await (await dir.getFileHandle(parts.at(-1))).getFile()).text();
  }, path)
};
const rows = page => page.$$eval('#explorer .ex-row[data-rel]', nodes => nodes.map(node => node.dataset.rel));
const row = (page, rel) => page.locator(`#explorer .ex-row[data-rel="${rel}"]`);
const status = page => page.locator('#resultStatus').textContent();

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(pickerScript);
  const page = await context.newPage();
  watch(page);
  await page.goto(URL);
  await page.waitForFunction(() => globalThis.FlowStudioEditor?.editor && globalThis.FlowStudioWorkspaceExplorer);

  // Seed a fresh project folder.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry('proj', { recursive: true }); } catch (_) { /* first run */ }
    const proj = await root.getDirectoryHandle('proj', { create: true });
    const write = async (dir, name, text) => {
      const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writer.write(text); await writer.close();
    };
    const src = await proj.getDirectoryHandle('src', { create: true });
    const data = await proj.getDirectoryHandle('data', { create: true });
    await proj.getDirectoryHandle('.git', { create: true });
    await write(src, 'main.flow', 'function main() -> i32 {\n    println("hi")\n    return 0\n}\n');
    await write(src, 'util.py', 'print("util")\n');
    await write(data, 'rows.csv', 'a,b\n1,2\n');
    await write(proj, 'README.md', '# Project\n');
    await write(proj, 'photo.png', 'not really a png');
  });

  // ---- empty state, then Open folder -----------------------------------
  assert.equal(await page.locator('#explorer .ex-empty').isVisible(), true, 'empty state before a folder opens');
  await page.locator('#explorer .ex-primary').click();
  await page.waitForFunction(() => document.querySelectorAll('#explorer .ex-row[data-rel]').length >= 4);
  assert.deepEqual(await rows(page), ['data', 'src', 'photo.png', 'README.md'],
    'folders first, natural order, .git hidden');
  assert.equal(await page.locator('#explorer .ex-title-text').textContent(), 'proj');
  assert.match(await row(page, 'photo.png').getAttribute('class'), /unsupported/, 'binary types are dimmed');

  // ---- expand a folder and open a file ---------------------------------
  await row(page, 'src').click();
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[data-rel="src/util.py"]'));
  assert.equal(await row(page, 'src').getAttribute('aria-expanded'), 'true');
  await row(page, 'src/main.flow').click();
  await page.waitForFunction(() => FlowStudioEditor.editor.getValue().includes('println("hi")'));
  assert.match(await row(page, 'src/main.flow').getAttribute('class'), /is-active/, 'active file is marked');
  assert.match(await page.locator('#fileLabel').textContent(), /proj\/src\/main\.flow/);
  await mkdir('build/ui', { recursive: true });
  await page.screenshot({ path: 'build/ui/explorer.png' });

  // ---- keyboard: arrows, collapse, type-ahead ---------------------------
  await page.locator('#explorer .ex-tree').focus();
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#explorer .ex-row[aria-selected="true"]').getAttribute('data-rel'), 'data');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');                     // collapse src
  assert.equal(await row(page, 'src').getAttribute('aria-expanded'), 'false');
  await page.keyboard.press('ArrowRight');                    // expand again
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[data-rel="src"]').getAttribute('aria-expanded') === 'true');
  await page.keyboard.type('READ');
  assert.equal(await page.locator('#explorer .ex-row[aria-selected="true"]').getAttribute('data-rel'), 'README.md',
    'type-ahead selects by prefix');
  assert.equal(await page.locator('#explorer .ex-typeahead').isVisible(), true);

  // ---- inline create: invalid name is refused, nested path is created --
  await row(page, 'src').click({ button: 'right' });
  await page.locator('.ex-menu .ex-menu-item', { hasText: 'New file...' }).click();
  const input = page.locator('#explorer .ex-input');
  await input.fill('bad?.flow');
  assert.match(await page.locator('#explorer .ex-input-error').textContent(), /characters/);
  await input.press('Enter');
  assert.equal(await input.isVisible(), true, 'invalid name keeps the field open');
  await input.fill('notes.exe');
  assert.match(await page.locator('#explorer .ex-input-error').textContent(), /supported source extension/);
  await input.fill('lib/helper.flow');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[data-rel="src/lib/helper.flow"]'));
  assert.ok((await opfs.list(page)).includes('src/lib/helper.flow'), 'nested file exists on disk');
  assert.match(await page.locator('#fileLabel').textContent(), /src\/lib\/helper\.flow/, 'new file opens');

  // ---- F2 rename keeps the open tab on the new path -------------------
  await row(page, 'src/util.py').click();
  await page.waitForFunction(() => FlowStudioEditor.editor.getValue().includes('print("util")'));
  await page.locator('#explorer .ex-tree').focus();
  await page.keyboard.press('F2');
  const rename = page.locator('#explorer .ex-input');
  assert.equal(await rename.inputValue(), 'util.py');
  assert.deepEqual(await rename.evaluate(node => [node.selectionStart, node.selectionEnd]), [0, 4],
    'rename selects the name without its extension');
  await rename.fill('tools.py');
  await rename.press('Enter');
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[data-rel="src/tools.py"]'));
  const afterRename = await opfs.list(page);
  assert.ok(afterRename.includes('src/tools.py') && !afterRename.includes('src/util.py'));
  assert.equal(await opfs.read(page, 'src/tools.py'), 'print("util")\n');
  assert.match(await page.locator('#fileLabel').textContent(), /proj\/src\/tools\.py/, 'tab follows the rename');
  const tabTitles = await page.$$eval('#docTabs [role="tab"]', tabs => tabs.map(tab => tab.title));
  assert.ok(tabTitles.includes('proj/src/tools.py') && !tabTitles.includes('proj/src/util.py'));

  // ---- a modified file shows its mark and refuses rename ---------------
  await page.evaluate(() => {
    FlowStudioEditor.editor.setValue('print("changed")\n');
  });
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[data-rel="src/tools.py"]')?.classList.contains('is-dirty'));
  await page.locator('#explorer .ex-tree').focus();
  await page.keyboard.press('F2');
  await page.locator('#explorer .ex-input').fill('other.py');
  await page.locator('#explorer .ex-input').press('Enter');
  await page.waitForFunction(() => /Save or close/.test(document.getElementById('resultStatus').textContent));
  assert.ok((await opfs.list(page)).includes('src/tools.py'), 'dirty file was not renamed');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await page.waitForFunction(() => !document.querySelector('#explorer .ex-row[data-rel="src/tools.py"]').classList.contains('is-dirty'));
  assert.equal(await opfs.read(page, 'src/tools.py'), 'print("changed")\n', 'save writes through the moved handle');

  // ---- drag a file into another folder -----------------------------------
  await row(page, 'data').click();
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[data-rel="data/rows.csv"]'));
  await row(page, 'data/rows.csv').dragTo(row(page, 'src'));
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[data-rel="src/rows.csv"]'));
  const afterMove = await opfs.list(page);
  assert.ok(afterMove.includes('src/rows.csv') && !afterMove.includes('data/rows.csv'));
  assert.equal(await opfs.read(page, 'src/rows.csv'), 'a,b\n1,2\n');

  // ---- folder rename carries open tabs inside it --------------------------
  await row(page, 'src/lib/helper.flow').click();
  await page.waitForFunction(() => /helper\.flow/.test(document.getElementById('fileLabel').textContent));
  assert.deepEqual(await page.$$eval('#breadcrumbPath > *', nodes => nodes.filter(n => !n.classList.contains('crumb-sep')).map(n => n.textContent)),
    ['proj', 'src', 'lib', 'helper.flow'], 'breadcrumb shows the real path');
  await row(page, 'src/lib').click({ button: 'right' });
  await page.locator('.ex-menu .ex-menu-item', { hasText: 'Rename...' }).click();
  await page.locator('#explorer .ex-input').fill('core');
  await page.locator('#explorer .ex-input').press('Enter');
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[data-rel="src/core/helper.flow"]'));
  const listing = await opfs.list(page);
  assert.ok(listing.includes('src/core/helper.flow') && !listing.includes('src/lib/'), 'folder renamed on disk');
  assert.match(await page.locator('#fileLabel').textContent(), /proj\/src\/core\/helper\.flow/, 'open tab follows the folder');
  await page.evaluate(() => FlowStudioEditor.editor.setValue('function main() -> i32 { return 1 }\n'));
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('resultStatus').textContent));
  assert.equal(await opfs.read(page, 'src/core/helper.flow'), 'function main() -> i32 { return 1 }\n',
    'save after a folder rename writes to the new location');

  // ---- drag a folder into another folder ---------------------------------
  await row(page, 'data').dragTo(row(page, 'src'));
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[data-rel="src/data"]'));
  assert.ok((await opfs.list(page)).includes('src/data/') && !(await opfs.list(page)).includes('data/'));
  // Breadcrumb folder buttons reveal the folder in the explorer.
  await page.locator('#breadcrumbPath button', { hasText: 'core' }).click();
  assert.equal(await page.locator('#explorer .ex-row[aria-selected="true"]').getAttribute('data-rel'), 'src/core');

  // ---- context menu delete with confirmation ----------------------------
  await row(page, 'README.md').click({ button: 'right' });
  const menu = page.locator('.ex-menu');
  assert.equal(await menu.getAttribute('role'), 'menu');
  for (const label of ['Copy path', 'Copy relative path', 'Rename...', 'Delete'])
    assert.equal(await menu.locator('.ex-menu-item', { hasText: label }).count(), 1, label + ' in context menu');
  await page.keyboard.press('Escape');
  assert.equal(await menu.count(), 0, 'Escape closes the context menu');
  await row(page, 'README.md').click({ button: 'right' });
  await page.locator('.ex-menu .ex-menu-item', { hasText: 'Delete' }).click();
  await page.waitForFunction(() => !document.querySelector('#explorer .ex-row[data-rel="README.md"]'));
  assert.ok(!(await opfs.list(page)).includes('README.md'), 'deleted on disk');

  // ---- search view searches the explorer's folder ------------------------
  await page.locator('#tab-search').click();
  assert.equal(await page.locator('#sidebarTitle').textContent(), 'Search');
  await page.locator('#projectSearch').fill('changed');           // live: no button press
  await page.waitForFunction(() => document.getElementById('searchSummary').textContent === '1 result in 1 file');
  assert.match(await page.locator('#searchResults .sr-file').getAttribute('data-file'), /src\/tools\.py$/);
  assert.match(await page.locator('#searchResults .sr-match').getAttribute('aria-label'), /src\/tools\.py:1:8/);
  assert.equal(await page.locator('#searchResults .sr-match mark').textContent(), 'changed');
  await page.locator('#projectInclude').fill('*.flow');               // include filter narrows live
  await page.waitForFunction(() => /^0 results/.test(document.getElementById('searchSummary').textContent));
  await page.locator('#projectInclude').fill('src');
  await page.waitForFunction(() => document.getElementById('searchSummary').textContent === '1 result in 1 file');
  await page.locator('#projectSearch').press('ArrowDown');            // keyboard into results
  await page.keyboard.press('ArrowLeft');                            // fold the file
  assert.equal(await page.locator('#searchResults .sr-match').isHidden(), true);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');                                // open the match
  await page.waitForFunction(() => FlowStudioApp.documents.active().name === 'tools.py');
  await page.locator('#projectInclude').fill('');

  // ---- Search Everywhere: Ctrl+P finds files in the folder ---------------
  await page.keyboard.press('Control+p');
  await page.waitForFunction(() => document.getElementById('searchEverywhere').open);
  assert.equal(await page.locator('#seTabs .se-tab.active').innerText(), 'Files');
  await page.locator('#seQuery').fill('tool');
  await page.waitForFunction(() => document.querySelector('#seGroups .se-row[data-kind="file"]'));
  assert.equal(await page.locator('#seGroups .se-row[data-kind="file"] mark').first().textContent(), 'tool');
  await page.keyboard.press('Escape');

  // ---- typing quotes never opens Search Everywhere -----------------------
  await page.locator('#terminalRoot textarea, #terminalRoot input, #terminalRoot [contenteditable]').first().click().catch(() => {});
  await page.keyboard.type('"a" "b" ""', { delay: 40 });
  assert.equal(await page.evaluate(() => document.getElementById('searchEverywhere').open), false);
  await page.locator('#tab-files').click();
  assert.equal(await page.locator('#sidebarTitle').textContent(), 'Explorer');

  // ---- reload: recent folder and expansion state come back --------------
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#explorer .ex-recent-item'));
  assert.match(await page.locator('#explorer .ex-recent-item').first().textContent(), /proj/);
  await page.locator('#explorer .ex-recent-item').first().click();
  await page.waitForFunction(() => document.querySelector('#explorer .ex-row[data-rel="src/tools.py"]'));
  assert.equal(await row(page, 'src').getAttribute('aria-expanded'), 'true', 'expanded folders persist');
  await page.waitForFunction(() => /Reopened \d+ editor/.test(document.getElementById('resultStatus').textContent));
  const reopened = await page.$$eval('#docTabs [role="tab"]', tabs => tabs.map(tab => tab.title));
  for (const path of ['proj/src/main.flow', 'proj/src/tools.py', 'proj/src/core/helper.flow'])
    assert.ok(reopened.includes(path), path + ' reopened after reload');
  assert.ok(!reopened.includes('proj/README.md'), 'deleted file is not reopened');

  // ---- run overflow ------------------------------------------------------
  await page.locator('#runMore').click();
  assert.equal(await page.locator('#runMorePopup').isVisible(), true);
  for (const id of ['runCell', 'runProject', 'runMathFlow', 'resetR', 'resetPython'])
    assert.equal(await page.locator('#' + id).isVisible(), true, id + ' visible in overflow');
  await page.locator('#autoCheckFlow').check();
  assert.equal(await page.locator('#runMorePopup').isVisible(), true, 'checkbox keeps the menu open');
  await page.locator('#autoCheckFlow').uncheck();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#runMorePopup').isVisible(), false);

  // ---- layout at every desktop breakpoint ---------------------------------
  for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    const layout = await page.evaluate(() => {
      const top = document.querySelector('.topbar');
      const bar = document.querySelector('.activity-bar').getBoundingClientRect();
      const view = document.querySelector('.sidebar-views').getBoundingClientRect();
      return { pageOverflow: document.documentElement.scrollWidth - innerWidth,
        topOverflow: top.scrollWidth - top.clientWidth, topHeight: top.getBoundingClientRect().height,
        overlap: bar.right - view.left };
    });
    assert.ok(layout.pageOverflow <= 0, width + 'px: no horizontal page scroll (' + layout.pageOverflow + ')');
    assert.ok(layout.topOverflow <= 0, width + 'px: title bar fits on one row (' + layout.topOverflow + ')');
    assert.ok(layout.topHeight <= 60, width + 'px: title bar height ' + layout.topHeight);
    assert.ok(layout.overlap <= 1, width + 'px: activity bar does not overlap the view');
    await page.screenshot({ path: `build/ui/explorer-${width}.png` });
  }

  await page.waitForTimeout(300);                       // let deferred callbacks run
  assert.deepEqual(errors, [], 'no runtime errors');
  console.log('PASS: explorer open, expand, keyboard, type-ahead, create, rename, dirty guard, save, ' +
    'drag move, folder rename with open tab, folder drag, breadcrumb, delete, search, recent reopen with editors, run overflow, layout');
} finally {
  await browser.close();
}
