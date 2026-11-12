/* FlowStudio examples gallery. Curated local examples that show Flow, Python
 * and R cooperating inside one project. Everything runs on this device.
 */
(function (global) {
"use strict";

const FLOW_INTEROP =
'# Flow step of the project: the Python step writes data/samples.csv,\n' +
'# this program re-reads it, scales each value and prints a summary\n' +
'# table. Compile it with the C backend or the MLIR backend.\n' +
'import std.io { FileRead, io_read_text }\n' +
'import std.string { ParseF64, str_line_next, str_parse_f64_at }\n' +
'\n' +
'function main() -> i32 {\n' +
'    let r: FileRead = io_read_text("data/samples.csv")\n' +
'    if r.ok == false {\n' +
'        print("data/samples.csv missing - run the Python step first")\n' +
'        return 1\n' +
'    }\n' +
'    let text: string = r.data\n' +
'    let n: i32 = r.len as i32\n' +
'    let p: ptr<u8> = text as ptr<u8>\n' +
'    let mut count: i32 = 0\n' +
'    let mut total: f64 = 0.0\n' +
'    let mut worst: f64 = 0.0\n' +
'    # Skip the "index,value" header row: find its end, then step past it.\n' +
'    let head_end: i32 = str_line_end(text, 0)\n' +
'    let mut pos: i32 = str_line_next(text, head_end)\n' +
'    while pos >= 0 and pos < n {\n' +
'        let end: i32 = str_line_end(text, pos)\n' +
'        let mut cut: i32 = end\n' +
'        let mut i: i32 = pos\n' +
'        while i < end {\n' +
'            if p[i] == 44 {\n' +
'                cut = i\n' +
'                i = end\n' +
'            }\n' +
'            i = i + 1\n' +
'        }\n' +
'        let f: ParseF64 = str_parse_f64_at(text, cut + 1)\n' +
'        if f.ok == true {\n' +
'            let scaled: f64 = f.value * 2.0\n' +
'            total = total + scaled\n' +
'            if scaled > worst {\n' +
'                worst = scaled\n' +
'            }\n' +
'            count = count + 1\n' +
'            print("scaled", scaled)\n' +
'        }\n' +
'        pos = str_line_next(text, end)\n' +
'    }\n' +
'    if count == 0 {\n' +
'        print("no sample rows found in data/samples.csv")\n' +
'        return 1\n' +
'    }\n' +
'    print("rows", count)\n' +
'    print("total scaled", total)\n' +
'    print("max scaled", worst)\n' +
'    return 0\n' +
'}\n';
const PY_GENERATE =
'# Step 1 - generate deterministic sample data for the whole project.\n' +
'def samples(rows=12, seed=7):\n' +
'    import csv, random\n' +
'    random.seed(seed)\n' +
'    return [(index, round(random.gauss(10, 2), 3))\n' +
'            for index in range(rows)]\n\n' +
'rows = samples()\n' +
'import os\n' +
'os.makedirs("data", exist_ok=True)\n' +
'import csv\n' +
'with open("data/samples.csv", "w", newline="") as handle:\n' +
'    writer = csv.writer(handle)\n' +
'    writer.writerow(["index", "value"])\n' +
'    writer.writerows(rows)\n' +
'print("wrote", len(rows), "rows to data/samples.csv")\n';

const R_ANALYSE =
'# Step 3 - the R session analyses the same data/samples.csv.\n' +
'samples <- read.csv("data/samples.csv")\n' +
'cat("rows:", nrow(samples), "\\n")\n' +
'cat("mean:", mean(samples$value), "\\n")\n' +
'cat("sd:  ", sd(samples$value), "\\n")\n' +
'# If ggplot2 was installed from the Packages tab:\n' +
'# p <- ggplot2::qplot(index, value, data = samples, geom = "line")\n' +
'# print(p)\n';

const EXAMPLES = [
  {
    id: "flow-basics",
    category: "start",
    title: "Flow basics",
    description: "Functions, while and for loops, conditions and printing, in one short program.",
    language: "flow",
    files: [{ name: "basics.flow", language: "flow", text: "# Flow basics: functions, loops, conditions and printing.\n# Press Run (Ctrl+Enter). Then try the debugging example next.\n\nfunction fib(n: i32) -> i64 {\n    let mut a: i64 = 0\n    let mut b: i64 = 1\n    let mut i: i32 = 0\n    while i < n {\n        let next: i64 = a + b\n        a = b\n        b = next\n        i = i + 1\n    }\n    return a\n}\n\nfunction parity(n: i64) -> string {\n    if n % 2 == 0 {\n        return \"even\"\n    }\n    return \"odd\"\n}\n\nfunction main() -> i32 {\n    let mut evens: i32 = 0\n    for i in 1 to 13 {\n        let value: i64 = fib(i)\n        if parity(value) == \"even\" {\n            evens = evens + 1\n        }\n        println(\"fib\", i, \"=\", value, parity(value))\n    }\n    println(\"even values:\", evens)\n    return 0\n}\n" }],
    steps: ["Press Run. The console prints the first twelve Fibonacci numbers."]
  },
  {
    id: "flow-structs",
    category: "start",
    title: "Structs and arrays",
    description: "A struct, a fixed array and a function that returns a new struct each step of a falling-particle simulation.",
    language: "flow",
    files: [{ name: "particles.flow", language: "flow", text: "# Structs and fixed arrays: a small particle simulation step.\n\nstruct Particle {\n    x: f64,\n    v: f64\n}\n\nfunction step(p: Particle, dt: f64) -> Particle {\n    let accel: f64 = 0.0 - 9.81\n    return Particle { x: p.x + p.v * dt, v: p.v + accel * dt }\n}\n\nfunction main() -> i32 {\n    let heights: array<f64, 3> = [10.0, 20.0, 40.0]\n    for k in 0 to 3 {\n        let mut p: Particle = Particle { x: heights[k], v: 0.0 }\n        let mut t: i32 = 0\n        while p.x > 0.0 {\n            p = step(p, 0.01)\n            t = t + 1\n        }\n        println(\"dropped from\", heights[k], \"m, landed after\", t, \"steps\")\n    }\n    return 0\n}\n" }],
    steps: ["Press Run. Each particle reports how many steps it took to land."]
  },
  {
    id: "debug-flow",
    category: "debug",
    title: "Debug a Flow program",
    description: "Pause at a breakpoint, step into a function, read locals and evaluate expressions. Runs under LLDB on a source-mapped build.",
    language: "flow",
    files: [{ name: "debug_me.flow", language: "flow", text: "# Debug a Flow program. Breakpoint on line 12 is set for you.\n# F5 starts, F11 steps into square(), Shift+F11 steps out, F5 continues.\nfunction square(n: i32) -> i32 {\n    let r: i32 = n * n\n    return r\n}\n\nfunction main() -> i32 {\n    let mut total: i32 = 0\n    let mut i: i32 = 1\n    while i <= 3 {\n        total = total + square(i)\n        i = i + 1\n    }\n    println(\"total\", total)\n    return 0\n}\n" }],
    breakpoints: { "debug_me.flow": [12] },
    steps: ["Press Debug. The program pauses on line 12.", "F11 steps into square(), Shift+F11 steps back out.",
      "Type total * 2 in the Debug Console.", "F5 continues to the next loop iteration."]
  },
  {
    id: "debug-python",
    category: "debug",
    title: "Debug a Python function",
    description: "Watch a running total change inside a loop, then step out to the caller.",
    language: "python",
    files: [{ name: "debug_me.py", language: "python", text: "# Debug a Python function. Breakpoint on line 6 is set for you.\n# F5 starts and pauses there. Watch total grow in Variables, F10 steps.\ndef mean(values):\n    total = 0\n    for value in values:\n        total += value\n    return total / len(values)\n\nscores = [72, 88, 95, 61, 79]\naverage = mean(scores)\nabove = [s for s in scores if s > average]\nprint(\"average\", average)\nprint(\"above average\", above)\n" }],
    breakpoints: { "debug_me.py": [6] },
    steps: ["Press Debug. The program pauses inside mean().", "F10 steps, Shift+F11 returns to the caller."]
  },
  {
    id: "debug-r",
    category: "debug",
    title: "Step through an R analysis",
    description: "Run to a breakpoint, step one expression at a time and evaluate R while paused.",
    language: "r",
    files: [{ name: "step_me.R", language: "r", text: "# Step through an R analysis. Breakpoint on line 5 is set for you.\n# F5 runs to it, F10 runs one expression at a time, and the Debug Console\n# evaluates R while paused. Open the Data view to see summary_table.\nscores <- c(72, 88, 95, 61, 79)\naverage <- mean(scores)\nabove <- scores[scores > average]\nsummary_table <- data.frame(score = scores, above = scores > average)\nprint(summary_table)\ncat(\"average:\", average, \"\\n\")\n" }],
    breakpoints: { "step_me.R": [5] },
    steps: ["Press Debug. R pauses before line 5.", "F10 runs one expression. Evaluate mean(scores) in the Debug Console."]
  },
  {
    id: "polyglot-pipeline",
    category: "polyglot",
    title: "Python → data file → R analysis",
    description: "The file-based handoff: Python writes data/samples.csv, R reads it. Useful when a step must leave a file behind.",
    language: "python-entry",
    files: [
      { name: "generate.py", language: "python", text: PY_GENERATE },
      { name: "analyse.R", language: "r", text: R_ANALYSE }
    ],
    steps: [
      "Select Python and press Run on generate.py.",
      "Select R and press Run on analyse.R."
    ]
  },
  {
    id: "flow-backend-mlir",
    category: "flow",
    title: "Flow with the MLIR backend",
    description: "A Flow program compiled through the real MLIR/LLVM pipeline (choose Backend: MLIR next to Runtime). Falls back to the C backend message if this Flow build lacks LLVM.",
    language: "flow",
    files: [
      { name: "pipeline.flow", language: "flow", text: FLOW_INTEROP }
    ],
    steps: [
      "Set Backend to MLIR and run.",
      "Compiler stderr from the real flow process is shown in the console."
    ]
  }
];

const CATEGORIES = Object.freeze([
  ["start", "Start"],
  ["polyglot", "Polyglot"],
  ["debug", "Debug"],
  ["flow", "Backends"],
  ["simulation", "Simulations"]
]);

/* MathFlow programs from examples/ (generated into examples_mathflow.js). */
function simulations(source) {
  const list = Array.isArray(source) ? source :
    Array.isArray(global.FlowStudioMathFlowExamples) ? global.FlowStudioMathFlowExamples : [];
  return list.filter(item => item && typeof item.text === "string" && item.text.length <= 32768)
    .map(item => ({
      id: item.id, category: "simulation", title: item.title, description: item.description || "",
      language: "flow", runner: "mathflow",
      files: [{ name: item.file, language: "flow", text: item.text }],
      steps: ["Press Run. MathFlow integrates the PDE with NumPy and plots the field in the Plots view."]
    }));
}
/* Polyglot examples from examples/polyglot (generated into examples_polyglot.js). */
function polyglot(source) {
  const list = Array.isArray(source) ? source :
    Array.isArray(global.FlowStudioPolyglotExamples) ? global.FlowStudioPolyglotExamples : [];
  return list.filter(item => item && typeof item.id === "string" && Array.isArray(item.files))
    .map(item => Object.assign({}, item, { category: "polyglot" }));
}
function examples(source, polyglotSource) {
  const curated = polyglot(polyglotSource);
  const firstPolyglot = EXAMPLES.findIndex(example => example.category === "polyglot");
  const head = EXAMPLES.slice(0, firstPolyglot < 0 ? EXAMPLES.length : firstPolyglot);
  const tail = EXAMPLES.slice(head.length);
  return head.concat(curated, tail, simulations(source));
}

function validate() {
  const seen = new Set();
  const categories = new Set(CATEGORIES.map(([key]) => key));
  for (const example of EXAMPLES.concat(polyglot())) {
    if (typeof example.id !== "string" || !example.id || seen.has(example.id)) return "bad id";
    seen.add(example.id);
    if (typeof example.title !== "string" || !example.title) return "bad title";
    if (typeof example.description !== "string") return "bad description";
    if (!categories.has(example.category)) return "bad category";
    if (!Array.isArray(example.steps)) return "bad steps";
    if (example.visual !== undefined && typeof example.visual !== "string") return "bad visual";
    if (!Array.isArray(example.files)) return "bad files";
    for (const file of example.files) {
      if (!file || typeof file.name !== "string" || typeof file.language !== "string" ||
          typeof file.text !== "string") return "bad file";
      if (!["flow", "r", "python"].includes(file.language)) return "bad language";
      if (file.text.length > 32768) return "file too large";
    }
    if (example.breakpoints !== undefined) {
      for (const [name, lines] of Object.entries(example.breakpoints)) {
        const file = example.files.find(item => item.name === name);
        if (!file || !Array.isArray(lines)) return "bad breakpoints";
        const count = file.text.split("\n").length;
        if (lines.some(line => !Number.isInteger(line) || line < 1 || line > count)) return "bad breakpoint line";
      }
    }
  }
  return null;
}

const LANGUAGE_LABEL = { flow: "Flow", python: "Python", r: "R" };
function languagesOf(example) {
  const kinds = [...new Set(example.files.map(file => file.language))];
  if (example.runner === "mathflow") return ["MathFlow"];
  return kinds.length ? kinds.map(kind => LANGUAGE_LABEL[kind] || kind) : ["Python", "R"];
}
function matches(example, needle) {
  if (!needle) return true;
  const hay = (example.title + " " + example.description + " " + languagesOf(example).join(" ") + " " +
    example.files.map(file => file.name).join(" ")).toLowerCase();
  return needle.toLowerCase().split(/\s+/).filter(Boolean).every(word => hay.includes(word));
}

function mount(document, options) {
  const { host, onOpen, onOpenProject, onDemo, onDebug, notice = () => {},
    onReopenProject = null, onForgetProject = null } = options || {};
  if (!host) throw new TypeError("Examples gallery needs a host element.");
  const problem = validate();
  if (problem) throw new Error("Examples dataset problem: " + problem);
  if (typeof onOpen !== "function" ||
      (onOpenProject && typeof onOpenProject !== "function") ||
      (onDemo && typeof onDemo !== "function") ||
      (onDebug && typeof onDebug !== "function") ||
      (onReopenProject && typeof onReopenProject !== "function") ||
      (onForgetProject && typeof onForgetProject !== "function"))
    throw new TypeError("Examples gallery needs onOpen and optional onOpenProject, onDemo, onDebug, onReopenProject and onForgetProject callbacks.");
  const savedData = options && options.saved && typeof options.saved.list === "function"
    ? options.saved : null;
  const all = examples(options && options.simulations);
  const h = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (className, text, onClick, label) => {
    const node = h("button", className, text);
    node.type = "button";
    if (label) node.setAttribute("aria-label", label);
    node.addEventListener("click", onClick);
    return node;
  };

  /* Toolbar: search and category chips. */
  const toolbar = h("div", "ex-toolbar");
  const search = h("input", "ex-search");
  search.type = "search";
  search.id = "examplesSearch";
  search.placeholder = "Search " + all.length + " examples";
  search.setAttribute("aria-label", "Search examples");
  search.autocomplete = "off";
  const chips = h("div", "ex-chips");
  chips.setAttribute("role", "tablist");
  chips.setAttribute("aria-label", "Example categories");
  toolbar.append(search, chips);
  const savedSection = h("div", "saved-projects");
  const curatedSection = h("div", "curated-examples");
  const empty = h("p", "ex-empty muted", "No examples match.");
  empty.hidden = true;
  host.replaceChildren(toolbar, savedSection, curatedSection, empty);

  let category = "all";
  const chipNodes = new Map();
  for (const [key, label] of [["all", "All"], ...CATEGORIES]) {
    const count = key === "all" ? all.length : all.filter(example => example.category === key).length;
    if (!count) continue;
    const chip = button("ex-chip", label, () => { category = key; filter(); });
    chip.dataset.category = key;
    chip.setAttribute("role", "tab");
    chip.append(h("span", "ex-chip-count", String(count)));
    chipNodes.set(key, chip);
    chips.append(chip);
  }
  if (typeof search.addEventListener === "function") search.addEventListener("input", () => filter());

  function fileCountText(files) {
    return files.length + (files.length === 1 ? " file" : " files");
  }
  function renderSaved() {
    const list = savedData ? savedData.list() : [];
    savedSection.replaceChildren();
    savedSection.dataset.empty = String(!list.length);
    if (!list.length) return;
    const heading = h("h2", "gallery-heading", "Your projects");
    heading.title = "Examples you open are saved on this device with your edits.";
    savedSection.append(heading);
    for (const project of list) {
      const card = h("section", "example-card saved-project");
      card.dataset.projectId = project.id;
      const head = h("div", "example-head");
      head.append(h("h3", "", project.title));
      const when = Number.isFinite(project.savedAt) ? new Date(project.savedAt).toLocaleString() : "";
      head.append(h("span", "example-langs", fileCountText(project.files) + (when ? ", " + when : "")));
      card.append(head);
      const actions = h("div", "exg-actions");
      if (onReopenProject) {
        actions.append(button("primary", "Reopen", () => onReopenProject(project),
          "Reopen project " + project.title + " (" + fileCountText(project.files) + ")"));
        for (const file of project.files)
          actions.append(button("example-file-btn", file.name, () => onReopenProject(project, file)));
      }
      if (onForgetProject) {
        actions.append(button("example-forget", "Forget", () => {
          onForgetProject(project.id);
          renderSaved();
        }, "Forget saved project " + project.title));
      }
      card.append(actions);
      savedSection.append(card);
    }
  }
  const handleOpenProject = onOpenProject && (example => {
    onOpenProject(example);   // Saved list may change (upsert); refresh the section.
    renderSaved();
  });

  const groups = new Map();
  const cards = [];
  for (const [key, label] of CATEGORIES) {
    const members = all.filter(example => example.category === key);
    if (!members.length) continue;
    const group = h("div", "ex-group");
    group.dataset.category = key;
    group.append(h("h2", "gallery-heading", label));
    groups.set(key, group);
    curatedSection.append(group);
    for (const example of members) {
      const card = h("section", "example-card");
      card.dataset.exampleId = example.id;
      card.dataset.category = key;
      const head = h("div", "example-head");
      const title = h("h3", "", example.title);
      head.append(title);
      head.append(h("span", "example-langs", languagesOf(example).join(" + ")));
      card.append(head);
      card.append(h("p", "muted ex-desc", example.description));
      if (example.visual) card.append(h("p", "example-visual", example.visual));
      const actions = h("div", "exg-actions");
      if (handleOpenProject && !example.demoRoute) {
        actions.append(button("primary", "Run", () => handleOpenProject(example),
          "Open and run " + example.title + " (" + fileCountText(example.files) + ")"));
      }
      if (example.breakpoints && onDebug) {
        actions.append(button("ex-debug", "Debug", () => { onDebug(example); renderSaved(); },
          "Open " + example.title + " and start debugging"));
      }
      if (example.demoRoute && onDemo) {
        actions.append(button("primary", "Run demo", () => onDemo(example),
          "Run the Python and R demo in the console"));
      }
      for (const file of example.files)
        actions.append(button("example-file-btn", file.name, () => onOpen(example, file), "Open " + file.name));
      card.append(actions);
      const steps = h("details", "example-runbook");
      steps.append(h("summary", "", "How it works"));
      const ordered = h("ol");
      for (const step of example.steps) ordered.append(h("li", "", step));
      steps.append(ordered);
      card.append(steps);
      group.append(card);
      cards.push({ card, example });
    }
  }
  function filter() {
    const needle = String(search.value || "").trim();
    let shown = 0;
    for (const { card, example } of cards) {
      const visible = (category === "all" || example.category === category) && matches(example, needle);
      card.hidden = !visible;
      if (visible) shown++;
    }
    for (const [key, group] of groups)
      group.hidden = !cards.some(item => item.example.category === key && !item.card.hidden);
    for (const [key, chip] of chipNodes) chip.setAttribute("aria-selected", String(key === category));
    savedSection.hidden = !!needle || category !== "all";
    empty.hidden = shown > 0;
  }
  renderSaved();
  filter();
  return { filter: (text, next) => { if (text != null) search.value = text; if (next) category = next; filter(); } };
}

/* Legacy-source upgrade: buffers and saved projects written before the
 * Reader removal still hold Flow source that cannot parse today (the old
 * `for row in Reader` pipeline). When the exact legacy marker is present the
 * text is replaced wholesale with the current curated pipeline; anything
 * else comes back untouched so user edits are never consciously rewritten. */
const LEGACY_READER_MARKER = "for row in Reader";
function upgradeFiles(files) {
  if (!Array.isArray(files)) return null;
  let upgraded = false;
  const next = files.map(file => {
    if (file && typeof file.text === "string" && file.text.includes(LEGACY_READER_MARKER)) {
      upgraded = true;
      return Object.assign({}, file, { text: FLOW_INTEROP });
    }
    return file;
  });
  return upgraded ? next : null;
}

const api = { examples, validate, mount, upgradeFiles, simulations, polyglot, CATEGORIES };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioExamples = api;
})(globalThis);
