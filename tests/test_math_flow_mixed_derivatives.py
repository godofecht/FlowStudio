"""Compact Unicode mixed derivatives execute through the real typed PDE runtime."""
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from math_flow import FlowMathError, parse, simulate
from math_flow_expr import ExpressionError, TEMPERATURE, evaluate, parse_expression

NESTED = (ROOT / "examples/heat_cross_diffusion.flow").read_text(encoding="utf-8")
COMPACT = (ROOT / "examples/heat_cross_diffusion_compact.flow").read_text(encoding="utf-8")


class MixedDerivativeTest(unittest.TestCase):
    def test_aliases_are_canonical_typed_ast_and_match_discrete_fourier(self):
        import numpy as np
        n = 32
        x, y = np.meshgrid((np.arange(n) + .5) / n,
                           (np.arange(n) + .5) / n, indexing="ij")
        field = 300 + 10 * np.sin(2 * math.pi * (x + y))
        expected = -10 * (n * math.sin(2 * math.pi / n))**2 * np.sin(2 * math.pi * (x + y))
        for source in ("∂ₓᵧ(temperature)", "∂ᵧₓ(temperature)",
                       "∂ₓ(∂ᵧ(temperature))", "∂ᵧ(∂ₓ(temperature))"):
            with self.subTest(source=source):
                expression = parse_expression(source, symbols={"temperature": TEMPERATURE})
                self.assertEqual(expression.dimension, (-2, 0, 0, 1))
                if source in ("∂ₓᵧ(temperature)", "∂ᵧₓ(temperature)"):
                    self.assertEqual(expression.operator, "∂ₓᵧ")
                np.testing.assert_allclose(
                    evaluate(expression, x, y, values={"temperature": field}),
                    expected, atol=1e-10, rtol=0)

    def test_full_equation_ast_and_rk2_equivalence(self):
        import numpy as np
        baseline = simulate(parse(NESTED))
        for source in (COMPACT, COMPACT.replace("∂ₓᵧ", "∂ᵧₓ"),
                       NESTED.replace("∂ₓ(∂ᵧ(temperature))", "∂ᵧ(∂ₓ(temperature))")):
            with self.subTest(source=source[source.index("dynamics"):source.index("initial")]):
                result = simulate(parse(source))
                np.testing.assert_allclose(
                    result["spatial"]["fields"]["temperature"],
                    baseline["spatial"]["fields"]["temperature"],
                    rtol=0, atol=1e-10)
                self.assertAlmostEqual(result["temperature_variance"],
                                       baseline["temperature_variance"], places=10)
                roles = [term["role"] for term in result["semantic_trace"]["stages"][0]["terms"]]
                self.assertIn("crossDiffusion", roles)

    def test_rejects_incompatible_dimensions_and_boundaries(self):
        with self.assertRaises(ExpressionError):
            parse_expression("∂ₓᵧ(temperature) + 1K",
                             symbols={"temperature": TEMPERATURE})
        with self.assertRaises(FlowMathError):
            parse(COMPACT.replace("boundaries = Periodic", "boundaries = Dirichlet(300K)"))
        with self.assertRaises(FlowMathError):
            parse(COMPACT.replace("∂ₓᵧ(temperature)", "∂ₓ²(temperature)"))

    def test_checked_in_program_runs_as_cli(self):
        run = subprocess.run(
            [sys.executable, "src/math_flow.py", "examples/heat_cross_diffusion_compact.flow"],
            cwd=ROOT, text=True, capture_output=True, timeout=45)
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["steps"], 100)
        self.assertIn("temperature", result["spatial"]["fields"])


if __name__ == "__main__":
    unittest.main()
