#!/usr/bin/env bash
# The repo and its docs must agree: each skill, mod, routine, script and test file
# is named in README.md (mods also in marketplace.json, routines also in routines/README.md).
# Read-only, no network. INVENTORY_README points the test at another README (to prove a failure).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
README="${INVENTORY_README:-$ROOT/README.md}"
RREADME="${INVENTORY_ROUTINES_README:-$ROOT/routines/README.md}"
MARKET="$ROOT/.claude-plugin/marketplace.json"
fail=0
bad() { echo "FAIL: $1"; fail=1; }
# named FILE WORD: WORD appears in FILE, not inside a longer name
named() { grep -Eq "(^|[^A-Za-z0-9_-])$2([^A-Za-z0-9_-]|\$)" "$1"; }

for d in "$ROOT"/claude/skills/*/; do
  n=$(basename "$d")
  named "$README" "$n" || bad "skill $n is not named in README.md"
done

plugins=$(jq -r '.plugins[].name' "$MARKET" | tr -d '\r')
for d in "$ROOT"/mods/*/; do
  n=$(basename "$d")
  named "$README" "$n" || bad "mod $n is not named in README.md"
  printf '%s\n' "$plugins" | grep -qx -- "$n" || bad "mod $n is not a plugin in marketplace.json"
done
for p in $plugins; do
  [ -d "$ROOT/mods/$p" ] || bad "plugin $p in marketplace.json has no folder in mods/"
done

for f in "$ROOT"/routines/*.md; do
  n=$(basename "$f" .md)
  [ "$n" = README ] && continue
  named "$README" "$n" || bad "routine $n is not named in README.md"
  named "$RREADME" "$n" || bad "routine $n is not named in routines/README.md"
done

for f in "$ROOT"/claude/scripts/*; do
  [ -f "$f" ] || continue
  n=$(basename "$f")
  grep -Fq -- "$n" "$README" || bad "script $n is not named in README.md"
done

for f in "$ROOT"/tests/*.sh; do
  n=$(basename "$f" .sh)
  grep -Fq -- "tests/$n.sh" "$README" || grep -Fq -- "\`$n\`" "$README" || bad "test $n is not named in README.md"
done

# The README gives the number of mods in words.
words=(zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty)
count=0; for d in "$ROOT"/mods/*/; do [ -d "$d" ] && count=$((count + 1)); done
w="${words[$count]:-}"
if [ -n "$w" ]; then
  grep -Fq -- "holds $w function-hook mods" "$README" || bad "README.md should say 'holds $w function-hook mods' ($count mod folders)"
fi

[ "$fail" = 0 ] && echo "inventory: skills, mods, routines, scripts and tests are all named"
exit "$fail"
