# FlowJIT: experimental native arithmetic specialization

FlowStudio's persistent GNU R kernel exposes `flowjit_compile()` and
`flowjit_status()`. This is an **opt-in native C JIT prototype**, not a
general R compiler, a Flow compiler backend, or data-frame optimizer. It is
not RStudio parity.

```r
f <- flowjit_compile(function(x, y) x * x + 2.0 * y, hot = 8L, min_length = 128L)
x <- as.double(seq_len(100000L))
for (i in seq_len(10L)) f(x, x)
flowjit_status(f)
```

The wrapper initially invokes an R byte-compiled copy of the original closure.
At the configured hot threshold it validates the supported expression tree,
generates a C function using the GNU R API, invokes the installed R C toolchain
(`R CMD SHLIB`), dynamically loads its shared library, and invokes it through
`.Call` on eligible inputs. This is actual native execution, not a simulated
JIT. Compilation is bounded to 8 seconds and 16 kernels per R process. When
compilation fails, the original byte-compiled R function remains available
and `flowjit_status(f)$compiler_error` reports the reason.

The accepted source subset is intentionally narrow: one to four required
positional arguments, one arithmetic expression (optionally braced), constant
finite numeric literals, arguments, +, -, and *. No dynamic calls, captures,
classes, loops, mutation, defaults, reflection, indexing, or other operations
are compiled to C. The code generator only handles validated R ASTs.

Native execution requires unnamed, plain, finite double vectors without
attributes, equal lengths or scalar broadcasting, and a minimum vector length.
Input guards and the original function's lexical arithmetic-operator bindings
are checked before acceleration; otherwise the original R closure is called.
Integer, NA, NaN, Inf, classed, matrix, and named-input cases fall back.
Compilation does not silently change the language executed by ordinary R code.

**Semantics:** `flowjit_compile` explicitly establishes a strict, pure
numerical call contract. Its wrapper eagerly evaluates the supplied arguments,
so it is **not equivalent to arbitrary R lazy promises**, or code with effects.
Native floating-point results should be compared against R with appropriate
tolerances; exact bit-level equivalence is not promised for every compiler or
platform. Nothing outside the documented subset is claimed to accelerate.

To verify a genuine compilation and native execution path:

```sh
Rscript --vanilla tests/flowjit_smoke.R
python3 -m unittest discover -s tests -p 'test_native_flowjit.py' -v
```

The native CI job must verify this test with GNU R and a C compiler. General
quality jobs without R can skip it, but skips are not native acceptance.

Future work (not present): measure cold and warm throughput against GNU R, Ř
and FastR; add shape-specialized multiversion recompilation, on-stack
replacement and SIMD; build a Flow IR backend for kernel emission; and optimize
whole R data-wrangling pipelines under explicit semantic guards.
