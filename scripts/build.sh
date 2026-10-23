#!/usr/bin/env sh
# Run from the FlowStudio repository root.
set -eu

command -v flow >/dev/null 2>&1 || {
  echo "Flow 2.x is required: https://github.com/flooooooooooow/flow" >&2
  exit 1
}
command -v cc >/dev/null 2>&1 || {
  echo "A C11 compiler is required" >&2
  exit 1
}

mkdir -p build
cc -std=c11 -Wall -Wextra -Werror -fsyntax-only src/http_bridge.c src/python_session.c
flow tool compiler/scripts/flowc_emit.flow --strict src/main.flow build/flowstudio-generated.c
cc -std=c11 -O2 -pthread build/flowstudio-generated.c src/http_bridge.c src/python_session.c -lm -o build/flowstudio
echo "Built build/flowstudio"
echo "Start it from the repository root: ./build/flowstudio"
