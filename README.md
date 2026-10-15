# FlowStudio

A Flow-first scientific IDE, designed as an independent successor to RStudio with first-class Flow, R and Python workflows.

**Status:** early implementation; **not** RStudio feature parity. The repository contains a Flow-native execution driver and an experimental web workspace. See [docs/PARITY.md](docs/PARITY.md) for verified, partial and missing capabilities.

## Design goals

Flow implements the execution/session core. R and Python are separate processes rather than reimplemented runtimes. The interface should remain useful when R is not installed, while existing R packages continue to work when a local R environment is available.

## Development

Requires the [Flow compiler](https://github.com/flooooooooooow/flow) (macOS arm64 or Linux x86-64). Application code lives in `src/` and browser assets in `web/`.

This codebase is **independently implemented**; it does not incorporate RStudio source code. Respect the licences of R, Python and any optional third-party dependencies.

Implementation and test instructions will be added alongside each runnable slice rather than implying unfinished functionality works.
