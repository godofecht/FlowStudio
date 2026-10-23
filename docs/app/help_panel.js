/* Browser-local Python/R help viewer. Never evaluates a user-supplied expression. */
(function (global) {
"use strict";
const PYTHON_TOPIC = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,3}$/;
const R_TOPIC = /^[A-Za-z][A-Za-z0-9._]{0,79}(?:::[A-Za-z][A-Za-z0-9._]{0,79})?$/;
function validTopic(language, topic) {
  return typeof topic === "string" && topic.length <= 120 &&
    (language === "python" ? PYTHON_TOPIC.test(topic) :
      language === "r" ? R_TOPIC.test(topic) : false);
}
function create({input, button, target, document, notice, language, python, r, isBusy, setBusy, generation}) {
  async function lookup() {
    if (isBusy()) { notice("Wait for execution to finish."); return false; }
    const selected = language(), topic = input.value.trim();
    if (!validTopic(selected, topic)) {
      notice("Enter a Python identifier or an R topic (optionally package::topic).");
      return false;
    }
    const started = generation();
    setBusy(true);
    notice("Looking up installed " + selected + " documentation for " + topic + ".");
    try {
      const result = selected === "python" ? await python(topic) : await r(topic);
      if (started !== generation() || language() !== selected) return false;
      if (!result || !result.ok) {
        notice("Help unavailable: " + String(result?.output || "No documentation found.").slice(0, 300));
        return false;
      }
      if (typeof result.doc !== "string" || result.doc.length > 12000 ||
          typeof result.name !== "string" || result.name.length > 120) {
        notice("Invalid documentation response."); return false;
      }
      const holder = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = selected + " help: " + result.name;
      const body = document.createElement("pre");
      body.textContent = result.doc || "(No documentation text available.)";
      body.setAttribute("aria-label", "Documentation for " + result.name);
      holder.append(title, body);
      target.replaceChildren(holder);
      notice("Showing installed " + selected + " documentation for " + result.name + ".");
      return true;
    } catch (error) {
      if (started === generation()) notice("Help lookup failed: " + String(error).slice(0, 300));
      return false;
    } finally {
      if (started === generation()) setBusy(false);
    }
  }
  button.addEventListener("click", () => { void lookup(); });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); void lookup(); }
  });
  return Object.freeze({lookup});
}
const api = Object.freeze({create, validTopic});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioHelpPanel = api;
})(globalThis);
