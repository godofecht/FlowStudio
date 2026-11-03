"""Real mathematical Flow CLI acceptance for scientific literal failure and recovery."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "src" / "math_flow.py"
SOURCE = (ROOT / "examples" / "heat_logical_arrows.flow").read_text(encoding="utf-8")
ANCHOR = "const diffusivity = 0.01m²/s"


def execute(source, *, check=False):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "scientific.flow"
        path.write_text(source, encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(CLI), *(["--check"] if check else []), str(path)],
            cwd=ROOT, capture_output=True, text=True, timeout=45,
        )


class ScientificLiteralProductionAcceptance(unittest.TestCase):
    def test_equivalent_scientific_literals_preserve_heat_solution(self):
        self.assertIn(ANCHOR, SOURCE)
        baseline_run = execute(SOURCE)
        self.assertEqual(baseline_run.returncode, 0, baseline_run.stderr)
        baseline = json.loads(baseline_run.stdout)
        self.assertTrue(baseline["ok"])
        self.assertEqual(baseline["grid"], [32, 32])
        self.assertEqual(baseline["steps"], 100)
        for literal in ("1.e-2", "1.E-2", "10.e-3", "0.01e0", "1e-2"):
            with self.subTest(literal=literal):
                candidate = SOURCE.replace(ANCHOR, f"const diffusivity = {literal}m²/s", 1)
                checked = execute(candidate, check=True)
                self.assertEqual(checked.returncode, 0, checked.stderr)
                first = execute(candidate)
                second = execute(candidate)
                self.assertEqual(first.returncode, 0, first.stderr)
                self.assertEqual(first.stdout, second.stdout)
                result = json.loads(first.stdout)
                self.assertTrue(result["ok"])
                self.assertEqual(result["steps"], baseline["steps"])
                self.assertEqual(result["grid"], baseline["grid"])
                self.assertAlmostEqual(result["mean_temperature"], baseline["mean_temperature"], delta=1e-10)
                self.assertAlmostEqual(result["temperature_variance"], baseline["temperature_variance"], delta=1e-10)

    def test_malformed_exponents_fail_closed_and_clean_cli_recovers(self):
        self.assertIn(ANCHOR, SOURCE)
        for literal in ("1.e+", "1.E-", "1e+", "1e-", "1.e", "1.E"):
            with self.subTest(literal=literal):
                candidate = SOURCE.replace(ANCHOR, f"const diffusivity = {literal}m²/s", 1)
                checked = execute(candidate, check=True)
                self.assertNotEqual(checked.returncode, 0, checked.stdout)
                self.assertIn("malformed scientific exponent", checked.stderr)
                rejected = execute(candidate)
                self.assertNotEqual(rejected.returncode, 0, rejected.stdout)
                recovered = execute(SOURCE)
                self.assertEqual(recovered.returncode, 0, recovered.stderr)
                self.assertTrue(json.loads(recovered.stdout)["ok"])


if __name__ == "__main__":
    unittest.main()
