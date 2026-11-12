// Integrated terminal: xterm.js on a real pty running the login shell
// (src/pty_session.c). VS Code panel layout: the dock header switches between
// Terminal and the language Console; terminal instances list on the right.
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

const THEME = {
  background: '#141619', foreground: '#d7dce2', cursor: '#9cc6ae', cursorAccent: '#141619',
  selectionBackground: '#3a5446aa', black: '#1c1f24', red: '#e7867c', green: '#9cc6ae',
  yellow: '#d8b58b', blue: '#8fb4e8', magenta: '#c5a3e6', cyan: '#86c7c4', white: '#d7dce2',
  brightBlack: '#5c6470', brightRed: '#f0a097', brightGreen: '#b7dcc5', brightYellow: '#e9cca6',
  brightBlue: '#abc8f0', brightMagenta: '#d6bdf0', brightCyan: '#a5dcd9', brightWhite: '#f3f5f7'
};
const POLL_FAST = 16, POLL_IDLE = 180, POLL_HIDDEN = 1000;

function api(op, body) {
  return fetch('/api/pty/' + op, {
    method: 'POST', body,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-FlowStudio-Intent': 'run' }
  });
}

class ShellInstance {
  constructor(panel, ordinal) {
    this.panel = panel;
    this.ordinal = ordinal;
    this.name = 'shell';
    this.id = null;
    this.exited = false;
    this.queue = '';
    this.writing = false;
    this.lastActivity = Date.now();
    this.host = document.createElement('div');
    this.host.className = 'xt-instance';
    this.host.hidden = true;
    panel.surface.append(this.host);
    this.term = new Terminal({
      theme: THEME, cursorBlink: true, cursorStyle: 'bar', allowProposedApi: false,
      fontFamily: '"SF Mono", Menlo, "JetBrains Mono", Consolas, "Liberation Mono", monospace',
      fontSize: 12.5, lineHeight: 1.2, scrollback: 5000, macOptionIsMeta: true,
      drawBoldTextInBrightColors: false
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new WebLinksAddon((event, uri) => window.open(uri, '_blank', 'noopener')));
    // On macOS, Cmd shortcuts belong to the IDE; Ctrl keys go to the shell.
    this.term.attachCustomKeyEventHandler(event => !(event.metaKey && !event.ctrlKey &&
      !['c', 'v', 'a'].includes((event.key || '').toLowerCase())));
    this.term.open(this.host);
    this.term.onData(data => this.send(data));
    this.term.onBinary(data => this.send(data));
    this.term.onResize(({ cols, rows }) => { if (this.id) api('resize', `${this.id} ${cols} ${rows}`).catch(() => {}); });
    this.term.onTitleChange(title => { this.title = title; panel.renderList(); });
  }
  async start() {
    this.fitNow();
    const { cols, rows } = this.term;
    const response = await api('open', `${cols} ${rows}`);
    const text = await response.text();
    if (!response.ok) {
      this.exited = true;
      this.term.write('\x1b[31m' + (text || 'Unable to start a shell.') + '\x1b[0m\r\n');
      this.panel.renderList();
      return;
    }
    this.id = text.trim();
    // A fit that landed while the shell was opening had no session to resize.
    this.fitNow();
    if (this.term.cols !== cols || this.term.rows !== rows)
      api('resize', `${this.id} ${this.term.cols} ${this.term.rows}`).catch(() => {});
    this.poll();
  }
  label() {
    const base = this.title ? this.title.split(/[\s:]/)[0].replace(/^.*\//, '') : 'zsh';
    return (base || 'shell') + (this.ordinal > 1 ? ' ' + this.ordinal : '');
  }
  fitNow() {
    if (this.host.hidden || !this.host.offsetParent) return;
    try { this.fit.fit(); } catch (_) { /* hidden or zero-size */ }
  }
  send(data) {
    if (this.exited || !this.id) return;
    this.queue += data;
    this.lastActivity = Date.now();
    if (!this.writing) this.flush();
  }
  async flush() {
    this.writing = true;
    while (this.queue && !this.exited) {
      const chunk = this.queue.slice(0, 60000);
      this.queue = this.queue.slice(chunk.length);
      try { await api('write', this.id + '\n' + chunk); } catch (_) { break; }
    }
    this.writing = false;
    this.schedule(POLL_FAST);
  }
  schedule(delay) {
    clearTimeout(this.timer);
    if (this.exited) return;
    this.timer = setTimeout(() => this.poll(), delay);
  }
  async poll() {
    if (this.exited || !this.id) return;
    if (this.polling) return;
    this.polling = true;
    let response;
    try { response = await api('read', this.id); }
    catch (_) { this.polling = false; this.schedule(POLL_HIDDEN); return; }
    const text = await response.text();
    this.polling = false;
    if (text) { this.term.write(text); this.lastActivity = Date.now(); }
    if (response.status === 410 || response.status === 404) {
      this.exited = true;
      this.term.write('\r\n\x1b[2m[process exited. Press any key to close this terminal]\x1b[0m');
      const off = this.term.onKey(() => { off.dispose(); this.panel.kill(this); });
      this.panel.renderList();
      return;
    }
    const quiet = Date.now() - this.lastActivity;
    const hidden = document.hidden || this.panel.root.hidden || this.host.hidden;
    this.schedule(hidden ? POLL_HIDDEN : quiet < 1500 ? POLL_FAST : POLL_IDLE);
  }
  dispose() {
    this.exited = true;
    clearTimeout(this.timer);
    if (this.id) api('close', this.id).catch(() => {});
    this.term.dispose();
    this.host.remove();
  }
}

export function mountTerminalPanel() {
  const dock = document.getElementById('consoleDock');
  const consoleRoot = document.getElementById('terminalRoot');
  if (!dock || !consoleRoot) return null;
  const heading = dock.querySelector('h2');

  const root = document.createElement('div');
  root.className = 'xt-panel';
  root.id = 'shellTerminal';
  const surface = document.createElement('div');
  surface.className = 'xt-surface';
  root.append(surface);
  consoleRoot.before(root);

  // Header: view tabs left, terminal instances and actions right.
  const views = document.createElement('div');
  views.className = 'dock-views';
  views.setAttribute('role', 'tablist');
  views.setAttribute('aria-label', 'Panel views');
  const makeView = (key, label) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'dock-view';
    tab.id = 'dockView-' + key;
    tab.dataset.view = key;
    tab.setAttribute('role', 'tab');
    tab.textContent = label;
    tab.addEventListener('click', () => panel.show(key));
    views.append(tab);
    return tab;
  };
  const terminalTab = makeView('terminal', 'Terminal');
  const consoleTab = makeView('console', 'Console');
  const actions = document.createElement('div');
  actions.className = 'xt-actions';
  const list = document.createElement('div');
  list.className = 'xt-list';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Terminals');
  const icon = d => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const button = (id, title, d, onClick) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.id = id;
    node.className = 'xt-action';
    node.title = title;
    node.setAttribute('aria-label', title);
    node.innerHTML = icon(d);
    node.addEventListener('click', onClick);
    return node;
  };
  const addButton = button('terminalAdd', 'New terminal (Ctrl+Shift+`)', '<path d="M8 3v10M3 8h10"/>', () => panel.create());
  const killButton = button('terminalKill', 'Kill terminal', '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>', () => panel.active && panel.kill(panel.active));
  actions.append(list, addButton, killButton);

  const title = heading.querySelector('.dock-title');
  title.replaceChildren(views);
  const clear = heading.querySelector('#clear');
  heading.insertBefore(actions, clear);

  const panel = {
    root, surface, instances: [], active: null, view: 'terminal', counter: 0,
    show(view) {
      this.view = view;
      const terminal = view === 'terminal';
      root.hidden = !terminal;
      consoleRoot.hidden = terminal;
      actions.hidden = !terminal;
      clear.hidden = terminal;
      terminalTab.setAttribute('aria-selected', String(terminal));
      consoleTab.setAttribute('aria-selected', String(!terminal));
      try { localStorage.setItem('flowstudio.dock.view', view); } catch (_) {}
      if (terminal) {
        if (!this.instances.length) this.create();
        else this.select(this.active || this.instances[0]);
      }
    },
    create() {
      const instance = new ShellInstance(this, ++this.counter);
      this.instances.push(instance);
      this.select(instance);
      instance.start();
      return instance;
    },
    select(instance) {
      this.active = instance;
      for (const item of this.instances) item.host.hidden = item !== instance;
      this.renderList();
      requestAnimationFrame(() => { instance.fitNow(); instance.term.focus(); });
    },
    kill(instance) {
      const index = this.instances.indexOf(instance);
      if (index < 0) return;
      this.instances.splice(index, 1);
      instance.dispose();
      if (this.active === instance) this.active = null;
      if (this.instances.length) this.select(this.instances[Math.max(0, index - 1)]);
      else this.renderList();
    },
    renderList() {
      list.replaceChildren();
      if (this.instances.length < 2) { list.hidden = true; return; }
      list.hidden = false;
      for (const instance of this.instances) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'xt-tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(instance === this.active));
        tab.textContent = instance.label() + (instance.exited ? ' (exited)' : '');
        tab.addEventListener('click', () => this.select(instance));
        list.append(tab);
      }
    },
    fit() { if (this.active && !root.hidden) this.active.fitNow(); },
    focus() { if (this.active) this.active.term.focus(); }
  };

  new ResizeObserver(() => panel.fit()).observe(surface);
  // Closing or reloading the page ends its shells. keepalive lets the
  // request finish after the page is gone and still carries the intent header.
  window.addEventListener('pagehide', () => {
    for (const instance of panel.instances) {
      if (!instance.id || instance.exited) continue;
      fetch('/api/pty/close', { method: 'POST', body: instance.id, keepalive: true,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-FlowStudio-Intent': 'run' } }).catch(() => {});
    }
  });
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.shiftKey && (event.key === '`' || event.key === '~' || event.code === 'Backquote')) {
      event.preventDefault();
      panel.show('terminal');
      panel.create();
    } else if (event.ctrlKey && !event.shiftKey && (event.key === '`' || event.code === 'Backquote')) {
      event.preventDefault();
      if (panel.view === 'terminal' && root.contains(document.activeElement)) document.getElementById('source')?.focus();
      else { panel.show('terminal'); panel.focus(); }
    }
  }, true);

  let initial = 'terminal';
  try { initial = localStorage.getItem('flowstudio.dock.view') || 'terminal'; } catch (_) {}
  panel.show(initial === 'console' ? 'console' : 'terminal');
  globalThis.FlowStudioTerminal = panel;
  return panel;
}
