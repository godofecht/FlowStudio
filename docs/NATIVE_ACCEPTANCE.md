# Native acceptance gate — 2026-10-17

FlowStudio is **not RStudio feature-parity**. The native application has **not** passed end-to-end acceptance.

## Reproduce

From the repository root on Linux x86-64 or macOS arm64 with Flow 2.x, a C11 compiler, and Python 3 installed:

```sh
python3 -m unittest discover -s tests -p 'test_verify_native.py' -v
python3 scripts/verify_native.py
```

The first command tests the verification harness. The second removes any stale `build/flowstudio`, runs the real `scripts/build.sh`, starts the resulting executable, verifies `GET /health`, runs `tests/http_smoke.py` against the live server, propagates failures, and terminates the server process group. It does not use a fake server for application acceptance.

## Evidence from this iteration

Linux x86-64, Python 3.13.5: **9/9 verification-harness unit tests passed**; both Python files passed `py_compile`. The two test fixtures using a fake HTTP server validate orchestration only. The checked-in source and test Git blob hashes are `8abfc50df276ed1df9270398adb154c9bb583af4` and `04a7abeb2dfdce99b0c55c401253c8dad3b01e22`.

Flow compiler not installed on the test host. **Not run:** native Flow compilation/link, live FlowStudio HTTP smoke, R runtime, physical browser, macOS arm64. The RStudio parity matrix in `docs/PARITY.md` therefore remains unchanged.

## Next gate

Install a current Flow 2.x toolchain and run `python3 scripts/verify_native.py` on Linux and macOS. Preserve compiler and test output, repair any native failures, and then validate Flow/R/Python execution with actual runtimes. Do not promote a feature to verified until both platforms pass.
