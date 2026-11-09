"""Real upstream Flow Field DSL qualification against an independent finite-difference oracle.

FLOW_FIELD_COMPILER=/path/to/flow python3 -m unittest discover -s tests -p 'test_field_dsl_compiler_integration.py'
Without a compiler, this test is explicitly SKIPPED, never counted as qualification.
"""
import math
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_field_dsl_multistep_oracle import evolve


SOURCE = """const alpha: f64 = 0.3
field V : f64[8] on Line
V evolves as laplacian(V) * alpha
boundary V { left = 0.5 right = 1.5 }
field Q : f64[8] on Line
Q evolves as 2 * laplacian(Q)
boundary Q { left = 0.0 right = 0.0 }
function main() -> i32 {
    let v: array<f64, 8> = [0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.5]
    let q: array<f64, 8> = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0]
    let mut vn: array<f64, 8> = [0.0]
    let mut qn: array<f64, 8> = [0.0]
    let mut j: i32 = 0
    while j < 7 {
        V_field_step(v, vn, 0.4)
        Q_field_step(q, qn, 0.1)
        let mut k: i32 = 0
        while k < 8 {
            v[k] = vn[k]
            q[k] = qn[k]
            k = k + 1
        }
        j = j + 1
    }
    j = 0
    while j < 8 {
        println(v[j])
        j = j + 1
    }
    j = 0
    while j < 8 {
        println(q[j])
        j = j + 1
    }
    println("field-multistep-ok")
    return 0
}
"""


class FieldDslCompilerIntegration(unittest.TestCase):
    def test_real_compiler_seven_step_states(self):
        compiler = os.environ.get("FLOW_FIELD_COMPILER") or shutil.which("flow")
        if not compiler:
            self.skipTest("no production Flow compiler installed; qualification unexecuted")
        compiler = str(Path(compiler).resolve())
        self.assertTrue(Path(compiler).is_file(), "compiler executable does not exist")
        with tempfile.TemporaryDirectory(prefix="flow-field-") as directory:
            source = Path(directory) / "field_multistep.flow"
            source.write_text(SOURCE, encoding="utf-8")
            completed = subprocess.run(
                [compiler, "run", str(source)],
                cwd=directory, capture_output=True, text=True, timeout=30,
                check=False,
            )
        self.assertEqual(completed.returncode, 0,
                         f"compiler failed: {completed.stderr[-4000:]}")
        lines = completed.stdout.strip().splitlines()
        self.assertEqual(len(lines), 17, completed.stdout[-4000:])
        self.assertEqual(lines[-1], "field-multistep-ok")
        actual = [float(value) for value in lines[:16]]
        self.assertTrue(all(math.isfinite(value) for value in actual))
        expected_v = evolve([0.5] + [1.0] * 6 + [1.5], 0.3, 0.4, 7, 0.5, 1.5)
        expected_q = evolve([0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0],
                            2.0, 0.1, 7, 0.0, 0.0)
        for index, (observed, expected) in enumerate(zip(actual, expected_v + expected_q)):
            with self.subTest(cell=index):
                self.assertAlmostEqual(observed, expected, delta=1e-9)


if __name__ == "__main__":
    unittest.main()
