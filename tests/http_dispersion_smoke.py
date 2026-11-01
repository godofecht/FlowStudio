#!/usr/bin/env python3
"""Compile and execute SI dispersion in the actual native Flow HTTP runtime."""
from pathlib import Path

from http_smoke import request, compact_native_math_line


def bundled_source(root: Path) -> str:
    paths = (
        "src/math_dimensions.flow",
        "src/math_expression_ir.flow",
        "src/math_expression_source.flow",
        "src/math_dispersion_http_smoke.flow",
    )
    source = "\n".join(
        "\n".join(
            compact_native_math_line(line)
            for line in (root / path).read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
            and not line.startswith("import .math_dimensions {")
            and not line.startswith("import .math_expression_ir {")
            and not line.startswith("import .math_expression_source {")
        )
        for path in paths
    )
    assert len(source.encode("utf-8")) <= 131072, "Native HTTP source exceeds 128 KiB"
    return source


def verify_dispersion() -> None:
    source = bundled_source(Path(__file__).resolve().parents[1])
    headers = {"X-FlowStudio-Intent": "run"}
    status, body = request("POST", "/api/check/flow", source, headers)
    assert status == 200, ("dispersion compile", status, body)
    status, body = request("POST", "/api/run/flow", source, headers)
    assert status == 200 and "native-math-dispersion-http-ok" in body, (
        "dispersion numerical execution", status, body)

    marker = "dispersion_close(result.result.value,2.0)"
    assert source.count(marker) == 1
    corrupted = source.replace(marker, "dispersion_close(result.result.value,2.5)", 1)
    status, body = request("POST", "/api/check/flow", corrupted, headers)
    assert status == 200, ("corrupted dispersion compile", status, body)
    status, body = request("POST", "/api/run/flow", corrupted, headers)
    assert status == 422, ("corrupted dispersion must fail", status, body)
    print("PASS: SI sample variance and standard deviations through native HTTP; "
          "five numerical/negative cases, corrupted expectation HTTP 422")


if __name__ == "__main__":
    verify_dispersion()
