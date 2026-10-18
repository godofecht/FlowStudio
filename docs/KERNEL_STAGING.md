# Persistent kernel staging (2026-10-19)

This branch stages a real POSIX Python/R subprocess bridge and workers from an earlier integration branch, plus native tests. The Flow HTTP dispatcher and build script are NOT wired to these files. Native Flow compilation, R execution, HTTP acceptance and macOS validation are unverified. Do not merge as a completed persistent-session feature. These kernels execute trusted local code with the user's OS permissions.
