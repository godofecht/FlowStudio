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



def test_editor_find(page, timeout: int):
    # Actual textarea selection, capture expansion, whole-word and invalid regex.
    page.locator("#source").fill("cat1 cats cat2")
    page.locator("#findQuery").fill(r"(cat)(\d)")
    page.locator("#findRegex").check()
    page.locator("#replaceText").fill("$2-$1")
    page.locator("#findNext").click()
    selection = page.locator("#source").evaluate(
        "(node) => [node.selectionStart, node.selectionEnd]")
    assert selection == [0, 4], selection
    page.locator("#replaceOne").click()
    assert page.locator("#source").input_value() == "1-cat cats cat2"
    page.locator("#findRegex").uncheck()
    page.locator("#findWholeWord").check()
    page.locator("#findQuery").fill("cat")
    assert "1 matches" in page.locator("#findStatus").inner_text()
    page.locator("#findRegex").check()
    page.locator("#findQuery").fill("(")
    assert "Invalid regular expression" in page.locator("#findStatus").inner_text()
    assert page.locator("#source").input_value() == "1-cat cats cat2"
    page.locator("#findRegex").uncheck()
    page.locator("#findWholeWord").uncheck()
    page.locator("#findQuery").fill("")
    print("PASS: physical browser source regex/whole-word find and capture replacement")


def test_python(page, timeout: int):
    test_editor_find(page, timeout)
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

    # Real Pyodide NumPy snapshot must restore an ndarray, not a list/dict.
    # This scenario is opt-in and cannot be counted as passed without Chromium.
    run_source(page, "python",
               "import numpy as np\nfs_np_snapshot = np.array([[1.25,3],[np.nan,4]], dtype=np.float32)\n"
               "print('numpy snapshot ready')", "numpy snapshot ready", timeout)
    with page.expect_download(timeout=timeout) as numpy_snapshot_info:
        page.locator("#exportSession").click()
    with tempfile.TemporaryDirectory() as folder:
        destination = Path(folder) / "numpy-session.json"
        numpy_snapshot_info.value.save_as(destination)
        import json
        payload = json.loads(destination.read_text(encoding="utf-8"))
        assert payload["format"] == "flowstudio-session-v2", payload
        entry = next(item for item in payload["variables"] if item["name"] == "fs_np_snapshot")
        assert entry["restoreAs"] == "numpy", entry
        assert entry["dtype"] == "float32", entry
        assert entry["value"]["kind"] == "table", entry
        page.locator("#reset").click()
        page.once("dialog", lambda dialog: dialog.accept())
        page.locator("#sessionFile").set_input_files(str(destination))
        page.wait_for_function(
            "document.querySelector('#notice').textContent.startsWith('Imported ')",
            timeout=timeout)
        run_console(page, "python",
                    "import numpy as np; "
                    "assert type(fs_np_snapshot) is np.ndarray; "
                    "assert fs_np_snapshot.dtype == np.dtype('float32'); "
                    "assert fs_np_snapshot.shape == (2,2); "
                    "assert fs_np_snapshot[0,1] == 3; "
                    "assert np.isnan(fs_np_snapshot[1,0]); "
                    "print('numpy snapshot restored')",
                    "numpy snapshot restored", timeout)
    print("PASS: physical Chromium real NumPy ndarray session snapshot restoration")

    # Execute actual notebook cells in order in the same interpreter.
    page.locator("#source").fill("# %% [python]\nfs_nb = 11\n# %% [python]\nprint(fs_nb * 4)\n")
    page.locator("#runNotebook").click()
    page.wait_for_function("document.querySelector('#notice').textContent === 'Notebook executed 2 cells.'",
                           timeout=timeout)
    assert "44" in page.locator("#notebookOutput").inner_text()

    # Real Pyodide must skip an earlier failing cell when running from the caret.
    page.locator("#source").fill(
        "# %% [python]\nraise RuntimeError('must not execute')\n"
        "# %% [python]\nprint('cursor-only-python-47')\n")
    page.locator("#source").evaluate(
        "(node) => {const pos = node.value.indexOf('print('); node.setSelectionRange(pos, pos);}")
    page.locator("#runFromCell").click()
    page.wait_for_function(
        "document.querySelector('#notice').textContent === 'Notebook executed 1 cells from cursor.'",
        timeout=timeout)
    assert "cursor-only-python-47" in page.locator("#notebookOutput").inner_text()

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
    # Real webR must skip an earlier failing R cell when running from the caret.
    page.locator("#source").fill(
        "# %% [r]\nstop('must not execute')\n"
        "# %% [r]\ncat('cursor-only-r-47')\n")
    page.locator("#source").evaluate(
        "(node) => {const pos = node.value.indexOf('cat('); node.setSelectionRange(pos, pos);}")
    page.locator("#runFromCell").click()
    page.wait_for_function(
        "document.querySelector('#notice').textContent === 'Notebook executed 1 cells from cursor.'",
        timeout=timeout)
    assert "cursor-only-r-47" in page.locator("#notebookOutput").inner_text()
    # Real Pyodide -> real webR and back: typed missing values must survive.
    # This is opt-in physical-browser acceptance, never a mocked-kernel pass.
    run_source(page, "python",
               "fs_py_missing = [1, None, 2.5]\nprint('missing Python ready')",
               "missing Python ready", timeout)
    page.locator("#transferDirection").select_option("python-to-r")
    page.locator("#transferSource").fill("fs_py_missing")
    page.locator("#transferDestination").fill("fs_r_missing")
    page.locator("#transferVariable").click()
    page.wait_for_function(
        "() => document.querySelector('#notice').textContent.includes('Transferred fs_py_missing to fs_r_missing')",
        timeout=timeout)
    run_console(page, "r",
                "stopifnot(identical(fs_r_missing, c(1, NA_real_, 2.5))); cat('missing R accepted')",
                "missing R accepted", timeout)
    run_source(page, "r",
               "fs_r_labels <- c('@NA@', NA_character_, 'é')\ncat('R labels ready')",
               "R labels ready", timeout)
    page.locator("#transferDirection").select_option("r-to-python")
    page.locator("#transferSource").fill("fs_r_labels")
    page.locator("#transferDestination").fill("fs_py_labels")
    page.locator("#transferVariable").click()
    page.wait_for_function(
        "() => document.querySelector('#notice').textContent.includes('Transferred fs_r_labels to fs_py_labels')",
        timeout=timeout)
    run_console(page, "python",
                "assert fs_py_labels == ['@NA@', None, 'é']; print('missing Python accepted')",
                "missing Python accepted", timeout)
    # Exact pandas DataFrame -> actual webR data.frame -> Python dictionary.
    # Pyodide's existing loadPackagesFromImports loads pandas for this source.
    run_source(page, "python",
               "import pandas as pd\n"
               "fs_py_pd = pd.DataFrame({'score': pd.Series([1.25, None, 2.5], dtype='Float64'), "
               "'flag': pd.Series([True, None, False], dtype='boolean'), "
               "'label': pd.Series(['@NA@', None, 'é'], dtype='string')})\n"
               "print('pandas browser ready')",
               "pandas browser ready", timeout)
    page.locator("#transferDirection").select_option("python-to-r")
    page.locator("#transferSource").fill("fs_py_pd")
    page.locator("#transferDestination").fill("fs_r_pd")
    page.locator("#transferVariable").click()
    page.wait_for_function(
        "() => document.querySelector('#notice').textContent.includes('Transferred fs_py_pd to fs_r_pd')",
        timeout=timeout)
    run_console(page, "r",
                "stopifnot(is.data.frame(fs_r_pd), "
                "identical(names(fs_r_pd), c('score','flag','label')), "
                "identical(fs_r_pd$score, c(1.25, NA_real_, 2.5)), "
                "identical(fs_r_pd$flag, c(TRUE, NA, FALSE)), "
                "identical(fs_r_pd$label, c('@NA@', NA_character_, 'é'))); "
                "cat('pandas R accepted')",
                "pandas R accepted", timeout)
    page.locator("#transferDirection").select_option("r-to-python")
    page.locator("#transferSource").fill("fs_r_pd")
    page.locator("#transferDestination").fill("fs_py_pd_roundtrip")
    page.locator("#transferVariable").click()
    page.wait_for_function(
        "() => document.querySelector('#notice').textContent.includes('Transferred fs_r_pd to fs_py_pd_roundtrip')",
        timeout=timeout)
    run_console(page, "python",
                "assert fs_py_pd_roundtrip == {'score':[1.25,None,2.5], "
                "'flag':[True,None,False], 'label':['@NA@',None,'é']}; "
                "print('pandas browser roundtrip accepted')",
                "pandas browser roundtrip accepted", timeout)
    # Real webR -> real Pyodide pandas, not a dictionary or mocked import.
    run_console(page, "r",
                "fs_r_pd$missing <- c(NA_real_, NA_real_, NA_real_); cat('typed R ready')",
                "typed R ready", timeout)
    page.locator("#transferAsPandas").check()
    page.locator("#transferSource").fill("fs_r_pd")
    page.locator("#transferDestination").fill("fs_py_pd_typed")
    page.locator("#transferVariable").click()
    page.wait_for_function(
        "() => document.querySelector('#notice').textContent.includes('Transferred fs_r_pd to fs_py_pd_typed (4 table columns as pandas DataFrame)')",
        timeout=timeout)
    run_console(page, "python",
                "import pandas as pd; "
                "assert type(fs_py_pd_typed) is pd.DataFrame; "
                "assert list(fs_py_pd_typed.columns) == ['score','flag','label','missing']; "
                "assert list(map(str,fs_py_pd_typed.dtypes)) == ['Float64','boolean','string','Float64']; "
                "assert fs_py_pd_typed['score'].isna().tolist() == [False,True,False]; "
                "assert fs_py_pd_typed['label'].tolist()[0] == '@NA@'; "
                "assert fs_py_pd_typed['missing'].isna().all(); "
                "print('real pandas destination accepted')",
                "real pandas destination accepted", timeout)
    page.locator("#transferAsPandas").uncheck()
    # Actual NumPy ndarray -> webR numeric vector, preserving a typed NA.
    # This is a physical-browser assertion; adding it is not evidence of a pass.
    run_source(page, "python",
               "import numpy as np\nfs_py_np = np.array([1.25, np.nan, 2.5], dtype=np.float32)\n"
               "print('numpy browser ready')", "numpy browser ready", timeout)
    page.locator("#transferDirection").select_option("python-to-r")
    page.locator("#transferSource").fill("fs_py_np")
    page.locator("#transferDestination").fill("fs_r_np")
    page.locator("#transferVariable").click()
    page.wait_for_function(
        "() => document.querySelector('#notice').textContent.includes('Transferred fs_py_np to fs_r_np')",
        timeout=timeout)
    run_console(page, "r",
                "stopifnot(identical(fs_r_np, c(1.25, NA_real_, 2.5))); "
                "cat('numpy R accepted')", "numpy R accepted", timeout)
    # Physical-browser acceptance for real Unicode ndarray <-> webR character vectors.
    # These assertions remain unexecuted until Playwright runs against real CDNs.
    run_source(page, "python",
               "fs_py_unicode = np.array(['café', '東京', '🙂'], dtype='U4')\n"
               "print('numpy Unicode ready')", "numpy Unicode ready", timeout)
    page.locator("#transferDirection").select_option("python-to-r")
    page.locator("#transferSource").fill("fs_py_unicode")
    page.locator("#transferDestination").fill("fs_r_unicode")
    page.locator("#transferVariable").click()
    page.wait_for_function(
        "() => document.querySelector('#notice').textContent.includes('Transferred fs_py_unicode to fs_r_unicode')",
        timeout=timeout)
    run_console(page, "r",
                "stopifnot(identical(fs_r_unicode, c('café','東京','🙂'))); cat('unicode R accepted')",
                "unicode R accepted", timeout)
    page.locator("#transferDirection").select_option("r-to-python")
    page.locator("#transferAsNumpy").check()
    page.locator("#transferSource").fill("fs_r_unicode")
    page.locator("#transferDestination").fill("fs_py_unicode_back")
    page.locator("#transferVariable").click()
    page.wait_for_function(
        "() => document.querySelector('#notice').textContent.includes('Transferred fs_r_unicode to fs_py_unicode_back')",
        timeout=timeout)
    run_console(page, "python",
                "assert type(fs_py_unicode_back) is np.ndarray and fs_py_unicode_back.dtype.kind == 'U'; "
                "assert fs_py_unicode_back.tolist() == ['café','東京','🙂']; print('unicode NumPy accepted')",
                "unicode NumPy accepted", timeout)
    run_source(page, "r",
               "fs_r_unicode_missing <- c('safe', NA_character_)\ncat('missing Unicode ready')",
               "missing Unicode ready", timeout)
    page.locator("#transferSource").fill("fs_r_unicode_missing")
    page.locator("#transferDestination").fill("fs_py_unicode_missing")
    page.locator("#transferVariable").click()
    page.wait_for_function(
        "() => document.querySelector('#notice').textContent.includes('nonmissing boolean/string')",
        timeout=timeout)
    run_console(page, "python",
                "assert 'fs_py_unicode_missing' not in globals(); print('missing Unicode rejected')",
                "missing Unicode rejected", timeout)
    page.locator("#transferAsNumpy").uncheck()
    # Real webR factor provenance must survive a downloaded session snapshot.
    # This is opt-in physical acceptance, not a mocked interpreter pass.
    run_source(page, "r",
               "fs_r_factor <- factor(c('low',NA_character_,'high','low'), "
               "levels=c('low','middle','high'), ordered=TRUE)\n"
               "cat('R factor ready')", "R factor ready", timeout)
    with page.expect_download(timeout=timeout) as factor_snapshot_info:
        page.locator("#exportSession").click()
    with tempfile.TemporaryDirectory() as folder:
        destination = Path(folder) / "r-factor-session.json"
        factor_snapshot_info.value.save_as(destination)
        import json
        payload = json.loads(destination.read_text(encoding="utf-8"))
        assert payload["format"] == "flowstudio-session-v2", payload
        entry = next(item for item in payload["variables"] if item["name"] == "fs_r_factor")
        assert entry["restoreAs"] == "factor", entry
        assert entry["factor"] == {"levels":["low","middle","high"],"ordered":True}, entry
        assert entry["value"]["values"] == ["low",None,"high","low"], entry
        page.locator("#reset").click()
        page.once("dialog", lambda dialog: dialog.accept())
        page.locator("#sessionFile").set_input_files(str(destination))
        page.wait_for_function(
            "document.querySelector('#notice').textContent.startsWith('Imported ')",
            timeout=timeout)
        run_console(page, "r",
                    "stopifnot(is.ordered(fs_r_factor), "
                    "identical(levels(fs_r_factor), c('low','middle','high')), "
                    "identical(as.character(fs_r_factor), "
                    "c('low',NA_character_,'high','low'))); cat('R factor restored')",
                    "R factor restored", timeout)
    print("PASS: physical Chromium real webR ordered factor snapshot restoration")
    # Nondefault R data.frame row names and factor columns must survive together.
    # This is an opt-in live-runtime assertion, not evidence of a passing browser.
    run_source(page, "r",
               "fs_r_named <- data.frame(rating=factor(c('low','high'), "
               "levels=c('low','middle','high'), ordered=TRUE), "
               "score=c(1.25,2.5), row.names=c('alpha','βeta'))\n"
               "cat('R named frame ready')", "R named frame ready", timeout)
    with page.expect_download(timeout=timeout) as named_snapshot_info:
        page.locator("#exportSession").click()
    with tempfile.TemporaryDirectory() as folder:
        destination = Path(folder) / "r-named-frame-session.json"
        named_snapshot_info.value.save_as(destination)
        import json
        payload = json.loads(destination.read_text(encoding="utf-8"))
        entry = next(item for item in payload["variables"] if item["name"] == "fs_r_named")
        assert entry["restoreAs"] == "dataframe", entry
        assert entry["rowNames"] == ["alpha","βeta"], entry
        assert entry["factorColumns"] == [
            {"name":"rating","levels":["low","middle","high"],"ordered":True}], entry
        page.locator("#reset").click()
        page.once("dialog", lambda dialog: dialog.accept())
        page.locator("#sessionFile").set_input_files(str(destination))
        page.wait_for_function(
            "document.querySelector('#notice').textContent.startsWith('Imported ')",
            timeout=timeout)
        run_console(page, "r",
                    "stopifnot(is.ordered(fs_r_named$rating), "
                    "identical(rownames(fs_r_named),c('alpha','βeta')), "
                    "identical(levels(fs_r_named$rating),c('low','middle','high'))); "
                    "cat('R named frame restored')", "R named frame restored", timeout)
    print("PASS: physical Chromium real webR row-name snapshot restoration")
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
               "score=c(42L, NA_integer_))\ncat('native table ready 42\\n')",
               "native table ready 42", timeout)
    page.get_by_role("button", name="View fs_native_frame as table").click()
    page.get_by_role("heading", name="Snapshot: fs_native_frame").wait_for(timeout=timeout)
    assert "alpha" in page.locator("#workspace").inner_text()
    assert "beta" in page.locator("#workspace").inner_text()

    # Real Chromium -> Flow-owned table route -> persistent GNU R: traverse
    # all four 50-row UI pages and fetch the unsampled 201-251 kernel slice.
    run_source(page, "r",
               "fs_native_paged <- data.frame(n=seq_len(251))\n"
               "cat('native paging ready 42\\n')",
               "native paging ready 42", timeout)
    page.get_by_role("button", name="View fs_native_paged as table").click()
    table_view = page.locator("#workspace [aria-label='Environment table snapshot']")
    table_view.wait_for(timeout=timeout)
    assert "loaded rows 1-200 of 251" in table_view.inner_text()
    next_page = table_view.get_by_role("button", name="Next page")
    for first_row in (51, 101, 151):
        next_page.click()
        page.wait_for_function(
            "first => document.querySelector('[aria-label=\"Environment table snapshot\"] [role=\"status\"]').textContent.includes('loaded rows 1-200 of 251, page ' + ((first - 1) / 50 + 1) + '/4')",
            arg=first_row, timeout=timeout)
    next_page.click()
    page.wait_for_function(
        "() => document.querySelector('[aria-label=\"Environment table snapshot\"] [role=\"status\"]').textContent.includes('loaded rows 201-251 of 251')",
        timeout=timeout)
    assert table_view.get_by_role("cell", name="201", exact=True).count() == 1
    assert table_view.get_by_role("cell", name="251", exact=True).count() == 0
    # CSV export is intentionally only the loaded 51-row slice, not 251 rows.
    with page.expect_download(timeout=timeout) as paged_csv:
        table_view.get_by_role("button", name="Export loaded CSV").click()
    with tempfile.TemporaryDirectory() as folder:
        csv_path = Path(folder) / "paged.csv"
        paged_csv.value.save_as(csv_path)
        import csv
        with csv_path.open(newline="", encoding="utf-8-sig") as stream:
            rows = list(csv.reader(stream))
        assert rows[0] == ["n"], rows[:1]
        assert len(rows) == 52 and rows[1] == ["201"] and rows[-1] == ["251"], (
            len(rows), rows[:2], rows[-2:])
    # Actual Chromium -> native Flow HTTP -> persistent Rscript -> CSV download.
    # All rows are preview values, not full-fidelity R serialization.
    with page.expect_download(timeout=timeout) as all_preview_csv:
        table_view.get_by_role("button", name="Export R preview rows").click()
    with tempfile.TemporaryDirectory() as folder:
        csv_path = Path(folder) / "all-preview.csv"
        all_preview_csv.value.save_as(csv_path)
        with csv_path.open(newline="", encoding="utf-8-sig") as stream:
            rows = list(csv.reader(stream))
        assert len(rows) == 252 and rows[0] == ["n"], len(rows)
        assert rows[1] == ["1"] and rows[200] == ["200"] and rows[-1] == ["251"]
    assert "Not a raw dataset export" in table_view.inner_text()
    table_view.get_by_role("button", name="Previous page").click()
    page.wait_for_function(
        "() => document.querySelector('[aria-label=\"Environment table snapshot\"] [role=\"status\"]').textContent.includes('loaded rows 1-200 of 251, page 4/4')",
        timeout=timeout)
    assert table_view.get_by_role("cell", name="200", exact=True).count() == 1
    # Direct row seek uses a real offset rather than traversing every page.
    table_view.get_by_role("textbox", name="Jump to R row").fill("251")
    table_view.get_by_role("button", name="Go to row").click()
    page.wait_for_function(
        """() => document.querySelector('[aria-label="Environment table snapshot"] [role="status"]').textContent.includes('loaded rows 251-251 of 251')""",
        timeout=timeout)
    assert table_view.get_by_role("cell", name="251", exact=True).count() == 1
    table_view.get_by_role("button", name="Previous page").click()
    page.wait_for_function(
        """() => document.querySelector('[aria-label="Environment table snapshot"] [role="status"]').textContent.includes('loaded rows 1-200 of 251, page 4/4')""",
        timeout=timeout)
    # Native installed-library inventory must come from Rscript, not webR.
    page.locator("#listPackages").click()
    page.locator("#packages table[aria-label='Installed R packages']").wait_for(timeout=timeout)
    assert "stats" in page.locator("#packages").inner_text()
    assert page.locator("#installPackage").is_enabled()
    assert page.locator("#loadRPackage").is_enabled()
    assert page.locator("#removeRPackage").is_enabled()
    assert page.locator("#updateRPackage").is_enabled()
    # A preinstalled base package gives deterministic no-network acceptance.
    page.locator("#packageName").fill("stats")
    page.locator("#installPackage").click()
    page.get_by_text("Package installation completed", exact=False).wait_for(timeout=timeout)
    page.locator("#loadRPackage").click()
    page.get_by_text("Installed R package loaded", exact=False).wait_for(timeout=timeout)
    # Confirming removal of a system package must fail in the real R kernel.
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator("#removeRPackage").click()
    page.get_by_text("system packages cannot be removed", exact=False).wait_for(timeout=timeout)
    # Updating a system package is also rejected without reaching CRAN.
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator("#updateRPackage").click()
    page.get_by_text("system packages cannot be updated", exact=False).wait_for(timeout=timeout)
    # Real Rscript PDF device -> Flow plot endpoint -> browser plot history.
    run_source(page, "r",
               "plot(c(1, 2, 3))\ncat('native SVG ready 42\\n')",
               "native SVG ready 42", timeout)
    plot_image = page.locator("#workspace img[alt^='R plot'], #workspace embed[aria-label^='R plot']").first
    plot_image.wait_for(timeout=timeout)
    assert plot_image.get_attribute("src").startswith(
        ("data:image/svg+xml;", "data:application/pdf;"))
    assert page.locator("#workspace a[download$='.svg'], #workspace a[download$='.pdf']").count() > 0

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



def test_native_r_expression_debugger(page, timeout: int):
    # Real DOM -> Flow-owned HTTP -> C IPC -> persistent Rscript AST evaluator.
    page.locator("#rDebugPanel summary").click()
    page.locator("#language").select_option("r")
    page.locator("#rRuntime").select_option("native")
    page.locator("#source").fill(
        "fs_r_browser_step <- 40L\nfs_r_browser_step <- fs_r_browser_step + 2L\ncat(fs_r_browser_step)")
    page.locator("#rDebugStart").click()
    page.wait_for_function(
        "() => document.querySelector('#rDebugOutput').textContent.includes('Next expression at line 1')",
        timeout=timeout)
    page.locator("#rDebugStep").click()
    page.wait_for_function(
        "() => document.querySelector('#rDebugOutput').textContent.includes('Next expression at line 2')",
        timeout=timeout)
    page.locator("#rDebugWatch").fill("fs_r_browser_step + 2L")
    page.locator("#rDebugEvaluate").click()
    page.wait_for_function(
        "() => { const text = document.querySelector('#rDebugOutput').textContent; return text.includes('Next expression at line 2') && text.includes('Output:\\n[1] 42'); }",
        timeout=timeout)
    for next_line in (3,):
        page.locator("#rDebugStep").click()
        page.wait_for_function(
            "line => document.querySelector('#rDebugOutput').textContent.includes('Next expression at line ' + line)",
            arg=next_line, timeout=timeout)
    page.locator("#rDebugStep").click()
    page.wait_for_function(
        "() => document.querySelector('#rDebugOutput').textContent.includes('R expression debugger: done')",
        timeout=timeout)
    assert "Output:\n42" in page.locator("#rDebugOutput").inner_text()
    page.locator("#rDebugStop").click()
    page.wait_for_function(
        "() => document.querySelector('#rDebugOutput').textContent.includes('R expression debugger: idle')",
        timeout=timeout)
    page.locator("#source").fill(
        "fs_r_browser_continue <- 40L\nfs_r_browser_continue <- fs_r_browser_continue + 2L\ncat(fs_r_browser_continue)")
    page.locator("#rDebugStart").click()
    page.wait_for_function(
        "() => document.querySelector('#rDebugOutput').textContent.includes('Next expression at line 1')",
        timeout=timeout)
    page.locator("#rDebugTargetLine").fill("3")
    page.locator("#rDebugContinue").click()
    page.wait_for_function(
        "() => document.querySelector('#rDebugOutput').textContent.includes('Next expression at line 3')",
        timeout=timeout)
    page.locator("#rDebugTargetLine").fill("")
    page.locator("#rDebugContinue").click()
    page.wait_for_function(
        "() => document.querySelector('#rDebugOutput').textContent.includes('R expression debugger: done')",
        timeout=timeout)
    assert "Output:\n42" in page.locator("#rDebugOutput").inner_text()
    page.locator("#rDebugStop").click()
    page.wait_for_function(
        "() => document.querySelector('#rDebugOutput').textContent.includes('R expression debugger: idle')",
        timeout=timeout)

    # Conditional R breakpoint: line 2 fails at zero; line 3 matches at one.
    page.locator("#source").fill(
        "fs_r_browser_condition <- 0L\n"
        "fs_r_browser_condition <- fs_r_browser_condition + 1L\n"
        "fs_r_browser_condition <- fs_r_browser_condition + 1L\n"
        "cat(fs_r_browser_condition)")
    page.locator("#rDebugStart").click()
    page.wait_for_function(
        "() => document.querySelector('#rDebugOutput').textContent.includes('Next expression at line 1')",
        timeout=timeout)
    page.locator("#rDebugTargetLine").fill(
        "2?fs_r_browser_condition>=1,3?fs_r_browser_condition>=1")
    page.locator("#rDebugContinue").click()
    page.wait_for_function(
        "() => document.querySelector('#rDebugOutput').textContent.includes('Next expression at line 3')",
        timeout=timeout)
    page.locator("#rDebugTargetLine").fill("")
    page.locator("#rDebugContinue").click()
    page.wait_for_function(
        "() => document.querySelector('#rDebugOutput').textContent.includes('R expression debugger: done')",
        timeout=timeout)
    assert "Output:\n2" in page.locator("#rDebugOutput").inner_text()
    page.locator("#rDebugStop").click()
    page.wait_for_function(
        "() => document.querySelector('#rDebugOutput').textContent.includes('R expression debugger: idle')",
        timeout=timeout)


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
                        test_native_r_expression_debugger(page, args.timeout * 1000)
                        print("PASS real browser native Rscript expression stepping")
                    test_native_conditional_debugger(page, args.timeout * 1000)
                    print("PASS real browser conditional CPython debugging via native Flow-owned server")
                assert not errors, f"Uncaught browser exceptions: {errors}"
                print(f"PASS {args.browser} physical browser acceptance: {url}")
            finally:
                browser.close()


if __name__ == "__main__":
    main()
