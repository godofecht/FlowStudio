// Interaction polish for the workbench. Each function fixes one behaviour a
// person notices; tests/native_workbench_polish_ui.mjs checks each in Chromium.

// The editor gets the keyboard when the page opens, as in any IDE. Only when
// nothing else has it, so a click made while the page loads still wins.
export function focusEditorOnLoad(doc = document) {
  requestAnimationFrame(() => {
    const active = doc.activeElement;
    if (active && active !== doc.body && active !== doc.documentElement) return;
    doc.getElementById('source')?.focus();
  });
}

// The open-documents strip scrolls sideways when tabs overflow. A tab that
// becomes active (a new buffer, a file opened from the explorer) is scrolled
// into view, so the user can always see which document they are typing in.
export function revealActiveTab(doc = document) {
  const strip = doc.getElementById('docTabs');
  if (!strip) return;
  let frame = 0;
  const reveal = () => {
    frame = 0;
    const tab = strip.querySelector('.doc-tab[aria-selected="true"]');
    if (!tab) return;
    const box = strip.getBoundingClientRect(), rect = tab.getBoundingClientRect();
    const left = rect.left - box.left + strip.scrollLeft;
    const right = left + rect.width;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  };
  // renderTabs announces the change before it rebuilds the strip; reveal
  // after the rebuild has painted.
  doc.addEventListener('flowstudio:documents', () => {
    if (!frame) frame = requestAnimationFrame(reveal);
  });
  new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(reveal); }).observe(strip);
}

// Every place that disables Run does so while a run, a project run or a
// session reset is in flight. Mark that as busy so the button shows a
// spinner and assistive technology hears it.
export function markRunBusy(doc = document) {
  const run = doc.getElementById('run');
  if (!run) return;
  const sync = () => {
    if (run.disabled) run.setAttribute('aria-busy', 'true');
    else run.removeAttribute('aria-busy');
  };
  new MutationObserver(sync).observe(run, { attributes: true, attributeFilter: ['disabled'] });
  sync();
}

// renderTabs rebuilds the whole strip, so a CSS animation on .doc-tab would
// replay each time a keystroke flags a buffer dirty. Only a tab for a
// document that was not in the strip before gets the entry animation.
export function animateNewTabs(doc = document) {
  const strip = doc.getElementById('docTabs');
  if (!strip) return;
  const ids = () => new Set(Array.from(strip.querySelectorAll('.doc-tab[data-doc-id]'), tab => tab.dataset.docId));
  let known = ids();
  new MutationObserver(() => {
    const now = ids();
    for (const tab of strip.querySelectorAll('.doc-tab[data-doc-id]')) {
      if (known.has(tab.dataset.docId)) continue;
      tab.classList.add('fs-enter');
      tab.addEventListener('animationend', () => tab.classList.remove('fs-enter'), { once: true });
    }
    known = now;
  }).observe(strip, { childList: true });
}

// A new status message rises in, so the eye catches it in the status bar.
export function flashStatus(doc = document) {
  const status = doc.getElementById('resultStatus');
  if (!status) return;
  let last = status.textContent;
  new MutationObserver(() => {
    if (status.textContent === last) return;
    last = status.textContent;
    const duration = motionMs(doc, '--dur-base');
    if (duration && typeof status.animate === 'function')
      status.animate([{ opacity: 0.2, transform: 'translateY(2px)' }, { opacity: 1, transform: 'none' }],
        { duration, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }).observe(status, { childList: true, characterData: true, subtree: true });
}

// A motion token in milliseconds; 0 when reduced motion is on.
export function motionMs(doc, name) {
  const raw = getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return /ms$/.test(raw) ? value : value * 1000;
}

export function mountPolish(doc = document) {
  animateNewTabs(doc);
  flashStatus(doc);
  revealActiveTab(doc);
  markRunBusy(doc);
  focusEditorOnLoad(doc);
}
