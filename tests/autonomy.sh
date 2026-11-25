#!/usr/bin/env bash
# autonomy.sh: check/off/on (the kill switch), stamp, status (schedule, last and next run)
# and run (prints the prompt with no frontmatter; refuses when off). A temp HOME, fixture
# routines, a fixed clock (AUTONOMY_NOW) and TZ=UTC0 keep it the same on every machine.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
S="$ROOT/claude/scripts/autonomy.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home" "$T/routines"
cat >"$T/routines/day-loop.md" <<'EOF'
---
name: day-loop
description: A test loop.
schedule: "0 9 * * 1-5"   # 09:00 Monday to Friday
skills: [none]
---

1. First step of the prompt.
2. Last step.
EOF
cat >"$T/routines/two-times.md" <<'EOF'
---
name: two-times
description: Two schedules.
schedule: ["15 8 * * 1-5", "0 18 * * *"]
skills: []
---
Body of two-times.
EOF
cat >"$T/routines/sunday.md" <<'EOF'
---
name: sunday
description: Sunday at 02:30.
schedule: "30 2 * * 0"
skills: []
---
Body.
EOF
cat >"$T/routines/often.md" <<'EOF'
---
name: often
description: Every 20 minutes.
schedule: "*/20 * * * *"
skills: []
---
Body.
EOF
echo "# not a loop" >"$T/routines/README.md"

fail=0
chk() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2' expected '$3'"; fail=1; }; }
has() { case "$2" in *"$3"*) ;; *) echo "FAIL: $1: '$3' not in output:"; echo "$2"; fail=1 ;; esac; }
hasnt() { case "$2" in *"$3"*) echo "FAIL: $1: '$3' should not be in output"; fail=1 ;; esac; }
# Monday 2025-11-24 16:00 UTC
NOW=1764000000
a() { OUT=$(HOME="$T/home" TZ=UTC0 AUTONOMY_NOW=$NOW AUTONOMY_ROUTINES="$T/routines" bash "$S" "$@" 2>&1); RC=$?; }

# check: on by default
a check; chk "check on: exit" "$RC" 0; has "check on: text" "$OUT" "autonomy on"

# off with a reason, then check fails and says why
a off disk is full; chk "off: exit" "$RC" 0
chk "off: file" "$([ -f "$T/home/.claude/autonomy.off" ] && echo yes)" yes
has "off: reason in file" "$(cat "$T/home/.claude/autonomy.off")" "reason: disk is full"
has "off: time in file" "$(cat "$T/home/.claude/autonomy.off")" "since: 2025-11-24T16:00:00Z"
a check; chk "check off: exit" "$RC" 1; has "check off: reason" "$OUT" "disk is full"

# run refuses when off, and stamps nothing
a run day-loop; chk "run off: exit" "$RC" 1; has "run off: text" "$OUT" "refused"
hasnt "run off: no prompt" "$OUT" "First step"
chk "run off: no stamp" "$([ -e "$T/home/.claude/autonomy/last-run.json" ] && echo yes)" ""

# status shows the kill switch
a status; chk "status off: exit" "$RC" 0; has "status off" "$OUT" "kill switch: ON"

# on removes the file
a on; chk "on: exit" "$RC" 0
chk "on: file gone" "$([ -e "$T/home/.claude/autonomy.off" ] && echo yes)" ""
a check; chk "check after on: exit" "$RC" 0
a off; has "off with no reason" "$(cat "$T/home/.claude/autonomy.off")" "no reason given"
a on

# run prints the path and the prompt with no frontmatter, then stamps
a run day-loop; chk "run: exit" "$RC" 0
has "run: path" "$OUT" "routine: $T/routines/day-loop.md"
has "run: first step" "$OUT" "1. First step of the prompt."
has "run: last step" "$OUT" "2. Last step."
hasnt "run: no frontmatter" "$OUT" "schedule:"
hasnt "run: no description" "$OUT" "description: A test loop."
chk "run: stamped" "$(jq -r '."day-loop"' "$T/home/.claude/autonomy/last-run.json")" "2025-11-24T16:00:00Z"
a run no-such-loop; chk "run unknown: exit" "$RC" 1
a run '../etc'; chk "run bad name: exit" "$RC" 2

# stamp keeps the other loops
NOW=1764003600 a stamp sunday; chk "stamp: exit" "$RC" 0
chk "stamp: new" "$(jq -r '.sunday' "$T/home/.claude/autonomy/last-run.json")" "2025-11-24T17:00:00Z"
chk "stamp: old kept" "$(jq -r '."day-loop"' "$T/home/.claude/autonomy/last-run.json")" "2025-11-24T16:00:00Z"
a stamp; chk "stamp no name: exit" "$RC" 2
echo 'not json' >"$T/home/.claude/autonomy/last-run.json"
a stamp often; chk "stamp over bad json" "$(jq -r '.often' "$T/home/.claude/autonomy/last-run.json")" "2025-11-24T16:00:00Z"
a stamp day-loop; a stamp sunday

# status: each loop with schedule, last run and next run; README is not a loop
a status; chk "status: exit" "$RC" 0
has "status on" "$OUT" "kill switch: off"
row() { printf '%s\n' "$OUT" | grep -E "^$1 " | tr -s ' '; }
chk "status: day-loop" "$(row day-loop)" "day-loop 0 9 * * 1-5 2025-11-24T16:00:00Z 2025-11-25 09:00"
chk "status: sunday" "$(row sunday)" "sunday 30 2 * * 0 2025-11-24T16:00:00Z 2025-11-30 02:30"
chk "status: often every 20 min" "$(row often)" "often */20 * * * * 2025-11-24T16:00:00Z 2025-11-24 16:20"
chk "status: two-times first" "$(row two-times)" "two-times 15 8 * * 1-5 never 2025-11-25 08:15"
has "status: two-times second" "$OUT" "0 18 * * *"
has "status: two-times second next" "$OUT" "2025-11-24 18:00"
hasnt "status: README" "$OUT" "README"

# unknown subcommand
a nope; chk "unknown: exit" "$RC" 2

[ "$fail" = 0 ] && echo "autonomy: all tests passed"
exit "$fail"
