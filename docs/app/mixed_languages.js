/* Cross-language browser pipeline using the existing Pyodide worker and webR session. */
(function (root) {
"use strict";
function parseScalar(text) {
  const value = String(text).trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) || value.length > 24)
    throw Error("Python did not return a valid nonnegative numeric scalar.");
  const number = Number(value);
  if (!Number.isFinite(number)) throw Error("Python scalar is not finite.");
  return number;
}
async function runPipeline(pythonRun, rRun) {
  const py = await pythonRun("print(sum([1, 2, 3, 4, 5]))");
  if (!py.ok) throw Error("Python failed: " + py.output);
  const number = parseScalar(py.output);
  const r = await rRun("cat(sqrt(" + number + "))");
  if (!r.ok) throw Error("R failed: " + r.output);
  const answer = Number(String(r.output).trim());
  if (!Number.isFinite(answer) || Math.abs(answer - Math.sqrt(number)) > 1e-5)
    throw Error("R produced an unexpected result: " + r.output);
  return {python:number, r:answer};
}
function pythonWorker() {
  const worker = new Worker("./python-worker.js");
  let next = 0;
  const pending = new Map();
  worker.onmessage = event => {
    const msg = event.data || {};
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    entry.resolve(msg);
  };
  worker.onerror = error => {
    for (const entry of pending.values()) entry.reject(Error(error.message || "Python worker failed"));
    pending.clear();
  };
  return {
    run(code) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, {resolve, reject});
        worker.postMessage({id, op:"run", code});
      });
    },
    close() { worker.terminate(); pending.clear(); }
  };
}
function mount(doc = document, workerFactory = pythonWorker, rFactory = root.FlowStudioRSession.create) {
  const button = doc.getElementById("run");
  const status = doc.getElementById("status");
  const result = doc.getElementById("result");
  const py = workerFactory();
  const r = rFactory();
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = "Loading/running Python and R WebAssembly runtimes…";
    result.textContent = "";
    try {
      const values = await runPipeline(code => py.run(code), code => r.run(code));
      result.textContent = "Python sum = " + values.python + "\nR sqrt(sum) = " + values.r;
      status.textContent = "Completed in this browser.";
    } catch (error) {
      status.textContent = "Execution failed.";
      result.textContent = String(error);
    } finally {
      button.disabled = false;
    }
  });
  return {py, r};
}
const api = {parseScalar, runPipeline, mount};
if (typeof module !== "undefined" && module.exports) module.exports = api;
else mount();
})(globalThis);
