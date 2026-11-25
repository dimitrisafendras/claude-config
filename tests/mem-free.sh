#!/usr/bin/env bash
# mem-free.sh refuses an unknown argument, and without Docker it still ends with the
# result line that the memory-governor mod reads, and stops and quits nothing.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
chk() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2' expected '$3'"; fail=1; }; }

bash "$ROOT/claude/scripts/mem-free.sh" --bogus >/dev/null 2>&1; chk "unknown argument" "$?" "2"

# An empty PATH folder for docker: the script sees no Docker.
mkdir "$T/bin"
OUT=$(PATH="$T/bin:/usr/bin:/bin" MEM_FREE_APPS="$T/none" MEM_FREE_KEEP="$T/none" bash "$ROOT/claude/scripts/mem-free.sh" --apply --apps 2>/dev/null); RC=$?
chk "exit code" "$RC" "0"
chk "result line" "$(printf '%s\n' "$OUT" | tail -1)" "mem-free: stopped 0 docker project(s), quit 0 app(s)"

[ "$fail" = 0 ] && echo "mem-free: ok"
exit "$fail"
