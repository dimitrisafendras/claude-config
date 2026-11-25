#!/usr/bin/env bash
# mem-budget.sh reads MemAvailable, or MemFree when MemAvailable is missing (Git Bash),
# prints one line in the format the memory-governor mod parses, writes nothing to stderr,
# and exits 0 only when there is room. The meminfo file is a sample (MEM_BUDGET_MEMINFO).
# macOS does not read meminfo: the cases are skipped there.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

fail=0
chk() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2' expected '$3'"; fail=1; }; }

if [ "$(uname)" = "Darwin" ]; then
  echo "mem-budget: skipped (macOS does not read meminfo)"
  exit 0
fi

# run <meminfo file>: sets OUT, ERR, RC
run() {
  OUT=$(MEM_BUDGET_MEMINFO="$1" bash "$ROOT/claude/scripts/mem-budget.sh" 2>"$T/err"); RC=$?
  ERR=$(cat "$T/err")
}

# 32000000 kB total = 31250 MB
printf 'MemTotal:       32000000 kB\nMemFree:        16000000 kB\nSwapTotal:      0 kB\n' >"$T/nomemavail"
printf 'MemTotal:       32000000 kB\nMemFree:         1000000 kB\nMemAvailable:   24000000 kB\n' >"$T/withavail"
printf 'MemTotal:       32000000 kB\nMemFree:         3200000 kB\n' >"$T/low"
printf 'MemTotal:       32000000 kB\nMemFree:         1000000 kB\nMemAvailable:    3200000 kB\n' >"$T/lowavail"
: >"$T/empty"

run "$T/nomemavail"
chk "no MemAvailable: free from MemFree" "$(echo "$OUT" | sed -n 's/^free=\([0-9]*\)%.*/\1/p')" "50"
chk "no MemAvailable: total"             "$(echo "$OUT" | sed -n 's/.* total=\([0-9]*\)MB.*/\1/p')" "31250"
chk "no MemAvailable: exit"  "$RC" "0"
chk "no MemAvailable: stderr empty" "$ERR" ""
chk "output is one line" "$(echo "$OUT" | wc -l | tr -d ' ')" "1"
echo "$OUT" | grep -Eq '^free=[0-9]+% total=[0-9]+MB heavy_procs=[0-9]+ room_for_heavy_jobs=[0-9]+ \(floor [0-9]+%, ~[0-9]+MB/job\)$' \
  || { echo "FAIL: output format: '$OUT'"; fail=1; }

run "$T/withavail"
chk "MemAvailable: free from MemAvailable" "$(echo "$OUT" | sed -n 's/^free=\([0-9]*\)%.*/\1/p')" "75"
chk "MemAvailable: exit" "$RC" "0"
chk "MemAvailable: stderr empty" "$ERR" ""

run "$T/low"
chk "low MemFree: free" "$(echo "$OUT" | sed -n 's/^free=\([0-9]*\)%.*/\1/p')" "10"
chk "low MemFree: exit" "$RC" "1"
chk "low MemFree: stderr empty" "$ERR" ""

run "$T/lowavail"
chk "low MemAvailable (MemFree ignored): free" "$(echo "$OUT" | sed -n 's/^free=\([0-9]*\)%.*/\1/p')" "10"
chk "low MemAvailable: exit" "$RC" "1"

run "$T/empty"
chk "empty meminfo: exit" "$RC" "1"
chk "empty meminfo: free" "$(echo "$OUT" | sed -n 's/^free=\([0-9]*\)%.*/\1/p')" "0"

[ "$fail" = 0 ] && echo "mem-budget: all tests passed"
exit "$fail"
