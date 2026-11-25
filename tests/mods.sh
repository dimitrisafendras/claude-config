#!/usr/bin/env bash
# Each mod must pass `claude plugin validate` and `claude plugin test`.
# A core mod (mods/*) must also pass `--strict` (no warning, and its hooks module and
# tests type-check) and must state engines["claude-code"] in its plugin.json.
# The two commands need no sign-in and no network, so CI runs this file too.
#
# The CLI on PATH can be older than the desktop app's, and an old CLI does not know
# the newer events. So this uses the newest claude CLI that is installed.
# CLAUDE_BIN overrides the choice.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# From this version `--strict` type-checks a hooks module and plugin.json has `engines`.
MIN=2.1.323
# Core mods that are not held to --strict yet (they still must validate and pass their tests).
# ship: `/ship` is also a command of Claude Code itself, and validate warns about the name.
NOT_STRICT=" ship "

# shellcheck source=/dev/null  # newest_claude, shared with the setup-audit skill
. "$ROOT/claude/skills/setup-audit/newest-claude.sh"
pick=$(newest_claude)
if [ -z "$pick" ]; then echo "FAIL: no claude CLI found (install Claude Code or set CLAUDE_BIN)"; exit 1; fi
CLAUDE=${pick%%$'\t'*}; VERSION=${pick##*$'\t'}
if [ "$(printf '%s\n%s\n' "$MIN" "$VERSION" | sort -V | head -1)" != "$MIN" ]; then
  echo "FAIL: the newest claude CLI is $VERSION; the mod checks need $MIN or later (set CLAUDE_BIN)"; exit 1
fi
echo "mods: claude CLI $VERSION"

fail=0
# Print the lines that say what is wrong, not the full report.
# validate: the findings under each "Found N ..." header, before the plugin directory checks.
why_validate() {
  printf '%s\n' "$1" | awk '/^Plugin directory checks/{exit} /^Validating|^Provides/{p=0} /Found [0-9]+ /{p=1} p && /❯/' \
    | cut -c1-300 | head -20 | sed 's/^ *❯ */    /'
}
why_test() { printf '%s\n' "$1" | grep -E '^\(fail\)|^ *(Expected|Received)|^ *error' | cut -c1-300 | head -20 | sed 's/^/    /'; }

for m in "$ROOT"/mods/*/ "$ROOT"/profiles/*/mods/*/; do
  [ -d "$m" ] || continue
  m=${m%/}; name=${m##*/}; rel=${m#"$ROOT"/}
  strict=""; bad=0
  case "$rel" in mods/*) case "$NOT_STRICT" in *" $name "*) ;; *) strict=--strict;; esac;; esac

  if [ -n "$strict" ] && ! jq -e '.engines["claude-code"] | strings | length > 0' "$m/.claude-plugin/plugin.json" >/dev/null 2>&1; then
    echo "FAIL: $rel: plugin.json has no engines[\"claude-code\"]"; bad=1
  fi
  # shellcheck disable=SC2086  # $strict is one flag or nothing
  if ! out=$("$CLAUDE" plugin validate $strict "$m" 2>&1); then
    echo "FAIL: $rel: claude plugin validate $strict"; why_validate "$out"; bad=1
  fi
  if ! out=$("$CLAUDE" plugin test "$m" 2>&1); then
    echo "FAIL: $rel: claude plugin test"; why_test "$out"; bad=1
  fi
  if [ "$bad" = 0 ]; then
    echo "ok: $rel (validate${strict:+ $strict}, $(printf '%s\n' "$out" | awk '/^ *[0-9]+ pass$/{print $1; exit}') tests)"
  else fail=1; fi
done

[ "$fail" = 0 ] && echo "mods: all mods validate and pass their tests"
exit "$fail"
