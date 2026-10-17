# Environment inspector module — 2026-10-16

The branch now contains `web/environment.js` and `tests/environment.test.js`.

The JavaScript module normalizes interpreter variable metadata with explicit limits, renders an accessible table using text nodes, and defines HTTP clients for inspecting or resetting Python and R sessions. These clients match the route contract proposed in the independent persistent-kernel integration patch.

## Verification

Eight tests were executed against the exact committed module and test source in a V8 JavaScript runtime using a Node-compatible test/assert adapter. All eight passed. The tests cover bounded results, invalid response shapes, DOM text rendering, HTTP request method and intent header, unsupported runtimes, error propagation and reset semantics.

This is **module-level validation**, not a physical-browser or end-to-end native FlowStudio test.

## Integration status

The environment module is committed, but it is **not yet loaded by the served editor**. The current main Flow HTTP dispatcher does not expose the proposed inspection and reset routes. An attempt to update the existing HTML workspace was blocked by repository-write safety checks. The independently tested persistent Python/R kernel patch remains unmerged.

Do not count variable inspection or persistent sessions as operational until the native Flow compiler and runtime integration are validated.

## Next acceptance gate

Integrate the persistent kernel transport and route dispatcher, serve the environment module, add its controls to the workspace, then execute native build, Python and R HTTP smoke tests, and physical-browser interaction tests on Linux and macOS. Keep the application loopback-only and trusted-code-only until authenticated process isolation exists.
