"""Source-contract tests for persistent R/Python SI dispersion interoperability."""
import math
import unittest

from http_dispersion_interop import (
    MAX_FRAME_BYTES, MAX_SOURCE_BYTES, python_source, r_source, valid_records,
)


class DispersionInteropTests(unittest.TestCase):
    def test_seeded_records_and_r_source(self):
        records = valid_records()
        self.assertEqual(len(records), 48)
        self.assertEqual(sum(op == "stddev" for _, op, _, _ in records), 16)
        self.assertEqual(sum(op == "sample_variance" for _, op, _, _ in records), 16)
        self.assertEqual(sum(op == "sample_stddev" for _, op, _, _ in records), 16)
        source = r_source(records)
        self.assertIn("sd(x)", source)
        self.assertIn("var(x)", source)
        self.assertIn("sqrt(mean((x-mean(x))^2))", source)
        self.assertLess(len(source.encode("utf-8")), MAX_SOURCE_BYTES)

    def test_python_exact_oracle_and_corruption(self):
        records = valid_records()
        observed = [expected for _, _, _, expected in records]
        self.assertTrue(all(math.isfinite(x) for x in observed))
        clean = python_source(records, observed)
        corrupt = python_source(records, observed, sabotage=True)
        self.assertNotEqual(clean, corrupt)
        self.assertIn("_disp_fraction.Fraction", clean)
        self.assertIn("dispersion oracle mismatch", clean)
        self.assertLess(len(clean.encode("utf-8")), MAX_SOURCE_BYTES)
        self.assertLess(len(str(observed).encode("utf-8")), MAX_FRAME_BYTES)
        exec(clean, {})
        with self.assertRaisesRegex(AssertionError, "dispersion oracle mismatch"):
            exec(corrupt, {})
        with self.assertRaises(AssertionError):
            python_source(records[:-1], observed)


if __name__ == "__main__":
    unittest.main()
