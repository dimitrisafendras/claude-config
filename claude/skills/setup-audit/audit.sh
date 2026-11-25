#!/usr/bin/env bash
# Read-only audit of the claude-config repo.
# Prints one line per finding: LEVEL<TAB>area<TAB>message   (LEVEL: ERROR, WARN, INFO)
# Exit 1 when there is at least one ERROR, else 0. Changes nothing.
# Usage: audit.sh [--no-network]   (skips git fetch and gh calls)
#        audit.sh --routine-drift [routines-dir]   (runs only the routine template drift check)
set -uo pipefail

NET=1; [ "${1:-}" = "--no-network" ] && NET=0
ROOT=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)   # the tree being audited; -P: the skill runs through a link in ~/.claude/skills
MAIN=$(git -C "$ROOT" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')
MAIN=${MAIN:-$ROOT}
ERRORS=0
f() { # level area message
  printf '%s\t%s\t%s\n' "$1" "$2" "$3"
  [ "$1" = ERROR ] && ERRORS=$((ERRORS + 1))
}

# Routine template drift: project-daily.md and project-morning.md share their hard rules.
# A hard rule (a "- " line under "Hard rules:") that is in one file and not in the other is a WARN.
# Numbers do not count (the limits differ). The rules below may be in one file only: they are
# the difference between the template that starts work (morning) and the one that does not (daily).
DRIFT_ALLOWED=(
  'Run stage 1 (housekeeping) and stage 2 (inbox) of the `start-work` skill'
  'Do not merge, push'
  'The limits are for this session.'
  'The dispatcher is the skill'
  'Start only tickets that are ready'
  'Start no more sessions'
  'A production release'
  'Follow the ticket rules'
)
hard_rules() {  # hard_rules <file>: the hard-rule lines, numbers replaced by N, allowed lines removed
  local l a
  while IFS= read -r l; do
    for a in "${DRIFT_ALLOWED[@]}"; do [ "${l#"$a"}" != "$l" ] && continue 2; done
    printf '%s\n' "$l" | sed -E 's/[0-9]+/N/g'
  done < <(awk '/^Hard rules:/{i=1;next} i&&/^- /{sub(/^- /,""); print; next} i&&!/^[[:space:]]/{exit}' "$1")
}
DRIFT=0
routine_drift() {  # routine_drift <routines-dir>
  local a="$1/project-daily.md" b="$1/project-morning.md" l
  [ -f "$a" ] && [ -f "$b" ] || return 0
  while IFS= read -r l; do DRIFT=1; f WARN routine-drift "project-daily.md has a hard rule that project-morning.md has not: ${l:0:120}"; done \
    < <(LC_ALL=C comm -23 <(hard_rules "$a" | LC_ALL=C sort -u) <(hard_rules "$b" | LC_ALL=C sort -u))
  while IFS= read -r l; do DRIFT=1; f WARN routine-drift "project-morning.md has a hard rule that project-daily.md has not: ${l:0:120}"; done \
    < <(LC_ALL=C comm -13 <(hard_rules "$a" | LC_ALL=C sort -u) <(hard_rules "$b" | LC_ALL=C sort -u))
}
if [ "${1:-}" = "--routine-drift" ]; then  # exit 1 when there is drift
  routine_drift "${2:-$ROOT/routines}"
  exit "$DRIFT"
fi

# 1. install and sync drift (they check the main checkout, where the links point)
if [ -x "$MAIN/install.sh" ]; then
  out=$(cd "$MAIN" && ./install.sh --check 2>&1) || while IFS= read -r l; do [ -n "$l" ] && f WARN install "$l"; done <<<"$out"
fi
# The active profile folder: ~/.claude/claude-config.profile holds a name under profiles/ of the repo, or a path.
profile_dir() {  # profile_dir <repo>  -> prints the folder, or nothing
  local rec="$HOME/.claude/claude-config.profile" p
  [ -f "$rec" ] || return 0
  p="$(tr -d '[:space:]' < "$rec")"; [ -n "$p" ] || return 0
  case "$p" in */*|~*) p="${p/#\~/$HOME}";; *) p="$1/profiles/$p";; esac
  [ -d "$p" ] && printf '%s\n' "$p"
  return 0
}
PDIR=$(profile_dir "$MAIN")
if [ -n "$PDIR" ] && [ -x "$PDIR/sync.sh" ]; then
  if [ "$NET" = 1 ]; then
    out=$(cd "$PDIR" && ./sync.sh --check 2>&1) || while IFS= read -r l; do [ -n "$l" ] && f WARN sync "$l"; done <<<"$out"
  else f INFO sync "skipped (no network)"; fi
  [ -f "$PDIR/sync.ref" ] && f INFO sync "follows the branch $(tr -d '[:space:]' < "$PDIR/sync.ref"), not main (delete sync.ref after that PR merges)"
fi

# 1b. the core must hold nothing of a company, a person or a project (tests/core-clean.sh has the word list)
if [ -f "$ROOT/tests/core-clean.sh" ]; then
  out=$(bash "$ROOT/tests/core-clean.sh" 2>&1) || while IFS= read -r l; do [ -n "$l" ] && f WARN core-clean "$l"; done <<<"$out"
fi

# 2. shell scripts: shellcheck and syntax
while IFS= read -r s; do
  rel=${s#"$ROOT"/}
  bash -n "$s" 2>/dev/null || f ERROR syntax "bash -n fails: $rel"
  if command -v shellcheck >/dev/null; then
    n=$(shellcheck -S warning -f gcc "$s" 2>/dev/null | wc -l | tr -d ' ')
    [ "$n" -gt 0 ] && f WARN shellcheck "$n warning(s) in $rel"
  fi
done < <(find "$ROOT" -name '*.sh' -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/.claude/worktrees/*')
command -v shellcheck >/dev/null || f INFO shellcheck "shellcheck is not installed"

# 3. settings.json is valid JSON
if [ -f "$ROOT/claude/settings.json" ]; then
  jq . "$ROOT/claude/settings.json" >/dev/null 2>&1 || f ERROR settings "claude/settings.json is not valid JSON"
else f ERROR settings "claude/settings.json is missing"; fi

# 4. skills: size, description, model and effort
for d in "$ROOT"/claude/skills/*/ "$ROOT"/profiles/*/skills/*/ ${PDIR:+"$PDIR"/skills/*/}; do
  [ -d "$d" ] || continue
  n=$(basename "$d"); sk="$d/SKILL.md"
  [ -f "$sk" ] || { f ERROR skill "$n has no SKILL.md"; continue; }
  size=$(wc -c <"$sk" | tr -d ' ')
  [ "$size" -gt 10240 ] && f WARN skill-size "$n SKILL.md is $size bytes (limit 10240)"
  fm=$(awk 'NR==1&&/^---$/{i=1;next} i&&/^---$/{exit} i' "$sk")
  [ -n "$fm" ] || { f ERROR skill "$n has no frontmatter"; continue; }
  desc=$(printf '%s\n' "$fm" | sed -n 's/^description:[[:space:]]*//p' | head -1)
  [ -n "$desc" ] || f ERROR skill "$n has no description"
  [ "${#desc}" -gt 500 ] && f WARN skill-description "$n description is ${#desc} chars (limit 500)"
  printf '%s\n' "$fm" | grep -q '^name:' || f ERROR skill "$n has no name"
  while read -r ref; do  # a reference named in SKILL.md must exist (a path with a folder before it is another skill's)
    [ -f "$d/$ref" ] || f WARN skill-ref "$n names $ref, which does not exist"
  done < <(grep -oE '(^|[^/A-Za-z0-9_.~-])references/[A-Za-z0-9_.-]+\.md' "$sk" | grep -oE 'references/[A-Za-z0-9_.-]+\.md' | sort -u)
  printf '%s\n' "$fm" | grep -q '^model:' || f INFO skill-model "$n has no model"
  printf '%s\n' "$fm" | grep -q '^effort:' || f INFO skill-effort "$n has no effort"
done

# 4b. routine templates: the hard rules of project-daily.md and project-morning.md must not drift
routine_drift "$ROOT/routines"

# 5. stale text: removed plugins and paths that do not exist
files=$(find "$ROOT/claude" "$ROOT/routines" "$ROOT/profiles" "$ROOT/README.md" \( -name '*.md' -o -name '*.sh' -o -name '*.conf' \) -type f 2>/dev/null | grep -v -F "$ROOT/.claude/worktrees/")
[ -n "$files" ] || files=/dev/null
for p in superpowers context7 clangd-lsp you-should-know; do
  hits=$(grep -l -i -w -- "$p" $files 2>/dev/null | grep -v -e 'README.md' -e 'setup-audit/audit.sh' || true)
  [ -n "$hits" ] && f WARN stale "removed plugin '$p' is named in: $(echo $hits | sed "s#$ROOT/##g")"
done
# shellcheck disable=SC2086,SC2088
while IFS=$'\t' read -r file path; do
  case "$path" in *'<'*|*'*'*|*'$'*|*'…'*|*'...'*) continue;; esac
  exp=${path/#\~/$HOME}
  case "$exp" in  # files that only exist at run time, after an install or after the user creates them
    "$HOME"/.claude/claude-config.repo|"$HOME"/.claude/backups/*|"$HOME"/.claude/cheat-buttons.json|"$HOME"/.claude/merge-policy.json|"$HOME"/.claude/routines/*|"$HOME"/.claude/paralel|"$HOME"/.claude/paralel/*|"$HOME"/.claude/autonomy.off|"$HOME"/.claude/autonomy/*) continue;;
  esac
  [ -e "$exp" ] || f WARN stale-path "${file#"$ROOT"/}: $path does not exist"
done < <(grep -o -H -E '~/(\.claude|Projects)/[A-Za-z0-9_./-]+' $files 2>/dev/null | sed 's/:/\t/' | sed -E 's/[.,;:)]+$//' | sort -u)

# 6. projects.conf entries for folders that do not exist
pconf="${PROJECTS_CONF:-$HOME/.claude/projects.conf}"
if [ -f "$pconf" ]; then
  while read -r dir _; do
    dir=${dir#!}
    case "$dir" in ''|'#'*) continue;; esac
    [ -d "${PROJECTS_DIR:-$HOME/Projects}/$dir" ] || f WARN projects "$dir in projects.conf is not a folder in the projects folder"
  done <"$pconf"
fi

# 7. checkout state: on main and current
br=$(git -C "$MAIN" branch --show-current 2>/dev/null)
[ "$br" = main ] || f ERROR checkout "main checkout is on '${br:-detached HEAD}', not main (the links serve this branch)"
if [ "$NET" = 1 ]; then
  if git -C "$MAIN" fetch -q origin 2>/dev/null; then
    behind=$(git -C "$MAIN" rev-list --count main..origin/main 2>/dev/null || echo 0)
    [ "$behind" -gt 0 ] && f WARN checkout "local main is $behind commit(s) behind origin/main"
    [ -n "$(git -C "$MAIN" status --porcelain 2>/dev/null)" ] && f WARN checkout "main checkout has uncommitted changes"
  else f WARN checkout "git fetch failed"; fi
  if command -v gh >/dev/null; then
    prs=$(cd "$MAIN" && gh pr list --state open --json number,title,isDraft -q '.[]|"#\(.number) \(.title)\(if .isDraft then " (draft)" else "" end)"' 2>/dev/null) || f INFO prs "gh pr list failed"
    while IFS= read -r l; do [ -n "$l" ] && f INFO open-pr "$l"; done <<<"${prs:-}"
  fi
fi

# 8. mods validate
# The mods use events that an old CLI does not know (the one on PATH can be older than the app's).
# So validate with the newest CLI that is installed. CLAUDE_BIN overrides the choice.
# shellcheck source=/dev/null  # newest_claude, shared with tests/mods.sh
. "$ROOT/claude/skills/setup-audit/newest-claude.sh"
CLAUDE_PICK=$(newest_claude)
for m in "$ROOT"/mods/*/ "$ROOT"/profiles/*/mods/*/ ${PDIR:+"$PDIR"/mods/*/}; do
  [ -d "$m" ] || continue
  if [ -n "$CLAUDE_PICK" ]; then
    out=$("${CLAUDE_PICK%%$'\t'*}" plugin validate "$m" 2>&1) || f ERROR mod "claude plugin validate fails (CLI ${CLAUDE_PICK##*$'\t'}): ${m#"$ROOT"/}: $(printf '%s' "$out" | awk '/✘ Found/{e=1; next} e && /❯/{print; exit}' | sed 's/^ *❯ *//' | cut -c1-160)"
  else f INFO mod "claude CLI not found, cannot validate ${m#"$ROOT"/}"; fi
done

[ "$ERRORS" -eq 0 ] && exit 0 || exit 1
