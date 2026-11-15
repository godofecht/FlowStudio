// View zoom: one scale for the UI and the editor. The type tokens in
// workbench.css multiply by --zoom; Monaco and the terminal read the
// --text-code token. Cmd or Ctrl with +, - and 0 zoom in, out and back.
// The level persists. An inline script in index.html applies the saved
// level before first paint, so a zoomed page does not jump.

export const ZOOM_KEY = 'flowstudio.zoom';
export const ZOOM_LEVELS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4];

function clampLevel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  // Snap to the nearest level so stored values stay on the scale.
  return ZOOM_LEVELS.reduce((best, level) => Math.abs(level - number) < Math.abs(best - number) ? level : best, 1);
}

// The editor font from the tokens, in whole pixels, as Monaco wants it.
export function codeFont(doc = document) {
  const style = getComputedStyle(doc.documentElement);
  // The token is a calc() over --zoom, so let the browser resolve it.
  const probe = doc.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;font-size:var(--text-code)';
  (doc.body || doc.documentElement).append(probe);
  const size = parseFloat(getComputedStyle(probe).fontSize) || 13;
  probe.remove();
  const leading = parseFloat(style.getPropertyValue('--leading-code')) || 1.6;
  const family = style.getPropertyValue('--font-mono').trim() || 'monospace';
  return { fontSize: Math.round(size), lineHeight: Math.round(size * leading), fontFamily: family };
}

export function mountZoom({ doc = document, storage = globalThis.localStorage, editor = null } = {}) {
  let level = 1;
  try { level = clampLevel(storage && storage.getItem(ZOOM_KEY) || 1); } catch (_) { level = 1; }

  function apply(next, persist = true) {
    level = clampLevel(next);
    doc.documentElement.style.setProperty('--zoom', String(level));
    if (persist) {
      try { if (level === 1) storage.removeItem(ZOOM_KEY); else storage.setItem(ZOOM_KEY, String(level)); } catch (_) { /* optional */ }
    }
    const font = codeFont(doc);
    if (editor) editor.updateOptions(font);
    doc.dispatchEvent(new CustomEvent('flowstudio:zoom', { detail: { level, ...font } }));
    // The layout manager sizes panes from the window, not from fonts, but a
    // relayout keeps the dock and panes inside the window after a change.
    if (globalThis.FlowStudioLayout) globalThis.FlowStudioLayout.relayout();
    return level;
  }
  function step(direction) {
    const index = ZOOM_LEVELS.indexOf(level);
    const next = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + (direction > 0 ? 1 : -1)))];
    if (next !== level) {
      apply(next);
      announce();
    }
    return level;
  }
  function announce() {
    const status = doc.getElementById('resultStatus');
    if (status) status.textContent = 'Zoom ' + Math.round(level * 100) + '%';
  }

  doc.addEventListener('keydown', event => {
    // Cmd on a Mac, Ctrl elsewhere; either works, as for the other shortcuts.
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    let handled = true;
    if (event.key === '=' || event.key === '+') step(1);
    else if (event.key === '-' || event.key === '_') step(-1);
    else if (event.key === '0' && !event.shiftKey) { apply(1); announce(); }
    else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  }, true);

  apply(level, false);
  return Object.freeze({
    value: () => level,
    levels: ZOOM_LEVELS,
    set: value => { const result = apply(value); announce(); return result; },
    step,
    zoomIn: () => step(1),
    zoomOut: () => step(-1),
    reset: () => { apply(1); announce(); return 1; }
  });
}
