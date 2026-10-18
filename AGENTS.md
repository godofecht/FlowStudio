# FlowStudio contributor and release directive

Follow the account-wide [public repository standard](https://github.com/godofecht/GithubResources/blob/master/PUBLIC_REPOSITORY_STANDARD.md). In particular, every public repo needs a working GitHub Pages site, `VERSION`, tagged release, packaging, CI, README, licence decision and accessible documentation.

FlowStudio is an **experimental Flow-native local IDE**, not a production RStudio replacement. Never promote compatibility claims on the basis of mocked tests. `python3 scripts/verify_native.py` must build the real Flow router and run against the live server. The CI workflow qualifies Linux x86-64 and macOS arm64, exercising actual Flow and Python execution before uploading packages. Missing required compilers/builds must fail CI.

Keep `VERSION`, release notes, Pages and packages aligned. Publishing should occur only after all CI jobs pass on `main`. Do not expose code execution publicly: Pages serves static documentation only; the native HTTP process binds to localhost.
