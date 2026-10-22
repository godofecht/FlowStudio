"""Resource bounds and figure-isolation regressions for the browser plot helper."""
import base64
import importlib.util
import json
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / "docs/app/plot_capture.py"
spec = importlib.util.spec_from_file_location("flowstudio_plot_capture", MODULE)
plot_capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plot_capture)
plot_capture.prepare()
import matplotlib.pyplot as plt


class PlotCaptureLimitsTests(unittest.TestCase):
    def tearDown(self):
        plt.close("all")

    def test_limited_buffer_refuses_overflow_before_writing(self):
        output = plot_capture._LimitedBuffer(5)
        output.write(b"abc")
        with self.assertRaises(OverflowError):
            output.write(b"def")
        self.assertEqual(output.getvalue(), b"abc")

    def test_oversized_png_is_skipped_and_figure_closed(self):
        plt.figure().add_subplot().plot([0, 1], [0, 1])
        original = plot_capture.MAX_PNG_BYTES
        try:
            plot_capture.MAX_PNG_BYTES = 8
            self.assertEqual(json.loads(plot_capture.capture()), [])
            self.assertEqual(plt.get_fignums(), [])
        finally:
            plot_capture.MAX_PNG_BYTES = original

    def test_broken_figure_does_not_hide_other_figures(self):
        bad = plt.figure()
        def broken(*args, **kwargs):
            raise RuntimeError("renderer failed")
        bad.savefig = broken
        good = plt.figure()
        good.add_subplot().plot([0, 1, 2], [2, 1, 4])
        images = json.loads(plot_capture.capture())
        self.assertEqual([item["number"] for item in images], [good.number])
        self.assertTrue(base64.b64decode(images[0]["png"]).startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertEqual(plt.get_fignums(), [])

    def test_total_budget_applies_during_encoding(self):
        plt.figure().add_subplot().plot([0, 1], [0, 1])
        original = plot_capture.MAX_TOTAL_BYTES
        try:
            plot_capture.MAX_TOTAL_BYTES = 16
            self.assertEqual(json.loads(plot_capture.capture()), [])
            self.assertEqual(plt.get_fignums(), [])
        finally:
            plot_capture.MAX_TOTAL_BYTES = original


if __name__ == "__main__":
    unittest.main()
