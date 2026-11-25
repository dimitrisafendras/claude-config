#!/usr/bin/env bash
# morning.sh with a folder argument reports only that project; an unknown folder fails.
# No network: the test repos have no remote, so no fetch result and no PR list are expected.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
P="$T/Projects"; mkdir -p "$P"
for r in alpha beta; do mkdir -p "$P/$r" && git -C "$P/$r" init -q && : >"$P/$r/README.md" && git -C "$P/$r" add -A; done
run() { PROJECTS_DIR="$P" PROJECTS_CONF=/dev/null bash "$ROOT/claude/skills/start-work/morning.sh" "$@" 2>/dev/null; }

fail=0
chk() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2' expected '$3'"; fail=1; }; }
chk "all projects" "$(run | jq -r '[.repos[].repo] | join(" ")')" "alpha beta"
chk "one project"  "$(run beta | jq -r '[.repos[].repo] | join(" ")')" "beta"
chk "two projects" "$(run beta alpha | jq -r '[.repos[].repo] | join(" ")')" "alpha beta"
run nothing-here >/dev/null; chk "unknown folder exit" "$?" "1"
[ "$fail" = 0 ] && echo "morning-project: all tests passed"
exit "$fail"
