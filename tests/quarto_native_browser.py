#!/usr/bin/env python3
"""Opt-in real Chromium -> Flow HTTP -> installed Quarto -> HTML download acceptance.

Start the actual native FlowStudio server first. This test intentionally never
substitutes a mock Quarto executable, HTTP handler or browser runtime.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import tempfile
from urllib.parse import urlparse


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Native FlowStudio /app/ loopback URL")
    parser.add_argument("--language", choices=("r", "python"), default="r")
    parser.add_argument("--timeout", type=int, default=120, help="Browser deadline in seconds")
    args = parser.parse_args()
    parsed = urlparse(args.url)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1") or parsed.path.rstrip("/") != "/app":
        parser.error("--url must be the native /app/ endpoint on an HTTP loopback host")
    if args.timeout < 60:
        parser.error("--timeout must be at least 60 seconds for real Quarto execution")
    if not shutil.which("quarto"):
        parser.error("installed Quarto CLI is required; this is not a mock acceptance test")
    if args.language == "r" and not shutil.which("Rscript"):
        parser.error("Rscript is required for real R/knitr Quarto acceptance")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        parser.error("Playwright is required: python3 -m pip install playwright")
        raise AssertionError from exc

    marker = "flowstudio-quarto-executed-87421"
    # The marker must not appear literally in echoed source: only executed output can produce it.
    code = ('cat(paste0("flowstudio-quarto-", "executed-87421"))' if args.language == "r"
            else 'print("flowstudio-quarto-" + "executed-87421")')
    source = f"# %% [{args.language}]\n{code}\n"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page(accept_downloads=True)
            response = page.goto(args.url, wait_until="domcontentloaded", timeout=args.timeout * 1000)
            assert response is not None and response.status == 200, "Native IDE did not load"
            assert page.evaluate("globalThis.FlowStudioNativeFlow?.available?.() === true"), "Native Flow HTTP transport is unavailable"
            page.locator("#language").select_option(args.language)
            page.locator("#source").fill(source)
            page.once("dialog", lambda dialog: dialog.accept())
            with page.expect_download(timeout=args.timeout * 1000) as download:
                page.locator("#renderQuarto").click()
            artifact = download.value
            assert artifact.suggested_filename.endswith(".html"), artifact.suggested_filename
            with tempfile.TemporaryDirectory(prefix="flowstudio-quarto-acceptance-") as directory:
                path = Path(directory) / "rendered.html"
                artifact.save_as(path)
                html = path.read_text(encoding="utf-8")
                assert marker in html, "Quarto report does not contain output from executed source"
                assert "<html" in html.lower(), "Downloaded artifact is not HTML"
            assert "Quarto rendered an HTML report" in page.locator("#notice").inner_text(), "UI did not report render completion"
            print(f"PASS real Chromium native FlowStudio {args.language} -> installed Quarto -> executed HTML download")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
