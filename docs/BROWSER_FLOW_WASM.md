# Flow execution on GitHub Pages

The workbench runs Flow programs in a Web Worker. The Flow compiler itself is
compiled to WebAssembly from its canonical bootstrap C. It emits C from the
editor buffer. Browser builds of Clang and LLD compile and link that C into a
WASI WebAssembly program, which executes in the same worker.

The first run downloads about 65 MB of compiler and runtime assets. Later runs
use the browser HTTP cache. Submitted source stays in the browser. GitHub Pages
serves static files and receives no execution requests.
The page versions its scripts by commit and addresses the compiler assets by
their toolchain fingerprint, keeping cached releases separate.

The backend menu calls this path "C to WebAssembly". MLIR execution needs a
browser build of the MLIR lowering toolchain and is unavailable in this build.
The installed local app retains its C and MLIR backends.

## Supported and bounded behavior

The browser acceptance suite executes arithmetic, loops, UTF-8 output and a
standard-library import. It also runs the checked-in Field multiplier program
and compares all 16 output cells with the independent Python oracle.

Each run starts a fresh worker and virtual filesystem with the pinned Flow
standard library. Source is limited to 128 KiB, generated C to 4 MiB, and stdout
to 64 KiB. Loading has a 120-second deadline, compilation has 30 seconds per
stage, and program execution has 1.5 seconds. The generated program's linear
memory is capped at 512 MiB. Timeout terminates the worker.
The next run starts a new one. Invalid source, linker errors and nonzero program
exits return failures.

Native services such as the OS terminal, Python/R embedding, graphics libraries
and operating-system processes require their own browser runtime adapters.
Imports whose generated C needs those services can fail during compilation or
linking. Other local project files are outside this worker's filesystem.
Process RSS profiling is unavailable under WASI. This target has separate
qualification from the installed app.

## Build and verify

Install Emscripten 5.0.0, Node and the project dependencies, then run:

```sh
npm ci
npm run build:pages
npx playwright install chromium
npm run test:pages
```

`scripts/browser-flow/toolchain.lock.json` pins the Flow compiler and standard
library, the Clang/LLD Wasm binaries and the host adapter by commit and SHA-256.
Downloads fail on checksum mismatch. The build compiles the Flow compiler with
Emscripten and publishes provenance and the original licences with the assets.
Flow uses its own licence. The Clang host adapter has Apache and LLVM licence
notices, including the UTF-8 adapter changes made here.

`npm run test:pages` serves the generated artifact under `/FlowStudio/` and runs
real Chromium. It checks both entry points, actual compiled output, numerical
results, errors, bounded output, timeout recovery and clean browser logs.
