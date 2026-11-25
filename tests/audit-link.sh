#!/usr/bin/env bash
# audit.sh runs through a link in ~/.claude/skills. It must find the repo behind the link, not ~.
# Test: run it once directly and once through a link in a temporary HOME; the skill findings must be the same.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home/.claude/skills"
# Git Bash copies on "ln -s" unless it is told to make native Windows links (install.sh does the same).
case "$(uname -s)" in
  MINGW*|MSYS*) export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict";;
  CYGWIN*) export CYGWIN="${CYGWIN:+$CYGWIN }winsymlinks:nativestrict";;
esac
if ! { ln -s "$ROOT/claude/skills/setup-audit" "$T/home/.claude/skills/setup-audit" 2>/dev/null \
  && [ -L "$T/home/.claude/skills/setup-audit" ]; }; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      if [ -n "${CI:-}" ]; then echo "FAIL: no symbolic links here, and CI is set"; exit 1; fi
      echo "audit-link: skipped: no symbolic links here"; exit 0;;
    *) echo "FAIL: cannot make a symbolic link in $T"; exit 1;;
  esac
fi

# The skill and stale-path findings name files of the audited tree, so they show which tree a run audits.
pick() { awk -F'\t' '$2 ~ /^(skill-|stale-path)/ {print $1 "\t" $2 "\t" $3}' | sort; }
direct=$(HOME="$T/home" bash "$ROOT/claude/skills/setup-audit/audit.sh" --no-network 2>/dev/null | pick)
linked=$(HOME="$T/home" bash "$T/home/.claude/skills/setup-audit/audit.sh" --no-network 2>/dev/null | pick)

fail=0
[ -n "$direct" ] || { echo "FAIL: the direct run found no skill lines (the test sees nothing)"; fail=1; }
[ "$direct" = "$linked" ] || { echo "FAIL: the run through a link audits another tree"; diff <(echo "$direct") <(echo "$linked") | head -10; fail=1; }
[ "$fail" = 0 ] && echo "audit-link: all tests passed"
exit "$fail"
