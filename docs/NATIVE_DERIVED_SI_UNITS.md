# Native mathematical Flow: derived SI quantities

The executable native mathematical source parser accepts numeric literals with
the following **case-sensitive** unit suffixes. They lower to typed
`MathInstruction` literals and are checked by `evaluate_math_ir`,
`infer_math_ir`, and the native equation-system runtime.

| Suffix | Quantity | Length | Mass | Time | Temperature |
| --- | --- | ---: | ---: | ---: | ---: |
| `Pa` | pascal, pressure | -1 | 1 | -2 | 0 |
| `Hz` | hertz, frequency | 0 | 0 | -1 | 0 |
| `N` | newton, force | 1 | 1 | -2 | 0 |
| `J` | joule, energy | 2 | 1 | -2 | 0 |
| `W` | watt, power | 2 | 1 | -3 | 0 |

The existing base units `m`, `s`, `kg`, and `K` remain supported. This
is **not** a complete SI unit system: the current native dimensional model
tracks only length, mass, time, and temperature. It does not model electric
current, amount of substance, luminous intensity, SI prefixes, implicit
multiplication, unit conversions, or arbitrary compound suffixes.

These expressions execute through the native parser/compiler/runtime:

```text
2Pa * 3m * 1m = 6N
4N * 2m = 8J
6J / 3s = 2W
2Hz * 3s = 6
0.5 * 2kg * (3m / 1s)^2 = 9J
2Pa / 1m = 2N / 1m³
```

The source parser preserves UTF-8 byte offsets, including for malformed
expressions and dimensional mismatches. `1Pa+1N` is rejected because pressure
and force have different dimensions. Static inference can validate
`1Pa/0m` while numerical execution rejects division by zero.

Run the checked-in analytic regression with the pinned upstream Flow 2.0
compiler:

```sh
flow run src/math_derived_units_smoke.flow
flow run src/math_expression_source_http_smoke.flow
python3 src/math_flow.py --check examples/navier_stokes_smoke.flow
python3 src/math_flow.py examples/navier_stokes_smoke.flow
python3 scripts/verify_native.py --require-r
```

The CI workflow runs these checks on Linux and macOS. The native HTTP smoke
also executes the derived-unit expressions in the real Flow server, and Ubuntu
Chromium acceptance exercises the native workbench. The checked-in
Navier–Stokes program remains on the separate Python/NumPy mathematical
dialect; it is **not** yet executed by the native Flow PDE compiler. Upstream
grammar integration, general tensor/PDE ASTs, arbitrary-rank inference, and
computed multidimensional visualization remain incomplete.

## Executable scaled SI suffixes

The native source parser also lowers these **explicitly supported** prefixed
literals to coherent SI values, including in dimensional inference, equations,
production HTTP compilation, and the workbench:

| Literal | Stored value | Stored dimension |
| --- | ---: | --- |
| `1km` | 1000 | length |
| `1cm` | 0.01 | length |
| `1mm` | 0.001 | length |
| `1ms` | 0.001 | time |
| `1µm` or `1μm` | 0.000001 | length |
| `1µs` or `1μs` | 0.000001 | time |
| `1kPa` | 1000 | pressure |
| `1kHz` | 1000 | frequency |
| `1kN` | 1000 | force |
| `1kJ` | 1000 | energy |
| `1kW` | 1000 | power |

Both the micro sign (U+00B5) and Greek small mu (U+03BC) are recognized in
these two suffixes, and UTF-8 source byte offsets are preserved. Bare `m`
remains metre, `ms` is millisecond, and `kg` remains kilogram. Unit
symbols are case-sensitive; arbitrary prefix/unit combinations, conversions,
and general compound unit grammars are not yet implemented.

The native assertions include `1km=1000m`,
`2kPa*3m*1m=6000N`, and `2kHz*500µs=1`. These are executed by
`flow run src/math_derived_units_smoke.flow` and the production HTTP
smoke, not merely recognized by editor highlighting.
