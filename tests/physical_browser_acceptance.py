#!/usr/bin/env python3
"""Real Chromium/Firefox/WebKit acceptance for FlowStudio's browser runtimes.

No mocked interpreters, intercepted CDN requests, or silently skipped checks.
Run with: python3 -m pip install playwright && python3 -m playwright install chromium
          python3 tests/physical_browser_acceptance.py
Use --url http://127.0.0.1:8751/app/ --flow with the real native server.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
from threading import Thread
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


@contextmanager
def static_server():
    handler = partial(QuietHandler, directory=str(ROOT / "docs"))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/app/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def wait_for_execution(page, language: str, timeout: int):
    page.wait_for_function("expected => document.querySelector('#notice').textContent === expected",
                           arg=f"{language} execution complete.", timeout=timeout)
    page.wait_for_function("!document.querySelector('#run').disabled", timeout=timeout)


def run_source(page, language: str, source: str, output: str, timeout: int):
    page.locator("#language").select_option(language)
    page.locator("#source").fill(source)
    before = page.locator("#console").inner_text()
    page.locator("#run").click()
    wait_for_execution(page, language, timeout)
    after = page.locator("#console").inner_text()
    assert len(after) > len(before) and output in after[len(before):], (
        f"{language} source output did not contain {output!r}: {after[len(before):]!r}")


def run_console(page, language: str, code: str, output: str, timeout: int):
    page.locator("#consoleLanguage").select_option(language)
    page.locator("#consoleInput").fill(code)
    before = page.locator("#console").inner_text()
    page.locator("#submitConsole").click()
    wait_for_execution(page, language, timeout)
    after = page.locator("#console").inner_text()
    assert len(after) > len(before) and output in after[len(before):], (
        f"{language} console output did not contain {output!r}: {after[len(before):]!r}")


def test_python(page, timeout: int):
    run_source(page, "python", "fs_browser_value = 39\nprint(fs_browser_value + 3)", "42", timeout)
    run_console(page, "python", "print(fs_browser_value + 4)", "43", timeout)
    assert "fs_browser_value" in page.locator("#environment").inner_text()

    # A user-defined repr/len must never run during automatic environment refresh.
    run_source(page, "python", "class FSProbe:\n    def __repr__(self):\n        raise RuntimeError('inspection called user repr')\n    def __len__(self):\n        raise RuntimeError('inspection called user len')\nfs_probe = FSProbe()\nprint('inspection safe 42')",
               "inspection safe 42", timeout)
    assert "fs_probe" in page.locator("#environment").inner_text()

    # Browser download must contain exact edited source, not a synthetic fixture.
    page.locator("#source").fill("print('physical-browser-round-trip')\n")
    with page.expect_download(timeout=timeout) as download_info:
        page.locator("#save").click()
    with tempfile.TemporaryDirectory() as folder:
        destination = Path(folder) / "source.py"
        download_info.value.save_as(destination)
        assert destination.read_text(encoding="utf-8") == "print('physical-browser-round-trip')\n"

    # Session snapshots exercise real Pyodide export/import, not just the JSON codec.
    page.locator("#source").fill("fs_browser_value = 39\n")
    with page.expect_download(timeout=timeout) as snapshot_info:
        page.locator("#exportSession").click()
    with tempfile.TemporaryDirectory() as folder:
        destination = Path(folder) / "session.json"
        snapshot_info.value.save_as(destination)
        assert 'fs_browser_value' in destination.read_text(encoding="utf-8")
        page.locator("#reset").click()
        page.once("dialog", lambda dialog: dialog.accept())
        page.locator("#sessionFile").set_input_files(str(destination))
        page.wait_for_function("document.querySelector('#notice').textContent.startsWith('Imported ')",
                               timeout=timeout)
        run_console(page, "python", "print(fs_browser_value + 5)", "44", timeout)

    # Execute actual notebook cells in order in the same interpreter.
    page.locator("#source").fill("# %% [python]\nfs_nb = 11\n# %% [python]\nprint(fs_nb * 4)\n")
    page.locator("#runNotebook").click()
    page.wait_for_function("document.querySelector('#notice').textContent === 'Notebook executed 2 cells.'",
                           timeout=timeout)
    assert "44" in page.locator("#notebookOutput").inner_text()

    # Exercise real matplotlib capture and the rendered PNG history.
    run_source(page, "python", "import matplotlib.pyplot as plt\nplt.figure()\nplt.plot([1, 2, 3])\nprint('plot ready 42')",
               "plot ready 42", timeout)
    page.locator("#workspace img[alt^='Python figure']").first.wait_for(timeout=timeout)


def test_r(page, timeout: int):
    run_source(page, "r", "fs_browser_value <- 21L\nprint(fs_browser_value * 2L)", "42", timeout)
    run_console(page, "r", "print(fs_browser_value + 22L)", "43", timeout)
    assert "fs_browser_value" in page.locator("#environment").inner_text()
    run_source(page, "r", "plot(c(1, 2, 3))\nprint('r plot ready 42')", "r plot ready 42", timeout)
    page.locator("#workspace canvas").first.wait_for(timeout=timeout)
    page.locator("#reset").click()
    assert "R state reset" in page.locator("#notice").inner_text()
    run_source(page, "r", "print(exists('fs_browser_value', envir=.GlobalEnv))", "FALSE", timeout)



def test_native_r(page, timeout: int):
    # Real browser -> Flow-owned localhost HTTP -> persistent Rscript kernel.
    # This is distinct from webR; no mocked interpreter or worker interception.
    page.locator("#rRuntime").select_option("native")
    run_source(page, "r", "fs_native_browser <- 40L\ncat(fs_native_browser + 2L, '\\n')",
               "42", timeout)
    run_console(page, "r", "cat(fs_native_browser + 3L, '\\n')", "43", timeout)
    assert "fs_native_browser" in page.locator("#environment").inner_text()
    # Real DOM View -> Flow POST -> persistent R table snapshot -> accessible grid.
    run_source(page, "r",
               "fs_native_frame <- data.frame(label=c('alpha', 'beta'), "
               "score=c(42L, NA_integer_))\\ncat('native table ready 42\\n')",
               "native table ready 42", timeout)
    page.get_by_role("button", name="View fs_native_frame as table").click()
    page.get_by_role("heading", name="Snapshot: fs_native_frame").wait_for(timeout=timeout)
    assert "alpha" in page.locator("#workspace").inner_text()
    assert "beta" in page.locator("#workspace").inner_text()

    page.locator("#source").fill(
        "# %% [r]\nfs_native_nb <- fs_native_browser + 1L\n"
        "# %% [r]\ncat(fs_native_nb + 1L, '\\n')\n")
    page.locator("#runNotebook").click()
    page.wait_for_function(
        "document.querySelector('#notice').textContent === 'Notebook executed 2 cells.'",
        timeout=timeout)
    assert "42" in page.locator("#notebookOutput").inner_text()

    page.locator("#source").fill("fs_native_browser <- 999L\nvalue <- )")
    page.locator("#checkSyntax").click()
    page.wait_for_function(
        "document.querySelector('#notice').textContent.includes('r syntax:')",
        timeout=timeout)
    run_console(page, "r", "cat(fs_native_browser, '\\n')", "40", timeout)

    page.locator("#reset").click()
    page.wait_for_function(
        "document.querySelector('#notice').textContent === 'R state reset.'",
        timeout=timeout)
    run_source(page, "r",
               "cat(exists('fs_native_browser', inherits=FALSE), '\\n')",
               "FALSE", timeout)
    page.locator("#rRuntime").select_option("browser")
    run_source(page, "r",
               "cat(exists('fs_native_browser', envir=.GlobalEnv), '\\n')",
               "FALSE", timeout)


def test_flow(page, timeout: int):
    run_source(page, "flow", 'function main() -> i32 {\n    println("Flow physical browser 42")\n    return 0\n}',
               "Flow physical browser 42", timeout)



def test_native_conditional_debugger(page, timeout: int):
    # Actual Chromium/Firefox/WebKit DOM -> Flow localhost HTTP -> CPython.
    page.locator("#pythonDebugPanel summary").click()
    page.locator("#language").select_option("python")
    page.locator("#source").fill("for browser_i in range(5):\n    browser_seen = browser_i\nprint(browser_seen)\n")
    page.locator("#pythonBreakpoints").fill("2?browser_i>=3")
    page.locator("#pythonDebugStart").click()
    page.wait_for_function(
        "() => document.querySelector('#pythonDebugOutput').textContent.includes('browser_i: int = 3')",
        timeout=timeout)
    assert "Python debugger: paused" in page.locator("#pythonDebugOutput").inner_text()
    page.locator("#pythonDebugContinue").click()
    page.wait_for_function(
        "() => document.querySelector('#pythonDebugOutput').textContent.includes('browser_i: int = 4')",
        timeout=timeout)
    page.locator("#pythonDebugContinue").click()
    page.wait_for_function(
        "() => document.querySelector('#pythonDebugOutput').textContent.includes('Python debugger: done')",
        timeout=timeout)
    assert "4" in page.locator("#pythonDebugOutput").inner_text()

    # Opt-in exception tracing must pause on a real caught CPython exception.
    page.locator("#pythonBreakpoints").fill("")
    page.locator("#pythonPauseExceptions").check()
    page.locator("#source").fill(
        "try:\n    raise LookupError('caught')\n"
        "except LookupError:\n    browser_recovered = 42\n")
    page.locator("#pythonDebugStart").click()
    page.wait_for_function(
        "() => document.querySelector('#pythonDebugOutput').textContent.includes('Exception: LookupError at line 2')",
        timeout=timeout)
    assert "Python debugger: paused" in page.locator("#pythonDebugOutput").inner_text()
    page.locator("#pythonDebugContinue").click()
    page.wait_for_function(
        "() => document.querySelector('#pythonDebugOutput').textContent.includes('Python debugger: done')",
        timeout=timeout)
    assert "Exception: LookupError" not in page.locator("#pythonDebugOutput").inner_text()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", help="Real native /app/ URL; otherwise serve checked-in docs/app locally")
    parser.add_argument("--browser", choices=("chromium", "firefox", "webkit"), default="chromium")
    parser.add_argument("--timeout", type=int, default=180, help="Per-runtime timeout in seconds")
    parser.add_argument("--flow", action="store_true", help="Require real native Flow source execution")
    parser.add_argument("--python-only", action="store_true", help="Skip R only when explicitly requested")
    args = parser.parse_args()
    if args.timeout < 10:
        parser.error("--timeout must be at least 10 seconds")
    if args.flow and not args.url:
        parser.error("--flow requires --url pointing to the running native FlowStudio server")
    if args.url:
        parsed = urlparse(args.url)
        if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "[::1]", "::1"):
            parser.error("--url must use HTTP on a loopback host; never execute source on a remote server")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise SystemExit("Playwright is required: python3 -m pip install playwright") from exc

    from contextlib import nullcontext
    with (nullcontext(args.url) if args.url else static_server()) as url:
        with sync_playwright() as playwright:
            browser = getattr(playwright, args.browser).launch(headless=True)
            try:
                print(f"Browser: {args.browser} {browser.version}")
                page = browser.new_page(accept_downloads=True)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                response = page.goto(url, wait_until="domcontentloaded", timeout=args.timeout * 1000)
                assert response is not None and response.status == 200, f"Cannot load real IDE: {url}"
                assert page.locator("#source").is_visible(), "Source editor did not render"
                test_python(page, args.timeout * 1000)
                print("PASS real browser Pyodide source, console, environment, file, snapshot and notebook")
                if not args.python_only:
                    test_r(page, args.timeout * 1000)
                    print("PASS real browser webR source, console, environment and reset")
                if args.flow:
                    test_flow(page, args.timeout * 1000)
                    print("PASS real browser Flow via native Flow-owned server")
                    if not args.python_only:
                        test_native_r(page, args.timeout * 1000)
                        print("PASS real browser native Rscript source, console, notebook, syntax, environment and reset")
                    test_native_conditional_debugger(page, args.timeout * 1000)
                    print("PASS real browser conditional CPython debugging via native Flow-owned server")
                assert not errors, f"Uncaught browser exceptions: {errors}"
                print(f"PASS {args.browser} physical browser acceptance: {url}")
            finally:
                browser.close()


if __name__ == "__main__":
    main()
