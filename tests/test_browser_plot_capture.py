import base64
import importlib.util
import json
import pathlib
import unittest

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "docs" / "app" / "plot_capture.py"
spec = importlib.util.spec_from_file_location("flowstudio_plot_capture", MODULE_PATH)
plot_capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plot_capture)
try:
    import matplotlib
except ImportError:
    matplotlib = None


@unittest.skipUnless(matplotlib is not None, "Matplotlib is not installed")
class BrowserPlotCaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        plot_capture.prepare()
        import matplotlib.pyplot as pyplot
        cls.pyplot = pyplot

    def tearDown(self):
        self.pyplot.close("all")

    def test_no_figure_is_empty(self):
        self.assertEqual(plot_capture.capture(), "[]")

    def test_png_round_trip_and_cleanup(self):
        self.pyplot.plot([1, 2, 3], [4, 2, 5])
        plots = json.loads(plot_capture.capture())
        self.assertEqual(len(plots), 1)
        raw = base64.b64decode(plots[0]["png"], validate=True)
        self.assertTrue(raw.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertEqual(self.pyplot.get_fignums(), [])

    def test_figures_are_bounded(self):
        for n in range(plot_capture.MAX_FIGURES + 3):
            self.pyplot.figure()
            self.pyplot.plot([0, 1], [n, n + 1])
        plots = json.loads(plot_capture.capture())
        self.assertEqual(len(plots), plot_capture.MAX_FIGURES)
        self.assertEqual(self.pyplot.get_fignums(), [])

    def test_per_image_limit_is_enforced(self):
        self.pyplot.plot([0, 1])
        previous = plot_capture.MAX_PNG_BYTES
        try:
            plot_capture.MAX_PNG_BYTES = 4
            self.assertEqual(json.loads(plot_capture.capture()), [])
            self.assertEqual(self.pyplot.get_fignums(), [])
        finally:
            plot_capture.MAX_PNG_BYTES = previous

    def test_total_limit_is_enforced(self):
        self.pyplot.plot([0, 1])
        previous = plot_capture.MAX_TOTAL_BYTES
        try:
            plot_capture.MAX_TOTAL_BYTES = 4
            self.assertEqual(json.loads(plot_capture.capture()), [])
        finally:
            plot_capture.MAX_TOTAL_BYTES = previous


if __name__ == "__main__":
    unittest.main()
