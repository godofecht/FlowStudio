/* Each submitted program gets a worker that owns compilation and execution. */
(function (root) {
  'use strict';
  let active = null;
  function run(source, options = {}) {
    if (new TextEncoder().encode(source).length > 131072) return Promise.resolve({ ok: false, output: 'Flow source exceeds 128 KiB.' });
    if (active) return Promise.resolve({ ok: false, output: 'A Flow program is already running.' });
    return new Promise(resolve => {
      const workerURL = new URL('./browser-flow-worker.js', document.baseURI);
      workerURL.searchParams.set('v', document.querySelector('meta[name="flowstudio-revision"]')?.content || '');
      const worker = new Worker(workerURL);
      let timer;
      let settled = false;
      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
        active = null;
        const status = document.getElementById('pagesRuntimeStatus');
        if (status) status.textContent = 'Flow runs as WebAssembly in this browser.';
        resolve(result);
      }
      function deadline(milliseconds) {
        clearTimeout(timer);
        timer = setTimeout(() => finish({ ok: false, output: 'Flow execution timed out. The worker was stopped; Run starts a fresh worker.' }), milliseconds);
      }
      active = { cancel: () => finish({ ok: false, output: 'Flow execution stopped.' }) };
      deadline(120000);
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress') {
          const status = document.getElementById('pagesRuntimeStatus');
          if (status) status.textContent = data.message;
          if (data.stage === 'load') deadline(120000);
          if (data.stage === 'compile') deadline(30000);
          if (data.stage === 'execute') deadline(1500);
        } else if (data.type === 'result') {
          finish(data);
        }
      };
      worker.onerror = event => {
        event.preventDefault();
        finish({ ok: false, output: `Flow browser runtime failed: ${event.message}` });
      };
      worker.postMessage({ source, check: options.check === true });
    });
  }
  root.FlowStudioBrowserFlow = Object.freeze({ run, stop: () => { if (active) active.cancel(); } });
}(globalThis));
