"""Data frames are visible to the Data view with their shape.

The pandas check uses a stand-in type whose module is pandas.core.frame, so
the test runs without pandas; CI also installs pandas and checks the real one.
R uses the real kernel functions through Rscript when R is available.
"""
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import python_kernel  # noqa: E402


class FakeFrame:
    shape = (7, 3)


FakeFrame.__name__ = "DataFrame"
FakeFrame.__module__ = "pandas.core.frame"


class InspectFrames(unittest.TestCase):
    def inspect(self, namespace):
        return {v["name"]: v for v in json.loads(python_kernel.inspect_namespace(namespace))["variables"]}

    def test_dataframe_reports_shape_without_iteration(self):
        found = self.inspect({"sales": FakeFrame(), "n": 3})
        self.assertEqual(found["sales"]["type"], "DataFrame")
        self.assertEqual(found["sales"]["dimensions"], [7, 3])
        self.assertNotIn("dimensions", found["n"])

    def test_same_name_outside_pandas_is_not_a_frame(self):
        class DataFrame:
            shape = (1, 1)
        found = self.inspect({"mine": DataFrame()})
        self.assertNotIn("dimensions", found["mine"])

    def test_real_pandas_when_installed(self):
        try:
            import pandas
        except ImportError:
            self.skipTest("pandas not installed")
        found = self.inspect({"df": pandas.DataFrame({"a": [1, 2], "b": ["x", "y"]})})
        self.assertEqual(found["df"]["dimensions"], [2, 2])

    @unittest.skipUnless(shutil.which("Rscript"), "R not installed")
    def test_r_data_frame_and_tibble_like_subclass(self):
        script = (
            'source_lines <- readLines("src/r_kernel.R");'
            'start <- grep("^inspect_value <- function", source_lines);'
            'end <- grep("^inspect_workspace <- function", source_lines) - 1L;'
            'json_quote <- function(x) paste0("\\"", x, "\\"");'
            'eval(parse(text = source_lines[start:end]));'
            'b <- new.env(); b$nodes <- 0L; b$truncated <- FALSE;'
            'cat(inspect_value("cars", head(mtcars, 4), 0L, b), "\\n");'
            'tb <- structure(head(iris, 6), class = c("tbl_df", "tbl", "data.frame"));'
            'cat(inspect_value("tb", tb, 0L, b), "\\n")'
        )
        out = subprocess.run(["Rscript", "--vanilla", "-e", script], cwd=ROOT,
                             capture_output=True, text=True, timeout=60, check=True).stdout
        cars, tb = [json.loads(line) for line in out.strip().splitlines()]
        self.assertEqual((cars["type"], cars["dimensions"]), ("data.frame", [4, 11]))
        self.assertEqual((tb["type"], tb["dimensions"]), ("data.frame", [6, 5]))


if __name__ == "__main__":
    unittest.main()
