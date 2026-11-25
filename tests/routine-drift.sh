#!/usr/bin/env bash
# setup-audit warns when the hard rules of the project-daily and project-morning templates drift apart.
# The repo templates must pass. A changed shared rule must give a WARN. The start-work and no-start rules are allowed.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
AUDIT="$ROOT/claude/skills/setup-audit/audit.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
bad() { echo "FAIL: $1"; fail=1; }

# 1. The templates of the repo agree.
out=$(bash "$AUDIT" --routine-drift "$ROOT/routines" 2>&1) || bad "the repo templates drift: $out"

# 2. A shared rule that changes in one file only is a WARN that names the file.
cp "$ROOT/routines/project-daily.md" "$ROOT/routines/project-morning.md" "$T/"
sed 's/^- Touch only PROJECT\..*/- Touch only PROJECT and its forks./' "$ROOT/routines/project-morning.md" >"$T/project-morning.md"
out=$(bash "$AUDIT" --routine-drift "$T" 2>&1); rc=$?
[ "$rc" = 1 ] || bad "a changed shared rule: exit $rc, expected 1"
printf '%s\n' "$out" | grep -q $'^WARN\troutine-drift\tproject-morning.md has a hard rule that project-daily.md has not: Touch only PROJECT and its forks' \
  || bad "no WARN for the new morning rule: $out"
printf '%s\n' "$out" | grep -q $'^WARN\troutine-drift\tproject-daily.md has a hard rule that project-morning.md has not: Touch only PROJECT. Do not fetch' \
  || bad "no WARN for the daily rule that morning lost: $out"

# 3. Other limit numbers are not drift.
sed 's/at most 30 tool calls and 20 minutes/at most 35 tool calls and 25 minutes/' "$ROOT/routines/project-daily.md" >"$T/project-daily.md"
cp "$ROOT/routines/project-morning.md" "$T/"
out=$(bash "$AUDIT" --routine-drift "$T" 2>&1) || bad "other limit numbers count as drift: $out"

# 4. The start-work and no-start rules may differ, and they do in the repo.
grep -q '^- Run stage 1 (housekeeping) and stage 2 (inbox) of the `start-work` skill in its project scope only' "$ROOT/routines/project-daily.md" \
  || bad "project-daily.md has no no-start stage rule (the test sees nothing)"
grep -q '^- Run stage 1 (housekeeping) and stage 2 (inbox) of the `start-work` skill in the scope of PROJECT, then the dispatch' "$ROOT/routines/project-morning.md" \
  || bad "project-morning.md has no start-work stage rule (the test sees nothing)"

[ "$fail" = 0 ] && echo "routine-drift: all tests passed"
exit "$fail"
