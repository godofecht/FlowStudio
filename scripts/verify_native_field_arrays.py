#!/usr/bin/env python3
"""Run a real Flow compiler and compare its complete field arrays to an independent oracle.

Usage: python3 scripts/verify_native_field_arrays.py --flow /path/to/flow
The strict emitter produces C, the host C compiler links it, and only the
resulting program's stdout is parsed. --executable accepts a native fixture
that has already been compiled. The supplied compiler must support Field DSL
multiplier lowering.
"""
from __future__ import annotations

import argparse
import math
import os
from pathlib import Path
import resource
import re
import signal
import shlex
import subprocess
import sys
import tempfile
import time

try:
    from scripts.test_field_multiplier_oracle import step
except ModuleNotFoundError:
    from test_field_multiplier_oracle import step

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "src" / "field_multiplier_differential.flow"
MAX_OUTPUT = 16384
DECIMAL_TOKEN = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", re.ASCII)


def parse_output(data: bytes) -> list[float]:
    if len(data) > MAX_OUTPUT:
        raise ValueError("Flow output exceeded 16 KiB")
    try:
        decoded = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise ValueError("Flow emitted non-UTF-8 output") from exc
    if not decoded:
        raise ValueError("expected 16 numerical values and success marker, got 0 lines")
    # splitlines() accepts CR, VT and Unicode separators, hiding malformed
    # transport records. The compiler contract requires LF-only framing.
    if not decoded.endswith("\n") or any(ch in decoded for ch in ("\r", "\v", "\f", "\x85", "\u2028", "\u2029")):
        raise ValueError("Flow emitted noncanonical line framing")
    lines = decoded[:-1].split("\n")
    if len(lines) != 17 or lines[-1] != "field-multiplier-ok":
        raise ValueError(f"expected 16 numerical values and success marker, got {len(lines)} lines")
    if any(DECIMAL_TOKEN.fullmatch(line) is None for line in lines[:-1]):
        raise ValueError("Flow emitted a non-canonical decimal spatial cell")
    try:
        values = [float(line) for line in lines[:-1]]
    except ValueError as exc:
        raise ValueError("Flow emitted a non-numerical spatial cell") from exc
    # float() silently rounds tiny nonzero decimal values to zero. Reject
    # that loss of information instead of accepting a zero oracle cell.
    from decimal import Decimal, InvalidOperation
    for index, (token, value) in enumerate(zip(lines[:-1], values)):
        try:
            exact = Decimal(token)
        except InvalidOperation as exc:
            raise ValueError(f"cell {index}: invalid decimal output") from exc
        if exact.is_finite() and exact != 0 and value == 0:
            raise ValueError(f"cell {index}: nonzero compiler output underflowed to zero")
    if not all(math.isfinite(x) for x in values):
        raise ValueError("Flow emitted non-finite spatial cells")
    return values


def expected_output() -> list[float]:
    v = [0.5, 1., 1., 1., 1., 1., 1., 1.5]
    q = [0., 0., 0., 1., 0., 0., 0., 0.]
    for _ in range(2):
        v = step(v, 0.3, 0.4, 0.5, 1.5)
        q = step(q, 2., 0.1, 0., 0.)
    return v + q


def run_command(argv: list[str], timeout: float, *, file_limit: int = MAX_OUTPUT + 1) -> bytes:
    # File-backed streams avoid unbounded PIPE buffering on compiler errors.
    # RLIMIT_FSIZE applies to both stdout and stderr on Linux/macOS.
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        def limit_output() -> None:
            resource.setrlimit(resource.RLIMIT_FSIZE, (file_limit, file_limit))

        process = subprocess.Popen(
            argv,
            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=output,
            stderr=errors, start_new_session=True, preexec_fn=limit_output,
        )
        try:
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired as exc:
                raise ValueError("Flow compiler/runtime timed out") from exc
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        size = output.seek(0, os.SEEK_END)
        error_size = errors.seek(0, os.SEEK_END)
        if size > MAX_OUTPUT:
            raise ValueError("Flow output exceeded 16 KiB")
        if error_size > MAX_OUTPUT:
            raise ValueError("Flow stderr exceeded 16 KiB")
        if process.returncode != 0:
            errors.seek(0)
            output.seek(0)
            raise ValueError(
                f"Flow returned {process.returncode}: "
                + errors.read(2048).decode("utf-8", errors="replace")
                + output.read(2048).decode("utf-8", errors="replace")
            )
        output.seek(0)
        return output.read()


def run_executable(binary: Path, timeout: float) -> bytes:
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError(f"Flow binary not executable: {binary}")
    return run_command([str(binary)], timeout)


def compile_and_run(binary: Path, fixture: Path, timeout: float) -> bytes:
    """Use the public strict emitter, link its C, then read only program stdout."""
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError(f"Flow binary not executable: {binary}")
    deadline = time.monotonic() + timeout

    def remaining() -> float:
        value = deadline - time.monotonic()
        if value <= 0:
            raise ValueError("Flow compiler/runtime timed out")
        return value

    with tempfile.TemporaryDirectory(prefix="flow-field-native-") as directory:
        generated = Path(directory) / "program.c"
        executable = Path(directory) / "program"
        # Compiler artifacts need a larger file budget than runtime logs.
        # Captured stdout and stderr retain the independent 16 KiB limits.
        run_command([str(binary), "tool", "compiler/scripts/flowc_emit.flow", "--strict",
                     str(fixture.resolve()), str(generated)], remaining(), file_limit=64 * 1024 * 1024)
        if not generated.is_file() or generated.stat().st_size == 0:
            raise ValueError("Flow compiler produced no C artifact")
        cc = shlex.split(os.environ.get("CC", "cc"))
        if not cc:
            raise ValueError("CC must name a C compiler")
        run_command([*cc, "-std=c11", "-O2", str(generated), "-lm", "-o", str(executable)],
                    remaining(), file_limit=64 * 1024 * 1024)
        return run_executable(executable, remaining())


def run_flow(binary: Path, timeout: float) -> bytes:
    return compile_and_run(binary, FIXTURE, timeout)


def verify(actual: list[float], expected: list[float], tolerance: float = 1e-9) -> None:
    if not math.isfinite(tolerance) or tolerance < 0:
        raise ValueError("tolerance must be finite and nonnegative")
    if len(actual) != len(expected):
        raise ValueError("spatial array length mismatch")
    for index, (observed, target) in enumerate(zip(actual, expected)):
        if not math.isfinite(target):
            raise ValueError(f"cell {index}: non-finite independent oracle value")
        if not math.isfinite(observed) or abs(observed - target) > tolerance:
            raise ValueError(
                f"cell {index}: compiler={observed!r}, independent_oracle={target!r}"
            )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--flow", type=Path, help="Flow CLI used for strict compilation")
    source.add_argument("--executable", type=Path, help="already compiled native fixture")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--repeats", type=int, default=2,
                        help="independent production executions; 1-5 (default: 2)")
    parser.add_argument("--total-timeout", type=float, default=120.0,
                        help="cumulative wall-clock budget in seconds, maximum 300")
    args = parser.parse_args()
    if not math.isfinite(args.timeout) or not 0 < args.timeout <= 300:
        parser.error("timeout must be finite and in (0, 300]")
    if not 1 <= args.repeats <= 5:
        parser.error("repeats must be between 1 and 5")
    if not math.isfinite(args.total_timeout) or not 0 < args.total_timeout <= 300:
        parser.error("total-timeout must be finite and in (0, 300]")
    try:
        reference = expected_output()
        first_output = None
        deadline = time.monotonic() + args.total_timeout
        for repetition in range(args.repeats):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError("cumulative Flow compiler/runtime timeout exceeded")
            runner = run_flow if args.flow else run_executable
            output = runner((args.flow or args.executable).resolve(), min(args.timeout, remaining))
            actual = parse_output(output)
            verify(actual, reference)
            if first_output is not None and output != first_output:
                raise ValueError(f"nondeterministic Flow output on execution {repetition + 1}")
            first_output = output
            # The global budget includes parsing, independent oracle evaluation,
            # comparison and subprocess execution.
            if time.monotonic() > deadline:
                raise ValueError("cumulative Flow compiler/runtime timeout exceeded")
    except (ValueError, OSError) as exc:
        print(f"field-array-oracle-failed: {exc}", file=sys.stderr)
        return 1
    print(f"field-array-oracle-passed: 16 real compiler cells, two steps, two coefficients, {args.repeats} independent executions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
