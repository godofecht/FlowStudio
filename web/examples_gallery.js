/* FlowStudio examples gallery. Curated local examples that show Flow, Python
 * and R cooperating inside one project. Everything runs on this device.
 */
(function (global) {
"use strict";

const FLOW_INTEROP =
'function main() -> i32 {\n' +
'    # Reads the Python step output from data/samples.csv,\n' +
'    # applies the compiled pipeline and prints a summary table.\n' +
'    print("Flow pipeline starting (select MLIR backend to compile this via LLVM)")\n' +
'    for row in Reader { path: "data/samples.csv" } {\n' +
'        let value: f64 = row.value\n' +
'        let scaled: f64 = value * 2.0\n' +
'        print("scaled", scaled)\n' +
'    }\n' +
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
    id: "polyglot-pipeline",
    title: "Python → data file → R analysis",
    description: "Generate data with the persistent Python session, then analyse the same file with the R session. Two languages, one project folder.",
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
  },
  {
    id: "python-r-handshake",
    title: "Python → R one-shot handshake",
    description: "Uses the built-in /api/demo/python-r route: Python sums a vector, R takes the result as sqrt input. Shows the cross-kernel contract without files.",
    language: "demo",
    files: [],
    demoRoute: "/api/demo/python-r",
    steps: [
      "Press Run demo; the server runs Python then R in sequence."
    ]
  },
  {
    id: "py-plot-r",
    title: "Stats in Python, visuals in R",
    description: "Fits a regression with Python's stdlib (no deps) and plots residuals with base R graphics you can send to the Plots tab.",
    language: "python-entry",
    files: [
      { name: "fit.py", language: "python", text:
'# Linear regression with the standard library only.\n' +
'import random\n' +
'random.seed(3)\n' +
'xs = [float(i) for i in range(30)]\n' +
'ys = [2.0 * x + 1.0 + random.gauss(0, 3) for x in xs]\n' +
'n = len(xs)\n' +
'mean_x = sum(xs) / n\n' +
'mean_y = sum(ys) / n\n' +
'slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / sum((x - mean_x) ** 2 for x in xs)\n' +
'intercept = mean_y - slope * mean_x\n' +
'residuals = [y - (intercept + slope * x) for x, y in zip(xs, ys)]\n' +
'print("slope", round(slope, 4), "intercept", round(intercept, 4))\n' +
'with open("data/fit_residuals.csv", "w", newline="") as handle:\n' +
'    import csv\n' +
'    writer = csv.writer(handle)\n' +
'    writer.writerow(["index", "residual"])\n' +
'    writer.writerows(enumerate(residuals))\n' },
      { name: "plot.R", language: "r", text:
'res <- read.csv("data/fit_residuals.csv")\n' +
'plot(res$index, res$residual, type = "b", main = "Residuals of a Python fit")\n' +
'abline(h = 0, col = "red")\n' }
    ],
    visual: "Plots residuals with base R. The Plots tab opens with the figure after Run.",
    steps: [
      "Run fit.py with Python selected (writes data/fit_residuals.csv).",
      "Run plot.R with R selected. The Plots tab opens automatically with the figure."
    ]
  }
];

function examples() {
  return EXAMPLES.slice();
}

function validate() {
  const seen = new Set();
  for (const example of EXAMPLES) {
    if (typeof example.id !== "string" || !example.id || seen.has(example.id)) return "bad id";
    seen.add(example.id);
    if (typeof example.title !== "string" || !example.title) return "bad title";
    if (typeof example.description !== "string") return "bad description";
    if (!Array.isArray(example.steps)) return "bad steps";
    if (example.visual !== undefined && typeof example.visual !== "string") return "bad visual";
    if (!Array.isArray(example.files)) return "bad files";
    for (const file of example.files) {
      if (!file || typeof file.name !== "string" || typeof file.language !== "string" ||
          typeof file.text !== "string") return "bad file";
      if (!["flow", "r", "python"].includes(file.language)) return "bad language";
      if (file.text.length > 32768) return "file too large";
    }
  }
  return null;
}

function mount(document, options) {
  const { host, onOpen, onOpenProject, onDemo, notice = () => {},
    onReopenProject = null, onForgetProject = null } = options || {};
  if (!host) throw new TypeError("Examples gallery needs a host element.");
  const problem = validate();
  if (problem) throw new Error("Examples dataset problem: " + problem);
  if (typeof onOpen !== "function" ||
      (onOpenProject && typeof onOpenProject !== "function") ||
      (onDemo && typeof onDemo !== "function") ||
      (onReopenProject && typeof onReopenProject !== "function") ||
      (onForgetProject && typeof onForgetProject !== "function"))
    throw new TypeError("Examples gallery needs onOpen and optional onOpenProject, onDemo, onReopenProject and onForgetProject callbacks.");
  const savedData = options && options.saved && typeof options.saved.list === "function"
    ? options.saved : null;

  /* Saved projects come first: they act like project management for
   * examples opened earlier, persisting as project files on this device. */
  const savedSection = document.createElement("div");
  savedSection.className = "saved-projects";
  const curatedSection = document.createElement("div");
  curatedSection.className = "curated-examples";
  host.replaceChildren(savedSection, curatedSection);

  function fileCountText(files) {
    return files.length + (files.length === 1 ? " file" : " files");
  }
  function renderSaved() {
    const list = savedData ? savedData.list() : [];
    savedSection.replaceChildren();
    const heading = document.createElement("h2");
    heading.className = "gallery-heading";
    heading.textContent = "Your projects";
    savedSection.append(heading);
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Projects you open below are saved on this device with your edits, so you can reopen them here after a reload.";
      savedSection.append(empty);
      return;
    }
    for (const project of list) {
      const card = document.createElement("section");
      card.className = "example-card saved-project";
      card.dataset.projectId = project.id;
      const head = document.createElement("div");
      head.className = "example-head";
      const title = document.createElement("h3");
      title.textContent = project.title;
      head.append(title);
      const meta = document.createElement("span");
      meta.className = "example-langs";
      const when = Number.isFinite(project.savedAt) ?
        new Date(project.savedAt).toLocaleString() : "";
      meta.textContent = fileCountText(project.files) + (when ? " · " + when : "");
      head.append(meta);
      card.append(head);
      const names = document.createElement("p");
      names.className = "saved-project-files muted";
      names.textContent = project.files.map(file => file.name).join(", ");
      card.append(names);
      if (onReopenProject) {
        const reopen = document.createElement("button");
        reopen.type = "button";
        reopen.className = "primary";
        reopen.textContent = "Reopen project (" + fileCountText(project.files) + ")";
        reopen.addEventListener("click", () => onReopenProject(project));
        card.append(reopen);
        for (const file of project.files) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "example-file-btn";
          button.textContent = file.name + " · " + file.language;
          button.addEventListener("click", () => onReopenProject(project, file));
          card.append(button);
        }
      }
      if (onForgetProject) {
        const forget = document.createElement("button");
        forget.type = "button";
        forget.className = "example-forget";
        forget.setAttribute("aria-label", "Forget saved project " + project.title);
        forget.textContent = "Forget project";
        forget.addEventListener("click", () => {
          onForgetProject(project.id);
          renderSaved();
        });
        card.append(forget);
      }
      savedSection.append(card);
    }
  }
  const handleOpenProject = onOpenProject && (example => {
    onOpenProject(example);   // Saved list may change (upsert); refresh the section.
    renderSaved();
  });

  const curated = document.createElement("h2");
  curated.className = "gallery-heading";
  curated.textContent = "Curated examples";
  curatedSection.append(curated);
  for (const example of EXAMPLES) {
    const card = document.createElement("section");
    card.className = "example-card";
    card.dataset.exampleId = example.id;
    const head = document.createElement("div");
    head.className = "example-head";
    const title = document.createElement("h3");
    title.textContent = example.title;
    head.append(title);
    const langs = document.createElement("span");
    langs.className = "example-langs";
    const kinds = [...new Set(example.files.map(file => file.language))];
    langs.textContent = kinds.length ? kinds.join(" · ") : "Python + R (one-shot)";
    head.append(langs);
    card.append(head);
    const description = document.createElement("p");
    description.className = "muted";
    description.textContent = example.description;
    card.append(description);
    if (example.visual) {
      const hint = document.createElement("p");
      hint.className = "example-visual";
      hint.textContent = "Visual: " + example.visual;
      card.append(hint);
    }
    if (handleOpenProject && !example.demoRoute) {
      const primary = document.createElement("button");
      primary.type = "button";
      primary.className = "primary";
      primary.textContent = "Open and run (" + example.files.length + " " +
        (example.files.length === 1 ? "file" : "files") + ")";
      primary.addEventListener("click", () => handleOpenProject(example));
      card.append(primary);
    }
    if (example.demoRoute && onDemo) {
      const demo = document.createElement("button");
      demo.type = "button";
      demo.textContent = "Run demo in the console (Python + R)";
      demo.addEventListener("click", () => onDemo(example));
      card.append(demo);
    }
    for (const file of example.files) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "example-file-btn";
      button.textContent = file.name + " · " + file.language;
      button.addEventListener("click", () => onOpen(example, file));
      card.append(button);
    }
    const steps = document.createElement("details");
    steps.className = "example-runbook";
    const summary = document.createElement("summary");
    summary.textContent = "How to run";
    steps.append(summary);
    const ordered = document.createElement("ol");
    for (const step of example.steps) {
      const item = document.createElement("li");
      item.textContent = step;
      ordered.append(item);
    }
    steps.append(ordered);
    card.append(steps);
    curatedSection.append(card);
  }
  renderSaved();
}

const api = { examples, validate, mount };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioExamples = api;
})(globalThis);
