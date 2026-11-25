#!/usr/bin/env bash
# audit.sh runs through a link in ~/.claude/skills. It must find the repo behind the link, not ~.
# Test: run it once directly and once through a link in a temporary HOME; the skill findings must be the same.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home/.claude/skills"
ln -s "$ROOT/claude/skills/setup-audit" "$T/home/.claude/skills/setup-audit"

pick() { awk -F'\t' '$2 ~ /^skill-/ {print $1 "\t" $2 "\t" $3}' | sort; }
direct=$(HOME="$T/home" bash "$ROOT/claude/skills/setup-audit/audit.sh" --no-network 2>/dev/null | pick)
linked=$(HOME="$T/home" bash "$T/home/.claude/skills/setup-audit/audit.sh" --no-network 2>/dev/null | pick)

fail=0
[ -n "$direct" ] || { echo "FAIL: the direct run found no skill lines (the test sees nothing)"; fail=1; }
[ "$direct" = "$linked" ] || { echo "FAIL: the run through a link audits another tree"; diff <(echo "$direct") <(echo "$linked") | head -10; fail=1; }
[ "$fail" = 0 ] && echo "audit-link: all tests passed"
exit "$fail"
