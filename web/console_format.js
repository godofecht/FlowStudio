/* What the console shows for a run's raw output.
 *
 * The native routes return what the toolchains print: flowc progress lines,
 * private /tmp paths, C compiler logs, Python frames from FlowStudio's own
 * kernel, `Process exited` notes. People want the program's output and,
 * when something fails, one plain line that says what and where. format()
 * turns raw text into lines of these kinds:
 *
 *   out     program output, unchanged
 *   error   a problem, shown with a cross; `line` is set when known
 *   warning a warning, shown with a warning sign; `line` when known
 *   dim     context worth keeping but quiet (traceback frames)
 *
 * and `detail`, the original text, when anything was hidden, so the console
 * can offer it behind a "Show full log" toggle.
 */
(function (root) {
"use strict";

const FLOW_LOCATION = /^\s*(?:\/[^\s:]*\/)?(?:main|prog|entry)\.flow:(\d+):(\d+):\s*(?:parse\s+)?(error|warning):\s*(.*)$/;
const SESSION_LOCATION = /^line (\d+): (.*)$/;
const C_ERROR = /^\s*\/\S+\.c:\d+:\d+:\s*(error|warning):\s*(.*)$/;
const FLOW_NOISE = [
  /^flowc emit: /,
  /^flowc: \d+ type warning\(s\)/,
  /^(?:❌|✅|ℹ️|🚀|⚠️)\s/,
  /^\u001b\[[0-9;]*m/,
  /^ensure_flowc: /,
  /^Exit code: \d+$/,
  /^-{20,}$/,
  /^\s*\d+ \|/,                 // C compiler source excerpt
  /^\s*\|\s*[\^~ ]*$/,          // and its caret line
  /^\d+ errors? generated\.$/,
  /^\d+ warnings? generated\.$/
];
const EXITED = /^Process exited (?:unsuccessfully|with code (\d+))\.$/;
const TIMED_OUT = /^Flow compilation or execution stopped after (\d+) seconds\.$/;

function trimMessage(text) {
  return String(text).replace(/ \(byte \d+\)$/, "").replace(/\s+$/, "");
}

function formatFlow(text, ok) {
  const lines = [];
  let hidden = false;
  let cBuild = false;
  for (const raw of String(text).split("\n")) {
    const located = FLOW_LOCATION.exec(raw);
    if (located) {
      lines.push({ kind: located[3], line: Number(located[1]), column: Number(located[2]),
        text: trimMessage(located[4]) });
      if (raw.includes("/")) hidden = true;
      continue;
    }
    const session = SESSION_LOCATION.exec(raw);
    if (session && !ok) {
      lines.push({ kind: "error", line: Number(session[1]), text: trimMessage(session[2]) });
      continue;
    }
    const cError = C_ERROR.exec(raw);
    if (cError) {
      hidden = true;
      if (cError[1] === "error") {
        cBuild = true;
        lines.push({ kind: "error", text: "C build failed: " + trimMessage(cError[2]) });
      }
      continue;
    }
    const exited = EXITED.exec(raw.trim());
    if (exited) {
      hidden = true;
      if (!lines.some(line => line.kind === "error"))
        lines.push({ kind: "error", text: exited[1] ? "Exited with code " + exited[1] + "." : "The program exited with an error." });
      continue;
    }
    const timedOut = TIMED_OUT.exec(raw.trim());
    if (timedOut) {
      lines.push({ kind: "error", text: "Stopped after " + timedOut[1] + " seconds." });
      continue;
    }
    if (FLOW_NOISE.some(pattern => pattern.test(raw))) { hidden = true; continue; }
    lines.push({ kind: "out", text: raw });
  }
  if (cBuild && !lines.some(line => line.kind === "error" && line.line))
    lines.push({ kind: "dim", text: "flowc accepted the code, so this is often a name or type the checker missed." });
  return { lines: tidy(lines), detail: hidden ? String(text) : null };
}

const PY_KERNEL_FRAME = /^\s*File ".*\/(?:python_kernel|python_debugger|python_trace)\.py", line \d+, in /;
const PY_USER_FRAME = /^(\s*)File "<FlowStudio Python>", line (\d+), in (.*)$/;
function formatPython(text, ok) {
  const source = String(text).split("\n");
  if (ok || !source.some(line => /^Traceback \(most recent call last\):$/.test(line)))
    return { lines: tidy(source.map(line => ({ kind: "out", text: line }))), detail: null };
  const lines = [];
  let hidden = false;
  let inTraceback = false;
  for (let index = 0; index < source.length; index++) {
    const raw = source[index];
    if (/^Traceback \(most recent call last\):$/.test(raw)) { inTraceback = true; hidden = true; continue; }
    if (inTraceback && PY_KERNEL_FRAME.test(raw)) {
      // The kernel frame and the statement under it are FlowStudio's own.
      if (index + 1 < source.length && /^\s{4,}\S/.test(source[index + 1]) && !/^\s*File /.test(source[index + 1])) index++;
      continue;
    }
    const frame = PY_USER_FRAME.exec(raw);
    if (inTraceback && frame) {
      lines.push({ kind: "dim", line: Number(frame[2]), text: "line " + frame[2] + ", in " + frame[3] });
      continue;
    }
    if (inTraceback && /^\s/.test(raw)) { lines.push({ kind: "dim", text: raw.trim() }); continue; }
    if (inTraceback && raw.trim()) {
      const last = [...lines].reverse().find(line => line.line);
      lines.push({ kind: "error", text: raw.trim(), line: last ? last.line : undefined });
      inTraceback = false;
      continue;
    }
    lines.push({ kind: "out", text: raw });
  }
  // The exception line reads first; the frames that led to it follow.
  const errorAt = lines.findIndex(line => line.kind === "error");
  if (errorAt > 0) {
    const [error] = lines.splice(errorAt, 1);
    const firstDim = lines.findIndex(line => line.kind === "dim");
    lines.splice(firstDim < 0 ? errorAt : firstDim, 0, error);
  }
  return { lines: tidy(lines), detail: hidden ? String(text) : null };
}

function formatR(text) {
  const lines = [];
  for (const raw of String(text).split("\n")) {
    if (/^Error(?: in .*?)?: /.test(raw)) lines.push({ kind: "error", text: raw.replace(/^Error(?: in .*?)?: /, "") });
    else if (/^Warning(?: message)?(?: in .*?)?: /.test(raw)) lines.push({ kind: "warning", text: raw.replace(/^Warning(?: message)?(?: in .*?)?: /, "") });
    else lines.push({ kind: "out", text: raw });
  }
  return { lines: tidy(lines), detail: null };
}

/* No leading or trailing blank output lines, no runs of blank lines. */
function tidy(lines) {
  const out = [];
  for (const line of lines) {
    const blank = line.kind === "out" && !line.text.trim();
    if (blank && (!out.length || (out[out.length - 1].kind === "out" && !out[out.length - 1].text.trim()))) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1].kind === "out" && !out[out.length - 1].text.trim()) out.pop();
  // A blank line right before or after a marked line only adds a gap.
  return out.filter((line, index) => !(line.kind === "out" && !line.text.trim() &&
    ((out[index + 1] && out[index + 1].kind !== "out") || (out[index - 1] && out[index - 1].kind !== "out"))));
}

function format(runtime, text, ok) {
  const name = String(runtime || "").toLowerCase();
  if (name === "flow" || name === "mathflow") return formatFlow(text, ok);
  if (name === "python") return formatPython(text, ok);
  if (name === "r") return formatR(text);
  return { lines: tidy(String(text).split("\n").map(line => ({ kind: "out", text: line }))), detail: null };
}

const api = Object.freeze({ format, formatFlow, formatPython, formatR });
root.FlowStudioConsoleFormat = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
