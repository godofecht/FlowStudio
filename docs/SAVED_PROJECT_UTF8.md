# Saved project persistence: UTF-8 and snapshot integrity

FlowStudio's native workbench stores example-project buffers in the browser's
origin-scoped `localStorage` under `flowstudio.savedProjects.v1`.
This is a **local recovery convenience**, not a native Flow/R/Python
interpreter snapshot, remote synchronization, or an RStudio-compatible project
format. It must not silently corrupt Unicode source or mutate stored files
when a consumer edits an object returned from the storage API.

## Reproducible acceptance

```sh
node --test tests/saved_projects.test.js
npm test
python3 scripts/verify_native.py --require-r
npm run test:ui
```

The focused Node suite checks the exact 65,536-byte UTF-8 source limit and
rejects multibyte overflows, lone surrogates, control-character filenames,
duplicate file paths and malformed persisted records. A deterministic
twelve-file Flow/R/Python project (Unicode text in every buffer) must round-trip
unchanged through a fresh store instance. Mutating the original input or
objects returned by `upsert`, `list` and `find` must never change the
saved snapshot. An invalid new project must not damage an existing project.

The existing physical Chromium `tests/native_ui.mjs` exercises saving a
real example project through the workbench and reopening it after a page
reload. The production native HTTP/compiler/R gates are unchanged; they are
required for release qualification, not substitutes for the browser
persistence test.

## Limits and security

Up to 20 projects, 12 files per project, 65,536 UTF-8 bytes per file and
786,432 serialized bytes per project. Invalid records are ignored on load.
Browser storage can be unavailable or quota-exhausted; this feature does
not guarantee durable storage or provide a transactional filesystem. Project
buffers can contain secrets, so persistence remains local to the origin.

No claim of full RStudio parity, remote persistence, multi-user isolation or
cross-browser migration is made.
