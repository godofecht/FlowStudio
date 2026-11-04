"""Production mathematical Flow CLI acceptance for ASCII implication/equivalence.

Uses the checked-in 32x32 RK2 heat PDE, not a mocked expression evaluator.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "examples" / "heat_logical_arrows.flow").read_text(encoding="utf-8")
CLI = ROOT / "src" / "math_flow.py"


def execute(source, *, check=False):
    with tempfile.TemporaryDirectory(prefix="flow-arrows-") as directory:
        path = Path(directory) / "heat.flow"
        path.write_text(source, encoding="utf-8")
        command = [sys.executable, str(CLI)]
        if check:
            command.append("--check")
        command.append(str(path))
        return subprocess.run(command, cwd=ROOT, capture_output=True,
                              text=True, timeout=45)


class ProductionAsciiArrowPDEAcceptance(unittest.TestCase):
    def test_unicode_ascii_and_word_aliases_execute_same_pde(self):
        variants = {
            "unicode": SOURCE,
            "ascii": SOURCE.replace("⇒", "->").replace("⇔", "<->"),
            "words": SOURCE.replace("⇒", "implies").replace("⇔", "iff").replace("⊻", "xor"),
            "mixed": SOURCE.replace("⇒", "->").replace("⇔", "iff"),
        }
        results = {}
        for label, source in variants.items():
            with self.subTest(label=label):
                checked = execute(source, check=True)
                self.assertEqual(checked.returncode, 0, checked.stderr)
                self.assertTrue(json.loads(checked.stdout)["ok"])
                run = execute(source)
                self.assertEqual(run.returncode, 0, run.stderr)
                result = json.loads(run.stdout)
                self.assertTrue(result["ok"])
                self.assertEqual(result["steps"], 100)
                self.assertEqual(result["grid"], [32, 32])
                self.assertLess(abs(result["mean_temperature"] - 300.005), 1e-9)
                self.assertGreater(result["temperature_variance"], 0)
                results[label] = (result["mean_temperature"],
                                  result["temperature_variance"])
        self.assertEqual(len(set(results.values())), 1, results)
        replay = execute(variants["ascii"])
        self.assertEqual(replay.returncode, 0, replay.stderr)
        self.assertEqual(json.loads(replay.stdout)["mean_temperature"],
                         results["ascii"][0])

    def test_malformed_arrows_fail_in_check_and_execution_then_recover(self):
        base = SOURCE.replace("⇒", "->").replace("⇔", "<->")
        self.assertIn("->", base)
        self.assertIn("<->", base)
        malformed = (
            base.replace("->", "-> ->", 1),
            base.replace("<->", "<-> <->", 1),
            base.replace("->", "-> 1 +", 1),
            base.replace("<->", "<-> 1 +", 1),
        )
        for index, source in enumerate(malformed):
            with self.subTest(index=index):
                for check in (True, False):
                    run = execute(source, check=check)
                    self.assertNotEqual(run.returncode, 0,
                                        f"accepted malformed source: {run.stdout}")
                recovery = execute(base)
                self.assertEqual(recovery.returncode, 0, recovery.stderr)
                self.assertLess(
                    abs(json.loads(recovery.stdout)["mean_temperature"] - 300.005),
                    1e-9)


if __name__ == "__main__":
    unittest.main()
