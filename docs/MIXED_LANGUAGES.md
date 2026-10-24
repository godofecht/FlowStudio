# Python + R in one Flow program

FlowStudio's native server is written in Flow. The two persistent interpreter
kernels are callable from the **same Flow function**, without launching a
separate Python or R process per request.

In `src/main.flow`, the actual implementation is:

```flow
function send_mixed_demo() -> void {
    let python_output: string = fs_py_run("print(sum([1, 2, 3, 4, 5]))")
    let python_status: i32 = fs_py_status()
    if python_status != 200 {
        fs_reply(python_status, "text/plain; charset=utf-8", "Python failed: " + python_output)
        return
    }
    let r_code: string = "cat(sqrt(as.numeric('" + python_output + "')))"
    let r_output: string = fs_r_run(r_code)
    let r_status: i32 = fs_r_status()
    if r_status != 200 {
        fs_reply(r_status, "text/plain; charset=utf-8", "R failed: " + r_output)
        return
    }
    fs_reply(200, "text/plain; charset=utf-8", "Python sum = " + python_output + "R sqrt(sum) = " + r_output)
}
```

This calls the real C-backed persistent kernel bridges already used by the
FlowStudio editor; `fs_py_run` and `fs_r_run` are external functions declared
in Flow, not language builtins. The transport and kernel implementations are
linked into the native FlowStudio binary.

## Try it

Install Flow 2.x, a C compiler, Python 3 and Rscript. From the repo root:

```sh
sh scripts/build.sh
./build/flowstudio
```

In another terminal:

```sh
curl -fsS -X POST http://127.0.0.1:8751/api/demo/python-r \\
  -H 'X-FlowStudio-Intent: run' --data ''
python3 tests/http_smoke.py
```

Expected numerical values: Python computes `15`; R computes `sqrt(15)`,
approximately `3.872983`. The smoke test checks the numerical result against
a tolerance and runs only when Rscript is installed. The endpoint is localhost
only and requires the same intent header as the other execution endpoints.

**Scope:** This is a deliberately small, fixed-code *working integration example*,
not general-purpose cross-language object marshaling. The Python-to-R value
passes through a textual scalar. The Python code is fixed and controlled by
FlowStudio; **do not interpolate arbitrary interpreter output into executable R
source**. Production interoperability needs typed serialization, explicit
quoting/validation, structured errors, data-frame/array transfer and session
coordination. The native kernels retain independent namespaces.
