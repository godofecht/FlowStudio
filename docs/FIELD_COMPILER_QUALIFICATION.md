# Field compiler qualification

These checks execute upstream Field DSL lowering and compare every output cell
with an independent finite-difference oracle. They are separate from the pinned
FlowStudio native build qualification.

```sh
python3 scripts/verify_native_field_arrays.py --flow /path/to/flow
FLOW_FIELD_COMPILER=/path/to/flow python3 -m unittest discover -s tests \
  -p 'test_field_dsl_compiler_integration.py' -v
```

The first command compiles and executes the two-step fixture twice. It uses
Flow's public strict C emitter, links the generated C with the host compiler,
then reads the native executable's stdout. Compiler logs have a separate output
channel. Runtime output must contain exactly 16 decimal cell values and the
success marker. Values use 17 significant digits.

The second command checks seven time steps on two fields with different
diffusion coefficients. Its adjacent one-line boundaries also exercise
[upstream issue #1730](https://github.com/flooooooooooow/flow/issues/1730).
A compiler with that parser bug fails qualification. Blank lines are not
inserted to conceal the counterexample.

The compiler and runtime share the requested wall-clock budget. Each process
runs in an isolated process group. Runtime output and diagnostic streams are
bounded at 16 KiB. Compiler artifacts have a separate 64 MiB file limit.
`CC` selects the C compiler as an argument vector.

`--executable /path/to/native-fixture` checks an existing program. Process fault
injection tests use that mode to test rejection and timeout behavior. They do
not establish compiler qualification.

This gate covers one-dimensional scalar diffusion with fixed boundaries. It
does not qualify general mathematical grammar, tensor lowering or native
Navier-Stokes execution required by issue #198.
