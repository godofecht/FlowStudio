# Browser Python package management — 2026-10-22

The GitHub Pages IDE includes a Python package inventory and installation panel. The Pyodide worker enumerates installed distributions using Python's importlib.metadata and installs package names through micropip, optionally pinned with ==version. Package operations share the worker's serialized interpreter queue with execution and inspection. The browser panel uses DOM text nodes for package metadata and clears its view on interpreter reset.

**Status: partial / implementation published.** Python package inventory and installation are wired into docs/app/index.html. The feature is limited to Pyodide-compatible Python packages in the current worker. It does not install R or Flow packages, does not persist packages across interpreter reset, and has not been tested against a live Pyodide CDN download in a physical browser.

**Local validation:** Node.js 22.16.0 ran 11 package-worker and package-panel regression tests successfully on 2026-10-22. The tested worker and panel Git blob hashes match the published versions; the test suite for the worker is committed, but the full five-test panel suite remains locally validated only. The published two-test panel smoke suite has not been run against the GitHub checkout in this environment. No claim of hosted CI or cross-platform parity is made for these commits.

The native application/backend remains Flow. The Pages browser frontend cannot yet execute Flow or R; see docs/PARITY.md.
