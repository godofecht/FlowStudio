"""Production PDE CLI acceptance for leading-decimal and scientific literals."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "src" / "math_flow.py"
SOURCE = (ROOT / "examples" / "heat_logical_arrows.flow").read_text(encoding="utf-8")


def run_source(source, check=False):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "numeric.flow"
        path.write_text(source, encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(CLI), *(["--check"] if check else []), str(path)],
            cwd=ROOT, capture_output=True, text=True, timeout=45,
        )


class ProductionLiteralAcceptance(unittest.TestCase):
    def test_equivalent_literals_execute_same_heat_solution(self):
        variants = (
            SOURCE,
            SOURCE.replace("0.5m", ".5m").replace("0.01s", ".01s"),
            SOURCE.replace("0.5m", ".5e0m").replace("0.01s", ".1e-1s"),
            SOURCE.replace("0.01m²/s", ".1e-1m²/s").replace("0.5m", ".5E+0m"),
        )
        results = []
        for index, source in enumerate(variants):
            with self.subTest(index=index):
                checked = run_source(source, check=True)
                self.assertEqual(checked.returncode, 0, checked.stderr)
                executed = run_source(source)
                self.assertEqual(executed.returncode, 0, executed.stderr)
                payload = json.loads(executed.stdout)
                self.assertTrue(payload["ok"])
                self.assertEqual(payload["steps"], 100)
                self.assertEqual(payload["grid"], [32, 32])
                self.assertLess(abs(payload["mean_temperature"] - 300.005), 1e-9)
                self.assertGreater(payload["temperature_variance"], 0)
                results.append(payload["mean_temperature"])
        for value in results[1:]:
            self.assertLess(abs(value - results[0]), 1e-11)

    def test_invalid_exponents_fail_closed_through_cli(self):
        for invalid in (".5e+m", ".5e-m", ".5e", ".5E+"):
            with self.subTest(invalid=invalid):
                source = SOURCE.replace("0.5m", invalid, 1)
                result = run_source(source, check=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(result.stdout.strip().startswith('{"ok": true'))

    def test_source_byte_budget_including_multibyte_literals(self):
        oversized = SOURCE + ("# π" * 100000)
        result = run_source(oversized, check=True)
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
