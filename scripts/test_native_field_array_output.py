"""Fail-closed tests for external production Field DSL numerical output."""
import math
import unittest

from scripts.verify_native_field_arrays import expected_output, parse_output, verify


class FieldArrayOutputTests(unittest.TestCase):
    def test_independent_expected_arrays(self):
        values = expected_output()
        self.assertEqual(len(values), 16)
        self.assertAlmostEqual(values[1], 0.8944, places=12)
        self.assertAlmostEqual(values[6], 1.1056, places=12)
        self.assertAlmostEqual(values[11], 0.44, places=12)

    def test_valid_output_and_precision(self):
        values = expected_output()
        encoded = ("\n".join(format(v, ".17g") for v in values)
                   + "\nfield-multiplier-ok\n").encode()
        verify(parse_output(encoded), values)

    def test_reject_missing_cells_and_bad_marker(self):
        for raw in (b"", b"field-multiplier-ok\n",
                    b"0\n" * 16 + b"wrong-marker\n",
                    b"0\n" * 15 + b"field-multiplier-ok\n"):
            with self.subTest(raw=raw[:32]), self.assertRaises(ValueError):
                parse_output(raw)

    def test_reject_nonfinite_nonnumeric_and_invalid_utf8(self):
        for bad in ("nan", "inf", "-inf", "abc", "1,2"):
            raw = (bad + "\n" + "0\n" * 15 + "field-multiplier-ok\n").encode()
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse_output(raw)
        with self.assertRaises(ValueError):
            parse_output(b"\xff")

    def test_reject_corrupted_cells(self):
        expected = expected_output()
        for index in range(16):
            corrupted = expected.copy()
            corrupted[index] += 1e-5
            with self.subTest(index=index), self.assertRaises(ValueError):
                verify(corrupted, expected)
        corrupted = expected.copy()
        corrupted[0] = math.nan
        with self.assertRaises(ValueError):
            verify(corrupted, expected)


if __name__ == "__main__":
    unittest.main()
