# Persistent kernel staging (2026-10-19)

This branch stages a real POSIX Python/R subprocess bridge and workers from an earlier integration branch, plus native tests. The build script now compiles and links the C bridge, but the Flow HTTP dispatcher is NOT wired to persistent sessions. Native Flow compilation of this branch, R execution, HTTP acceptance and macOS validation remain unverified. Do not merge as a completed persistent-session feature. These kernels execute trusted local code with the user's OS permissions.
