#!/bin/sh
# Builds and runs one Flow console entry quickly: flowc, then cc at -O0,
# then the program. `flow run` builds at -O2 and checks the toolchain
# first, which costs most of a second per entry. Usage: flow_quick_run.sh DIR
# where DIR holds main.flow and flowstudio.flow. The program's output sits
# between two marker lines, the way `flow run` prints it, so the server
# keeps only what the program printed. If the quick build fails for a
# reason other than the source, `flow run` builds it the usual way.
dir=$1
marker=----------------------------------------
cd "$dir" || exit 1
if ! command -v flow >/dev/null 2>&1; then
    echo "Process error: flow was not found on PATH."
    exit 127
fi
if ! flow tool compiler/scripts/flowc_emit.flow --strict main.flow main.c 2>flowc.log; then
    # Source errors: show them as flow run would.
    sed "s#$dir/##g" flowc.log
    exit 1
fi
if ! cc -std=c11 -D_DEFAULT_SOURCE -O0 -w main.c -o prog -lm 2>cc.log; then
    exec flow run main.flow
fi
echo "$marker"
./prog
status=$?
echo "$marker"
exit $status
