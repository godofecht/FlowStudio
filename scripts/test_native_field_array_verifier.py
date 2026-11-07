"""Strict output-contract regressions; production compiler execution is separate."""
import math
import unittest
try:
    from scripts.verify_native_field_arrays import expected_output, parse_output, verify
except ModuleNotFoundError:
    from verify_native_field_arrays import expected_output, parse_output, verify


def encode(values):
    return ("\n".join(map(str, values)) + "\nfield-multiplier-ok\n").encode()


class NativeFieldArrayVerifierTests(unittest.TestCase):
    def test_reference(self):
        expected = expected_output()
        self.assertEqual(len(expected), 16)
        self.assertAlmostEqual(expected[1], 0.8944, places=12)
        self.assertAlmostEqual(expected[6], 1.1056, places=12)
        self.assertAlmostEqual(expected[11], 0.44, places=12)
        verify(parse_output(encode(expected)), expected)

    def test_each_cell_corruption(self):
        expected = expected_output()
        for index in range(16):
            with self.subTest(cell=index):
                observed = expected.copy()
                observed[index] += 1e-5
                with self.assertRaisesRegex(ValueError, f"cell {index}:"):
                    verify(parse_output(encode(observed)), expected)

    def test_tolerance(self):
        expected = expected_output()
        observed = expected.copy()
        observed[3] += 5e-10
        verify(observed, expected)
        observed[3] += 2e-9
        with self.assertRaisesRegex(ValueError, "cell 3:"):
            verify(observed, expected)

    def test_invalid_output(self):
        expected = expected_output()
        valid = encode(expected)
        cases = [b"", b"field-multiplier-ok\n", valid + b"extra\n",
                 encode(expected[:-1]), valid.replace(b"field-multiplier-ok", b"wrong"),
                 valid.replace(b"0.8944", b"nonnumeric"),
                 valid.replace(b"0.8944", b"nan"),
                 valid.replace(b"0.8944", b"inf"), b"\xff" + valid]
        for payload in cases:
            with self.subTest(payload=payload[:40]), self.assertRaises(ValueError):
                parse_output(payload)

    def test_invalid_oracle_targets_and_tolerances(self):
        expected = expected_output()
        for bad in (math.nan, math.inf, -math.inf):
            target = expected.copy()
            target[7] = bad
            with self.subTest(target=bad), self.assertRaisesRegex(ValueError, "non-finite independent oracle"):
                verify(expected, target)
        for bad in (math.nan, math.inf, -math.inf, -1e-12):
            with self.subTest(tolerance=bad), self.assertRaisesRegex(ValueError, "tolerance must be"):
                verify(expected, expected, tolerance=bad)
        verify(expected, expected, tolerance=0.0)

    def test_nonzero_decimal_underflow_rejected(self):
        expected = expected_output()
        for token in ("1e-9999", "-1e-9999", "0." + "0" * 400 + "1"):
            lines = encode(expected).decode().splitlines()
            lines[0] = token
            with self.subTest(token=token[:24]), self.assertRaisesRegex(ValueError, "underflowed to zero"):
                parse_output(("\n".join(lines) + "\n").encode())
        lines = encode(expected).decode().splitlines()
        lines[0] = "0e-9999"
        self.assertEqual(parse_output(("\n".join(lines) + "\n").encode())[0], 0.0)

    def test_parser_enforces_utf8_byte_budget(self):
        expected = expected_output()
        valid = encode(expected)
        self.assertLess(len(valid), 16384)
        with self.assertRaisesRegex(ValueError, "Flow output exceeded 16 KiB"):
            parse_output(valid + b" " * (16385 - len(valid)))
        with self.assertRaisesRegex(ValueError, "Flow output exceeded 16 KiB"):
            parse_output(b"\\xc3\\xa9" * 8193)

    def test_nonfinite_and_wrong_length(self):
        expected = expected_output()
        with self.assertRaises(ValueError):
            verify(expected[:-1], expected)
        for bad in (math.nan, math.inf, -math.inf):
            observed = expected.copy()
            observed[0] = bad
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                verify(observed, expected)


if __name__ == "__main__":
    unittest.main()
