# Branch integration, 18 November 2026

Baseline: `cdfdcf010c8c79d320707e08b878cc9958fd4464`.

The integration includes PR #543, Python and R blocks inside Flow, and PR #485,
the bounded field-output verifier. The generated editor bundle was rebuilt to
resolve the blocks PR's conflict with the current workbench.

Review of historical branches recovered four missing changes:

- Rectangular PDE grid overrides through the Python API and CLI. Both heat and
  Navier-Stokes backends execute the rectangular resolution in regression tests.
- Unicode whitespace shared by the native expression lexer and equation-system
  splitter. The new smoke assertions fail against the baseline and pass through
  the real Flow compiler with the fix.
- Project file creation checks for an existing file before requesting creation.
- Reverse console history search, adapted to the current terminal prompt and
  exercised through real Python execution in Chromium.

Other historical snapshots are superseded by the current implementations.
Previously squash-merged PR heads were checked against their merge commits on
main. Their histories are reconciled with a history-only merge that preserves
the integrated source tree. Earlier explorer, console, interpreter, assistant,
language-server and mathematical-runtime snapshots retain the current modules.
Worktree files and branch references are preserved.

The detailed reference and commit inventory is saved locally as
`build/branch-integration-audit.json`.

Issue #198 remains open. `src/math_flow.py` still defines a separate bounded
frontend. General upstream mathematical grammar, compiler-wide tensor semantics
and native Navier-Stokes execution have unmet acceptance requirements. The field
fixture in PR #485 remains an optional compiler qualification experiment.
