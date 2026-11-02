#!/usr/bin/env python3
"""Compile and execute native variadic SI reductions through production HTTP."""
from pathlib import Path

from http_smoke import request, compact_native_math_line
from variadic_oracle import inject_variadic_assertions, variadic_cases
from unicode_variadic_oracle import inject_unicode_variadic_assertions, unicode_variadic_cases
from http_robust_statistics_smoke import verify_robust_statistics
from http_quantile_smoke import verify_quantiles
from http_finite_difference_smoke import verify_finite_differences


def bundled_source(root: Path) -> str:
    paths = (
        "src/math_dimensions.flow",
        "src/math_expression_ir.flow",
        "src/math_expression_source.flow",
        "src/math_equation.flow",
        "src/math_static.flow",
        "src/math_variadic_reductions_smoke.flow",
    )
    return "\n".join(
        "\n".join(
            compact_native_math_line(line, tighten_math_ops=True)
            for line in (root / path).read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
            if not line.startswith("import .math_dimensions {")
            and not line.startswith("import .math_expression_ir {")
            and not line.startswith("import .math_expression_source {")
            and not line.startswith("import .math_equation {")
            and not line.startswith("import .math_static {")
        )
        for path in paths
    )


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    base_source = bundled_source(root)
    assert "native-math-variadic-ok" in base_source
    headers = {"X-FlowStudio-Intent": "run"}
    # Preserve all 48 independent ASCII cases while respecting the actual
    # 128 KiB production HTTP request budget as the native parser grows.
    for start in (0, 24):
        source = inject_variadic_assertions(base_source, start=start, stop=start + 24)
        status, body = request("POST", "/api/check/flow", source, headers)
        assert status == 200, ("variadic source compile", start, status, body)
        status, body = request("POST", "/api/run/flow", source, headers)
        assert status == 200 and "native-math-variadic-ok" in body, (
            "variadic native execution", start, status, body)

    # Sabotage only the first independently computed integer expectation.
    # Production compilation must still succeed, execution must fail closed.
    tampered = inject_variadic_assertions(base_source, sabotage=True, start=0, stop=24)
    assert tampered != inject_variadic_assertions(base_source, start=0, stop=24)
    status, body = request("POST", "/api/check/flow", tampered, headers)
    assert status == 200, ("tampered source must compile", status, body)
    status, body = request("POST", "/api/run/flow", tampered, headers)
    assert status == 422, ("tampered native execution must fail", status, body)
    # Preserve all 48 independently seeded Unicode cases and SI inference
    # assertions. Split real HTTP compilation into four bounded 12-case
    # batches instead of silently dropping coverage as the parser grows.
    for start in (0, 12, 24, 36):
        unicode_source = inject_unicode_variadic_assertions(
            base_source, start=start, stop=start + 12)
        status, body = request("POST", "/api/check/flow", unicode_source, headers)
        assert status == 200, ("Unicode source compile", start, status, body)
        status, body = request("POST", "/api/run/flow", unicode_source, headers)
        assert status == 200 and "native-math-variadic-ok" in body, (
            "Unicode native execution", start, status, body)

    unicode_tampered = inject_unicode_variadic_assertions(
        base_source, sabotage=True, start=0, stop=12)
    assert unicode_tampered != inject_unicode_variadic_assertions(
        base_source, start=0, stop=12)
    status, body = request("POST", "/api/check/flow", unicode_tampered, headers)
    assert status == 200, ("tampered Unicode source must compile", status, body)
    status, body = request("POST", "/api/run/flow", unicode_tampered, headers)
    assert status == 422, ("tampered Unicode native execution must fail", status, body)
    verify_robust_statistics()
    verify_quantiles()
    verify_finite_differences()
    print(f"PASS: native SI reductions over real HTTP, 50 baseline "
          f"+ {len(variadic_cases())} ASCII and "
          f"{len(unicode_variadic_cases())} Unicode seeded cases, "
          f"both with deliberate HTTP 422")


if __name__ == "__main__":
    main()
