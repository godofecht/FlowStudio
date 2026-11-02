#!/usr/bin/env python3
"""Execute the checked-in native SI-aware matrix determinants over real HTTP."""
from pathlib import Path

from http_smoke import request, compact_native_math_line
from determinant_oracle import inject_native_assertions, matrix_cases


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    paths = (
        "src/math_dimensions.flow",
        "src/math_expression_ir.flow",
        "src/math_expression_source.flow",
        "src/math_equation.flow",
        "src/math_static.flow",
        "src/math_determinant_smoke.flow",
    )
    source = "\n".join(
        "\n".join(
            compact_native_math_line(line)
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
    assert "native-math-determinants-ok" in source
    base_source = source
    headers = {"X-FlowStudio-Intent": "run"}
    for start, stop in ((0, 21), (21, len(matrix_cases()))):
        source = inject_native_assertions(base_source, start=start, stop=stop)
        status, body = request("POST", "/api/check/flow", source, headers)
        assert status == 200, ("native determinant compile", start, status, body)
        status, body = request("POST", "/api/run/flow", source, headers)
        assert status == 200 and "native-math-determinants-ok" in body, (
            "native determinant execution", start, status, body)
    # Deliberately change one numerical expectation without changing the
    # source program. The real native runtime must propagate HTTP 422.
    tampered = inject_native_assertions(base_source, start=0, stop=21,
                                        sabotage=True)
    status, body = request("POST", "/api/check/flow", tampered, headers)
    assert status == 200, ("tampered determinant must compile", status, body)
    status, body = request("POST", "/api/run/flow", tampered, headers)
    assert status == 422, ("tampered determinant must fail at runtime", status, body)
    print(f"PASS: real native determinant HTTP, {len(matrix_cases())} exact seeded "
          "metamorphic cases and deliberate HTTP 422 numerical failure")


if __name__ == "__main__":
    main()
