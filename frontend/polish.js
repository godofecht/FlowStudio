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

export function mountPolish(doc = document) {
  revealActiveTab(doc);
  markRunBusy(doc);
  focusEditorOnLoad(doc);
}
