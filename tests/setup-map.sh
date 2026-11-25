#!/usr/bin/env bash
# setup-map.sh builds a page from the repo: it counts the real skills and names the real mods.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
chk() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2' expected '$3'"; fail=1; }; }
out=$(SETUP_MAP_CORE="$ROOT" SETUP_MAP_PROFILE="" bash "$ROOT/claude/scripts/setup-map.sh" "$T/map.html")
chk "prints the path" "$out" "$T/map.html"
[ -s "$T/map.html" ] || { echo "FAIL: no page"; exit 1; }
nsk=$(ls -d "$ROOT"/claude/skills/*/ | wc -l | tr -d ' ')
nmod=$(ls -d "$ROOT"/mods/*/ | wc -l | tr -d ' ')
chk "skill count" "$(grep -o '<div class="stat"><b>[0-9]*</b><span>skills' "$T/map.html" | grep -o '[0-9]*' | head -1)" "$nsk"
chk "mod count" "$(grep -o '<div class="stat"><b>[0-9]*</b><span>mods' "$T/map.html" | grep -o '[0-9]*' | head -1)" "$nmod"
grep -q 'id="kinds"' "$T/map.html" || { echo "FAIL: no What is what section"; fail=1; }
grep -q 'project-morning' "$T/map.html" || { echo "FAIL: routine project-morning missing"; fail=1; }
if SETUP_MAP_CORE="$T/none" bash "$ROOT/claude/scripts/setup-map.sh" "$T/x.html" >/dev/null 2>&1; then echo "FAIL: should refuse a missing repo"; fail=1; fi
[ "$fail" = 0 ] && echo "setup-map: all tests passed"
exit "$fail"
