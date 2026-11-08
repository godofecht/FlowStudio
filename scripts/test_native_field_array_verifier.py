"""Strict output-contract regressions; production compiler execution is separate."""
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
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
            parse_output("é".encode("utf-8") * 8193)

    def test_reject_python_specific_and_padded_numeric_tokens(self):
        expected = expected_output()
        for token in (" 0.5", "0.5 ", "0_5", "0x1p-1", "1j",
                      "Infinity", "+nan", "1,0", "1e", "."):
            lines = encode(expected).decode().splitlines()
            lines[0] = token
            with self.subTest(token=token), self.assertRaisesRegex(
                ValueError, "non-canonical decimal"
            ):
                parse_output(("\n".join(lines) + "\n").encode())

    def test_accept_canonical_decimal_spellings(self):
        expected = expected_output()
        for token, value in (("+5e-1", 0.5), (".5", 0.5),
                             ("5.", 5.0), ("-0.0", -0.0),
                             ("1E+2", 100.0)):
            lines = encode(expected).decode().splitlines()
            lines[0] = token
            with self.subTest(token=token):
                self.assertEqual(parse_output(("\n".join(lines) + "\n").encode())[0], value)

    def test_strict_lf_framing(self):
        valid = encode(expected_output())
        self.assertEqual(len(parse_output(valid)), 16)
        for payload in (
            valid[:-1],
            valid.replace(b"\n", b"\r\n"),
            valid.replace(b"\n", b"\r"),
            valid.replace(b"\n", b"\v"),
            valid.replace(b"\n", b"\f"),
            valid.replace(b"\n", "\u2028".encode("utf-8")),
            valid.replace(b"\n", "\u2029".encode("utf-8")),
            valid.replace(b"\n", b"\xc2\x85"),
        ):
            with self.subTest(payload=payload[:24]), self.assertRaises(ValueError):
                parse_output(payload)

    def test_cli_rejects_invalid_execution_budgets_before_compiler_launch(self):
        verifier = Path(__file__).with_name("verify_native_field_arrays.py")
        invalid = (
            ("--timeout", "0"),
            ("--timeout", "nan"),
            ("--timeout", "301"),
            ("--repeats", "0"),
            ("--repeats", "6"),
            ("--repeats", "1.5"),
            ("--total-timeout", "0"),
            ("--total-timeout", "inf"),
            ("--total-timeout", "301"),
        )
        for flag, value in invalid:
            with self.subTest(flag=flag, value=value):
                result = subprocess.run(
                    [sys.executable, str(verifier), "--flow",
                     str(verifier), flag, value],
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE, timeout=10, check=False,
                )
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertLess(len(result.stderr), 8192)
                self.assertIn(b"error:", result.stderr)

    def test_cli_missing_compiler_fails_without_false_success(self):
        verifier = Path(__file__).with_name("verify_native_field_arrays.py")
        missing = verifier.with_name("__missing_flow_compiler__")
        result = subprocess.run(
            [sys.executable, str(verifier), "--flow", str(missing),
             "--repeats", "2", "--total-timeout", "1"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=10, check=False,
        )
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertNotIn(b"field-array-oracle-passed", result.stdout)
        self.assertIn(b"Flow binary not executable", result.stderr)

    def test_cli_rejects_real_process_success_without_spatial_output(self):
        # An actual executable exiting zero is not evidence of Flow numerics.
        verifier = Path(__file__).with_name("verify_native_field_arrays.py")
        executable = shutil.which("true")
        self.assertIsNotNone(executable)
        result = subprocess.run(
            [sys.executable, str(verifier), "--flow", executable,
             "--repeats", "1", "--timeout", "2", "--total-timeout", "3"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=8, check=False,
        )
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(b"expected 16 numerical values", result.stderr)
        self.assertNotIn(b"field-array-oracle-passed", result.stdout)

    def test_cli_rejects_real_process_failure_without_false_success(self):
        verifier = Path(__file__).with_name("verify_native_field_arrays.py")
        executable = shutil.which("false")
        self.assertIsNotNone(executable)
        result = subprocess.run(
            [sys.executable, str(verifier), "--flow", executable,
             "--repeats", "1", "--timeout", "2", "--total-timeout", "3"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=8, check=False,
        )
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(b"Flow returned", result.stderr)
        self.assertNotIn(b"field-array-oracle-passed", result.stdout)

    def test_cli_enforces_real_process_wall_clock_timeout(self):
        # Exercise process-group termination using a genuine long-lived OS
        # subprocess; this is a negative resource test, not Flow qualification.
        verifier = Path(__file__).with_name("verify_native_field_arrays.py")
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "long_running"
            executable.write_text("#!/bin/sh\nsleep 5\n")
            executable.chmod(0o700)
            result = subprocess.run(
                [sys.executable, str(verifier), "--flow", str(executable),
                 "--repeats", "1", "--timeout", "0.1", "--total-timeout", "1"],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, timeout=8, check=False,
            )
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(b"timed out", result.stderr)
        self.assertNotIn(b"field-array-oracle-passed", result.stdout)

    def test_cli_bounds_real_process_output(self):
        # 'yes' writes indefinitely; the verifier must cap output and kill
        # the process group instead of buffering unbounded data in memory.
        verifier = Path(__file__).with_name("verify_native_field_arrays.py")
        executable = shutil.which("yes")
        if executable is None:
            self.skipTest("system yes utility unavailable")
        result = subprocess.run(
            [sys.executable, str(verifier), "--flow", executable,
             "--repeats", "1", "--timeout", "2", "--total-timeout", "3"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=8, check=False,
        )
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(b"Flow output exceeded 16 KiB", result.stderr)
        self.assertNotIn(b"field-array-oracle-passed", result.stdout)

    def test_cli_rejects_nondeterministic_real_process_output(self):
        # This is a negative CLI contract test. It deliberately uses an OS
        # executable, not the Flow compiler; production qualification is separate.
        verifier = Path(__file__).with_name("verify_native_field_arrays.py")
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "counter"
            executable = Path(directory) / "changing_output"
            values = encode(expected_output()).decode("ascii")
            # A shell executable returns a valid oracle record on the first
            # invocation and a different, still numerically valid spelling on
            # the second. Both outputs pass the numerical oracle individually.
            alternate = values.replace("0.5\n", "5e-1\n", 1)
            self.assertNotEqual(values, alternate)
            executable.write_text(
                "#!/bin/sh\n"
                + "if [ -e '" + str(state) + "' ]; then\n"
                + "cat <<'SECOND'\n" + alternate + "SECOND\n"
                + "else\n"
                + "touch '" + str(state) + "'\n"
                + "cat <<'FIRST'\n" + values + "FIRST\n"
                + "fi\n"
            )
            executable.chmod(0o700)
            result = subprocess.run(
                [sys.executable, str(verifier), "--flow", str(executable),
                 "--repeats", "2", "--timeout", "2", "--total-timeout", "5"],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, timeout=8, check=False,
            )
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(b"nondeterministic Flow output on execution 2", result.stderr)
        self.assertNotIn(b"field-array-oracle-passed", result.stdout)

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
