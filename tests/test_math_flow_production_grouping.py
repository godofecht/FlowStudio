"""Production CLI regressions for balanced PDE expressions and parser recovery."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "src" / "math_flow.py"
SOURCE = (ROOT / "examples" / "heat_logical_arrows.flow").read_text(encoding="utf-8")


def execute(source, *, check=False):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "grouping.flow"
        path.write_text(source, encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(CLI), *(['--check'] if check else []), str(path)],
            cwd=ROOT, capture_output=True, text=True, timeout=45,
        )


class ProductionGroupingAcceptance(unittest.TestCase):
    def test_nested_multiline_grouping_preserves_numerical_result(self):
        original = execute(SOURCE)
        self.assertEqual(original.returncode, 0, original.stderr)
        baseline = json.loads(original.stdout)
        self.assertTrue(baseline["ok"])
        self.assertEqual(baseline["steps"], 100)
        self.assertEqual(baseline["grid"], [32, 32])
        self.assertLess(abs(baseline["mean_temperature"] - 300.005), 1e-9)
        self.assertGreater(baseline["temperature_variance"], 0)
        anchor = "where(((x < 0.5m ⇒ y < 0.5m) ⊻ (x < 0.5m ⇔ y < 0.5m)), 2K/s, 0K/s)"
        self.assertIn(anchor, SOURCE)
        for newline in ("\n", "\r\n", "\r", "\u0085", "\u2028", "\u2029"):
            with self.subTest(newline=repr(newline)):
                multiline = anchor.replace(" ⊻ ", newline + " ⊻ ")
                source = SOURCE.replace(anchor, multiline)
                checked = execute(source, check=True)
                self.assertEqual(checked.returncode, 0, checked.stderr)
                result = execute(source)
                self.assertEqual(result.returncode, 0, result.stderr)
                payload = json.loads(result.stdout)
                self.assertTrue(payload["ok"])
                self.assertEqual(payload["steps"], baseline["steps"])
                self.assertLess(abs(payload["mean_temperature"] - baseline["mean_temperature"]), 1e-11)
                self.assertLess(abs(payload["temperature_variance"] - baseline["temperature_variance"]), 1e-11)

    def test_unbalanced_expressions_rejected_and_next_run_recovers(self):
        variants = (
            SOURCE.replace("temperature = 300K", "temperature = (300K", 1),
            SOURCE.replace("2K/s, 0K/s)", "2K/s, 0K/s))", 1),
            SOURCE.replace("2K/s, 0K/s)", "2K/s, 0K/s", 1),
        )
        for index, source in enumerate(variants):
            with self.subTest(index=index):
                self.assertNotEqual(source, SOURCE)
                invalid = execute(source, check=True)
                self.assertNotEqual(invalid.returncode, 0, invalid.stdout)
                self.assertFalse(invalid.stdout.strip().startswith('{"ok": true'))
                recovered = execute(SOURCE)
                self.assertEqual(recovered.returncode, 0, recovered.stderr)
                self.assertTrue(json.loads(recovered.stdout)["ok"])


if __name__ == "__main__":
    unittest.main()
