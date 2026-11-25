#!/usr/bin/env bash
# Classify (and with --apply, remove) dead git worktrees of the current repository.
#
# A worktree is REMOVABLE only when ALL hold:
#   - it is not the main checkout and not the worktree this script runs from
#   - no process has its cwd inside it (lsof)
#   - `git status --porcelain` is empty (no staged, modified or untracked files;
#     ignored files such as node_modules do not count)
#   - every commit on HEAD is already on a remote ref (nothing unpushed)
#   - its branch has no OPEN pull request
#   - its branch's PR is MERGED/CLOSED, or HEAD is already contained in origin/main,
#     or HEAD is detached and contained in some remote ref
# Anything else is KEPT, with the reason printed.
#
# Usage: cleanup.sh [--apply] [--keep <path-substring>]... [--include-app]
#   keep.txt next to this script lists path substrings that are always kept.
#   Worktrees on claude/* branches belong to Claude app sessions and are skipped
#   unless --include-app; archive the session instead, which removes its worktree.
#   default is a dry run. --apply runs `git worktree remove` (never --force) and
#   deletes the local branch only when it is merged into origin/main or its PR merged
#   (`git branch -d`, never -D). Remote branches are never touched.
set -uo pipefail

APPLY=0
INCLUDE_APP=0
KEEP=()
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --keep) shift; KEEP+=("$1") ;;
    --include-app) INCLUDE_APP=1 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

SELF=$(git rev-parse --show-toplevel)
MAIN=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
git -C "$MAIN" fetch -q --prune origin || { echo "fetch failed" >&2; exit 1; }

# branch -> PR state (OPEN wins over MERGED/CLOSED when a branch has several PRs)
PRMAP=$(mktemp)
gh pr list --state all --limit 1000 --json headRefName,state,headRefOid \
  -q '.[]|"\(.headRefName)\t\(.state)\t\(.headRefOid)"' > "$PRMAP" 2>/dev/null || true
# HEAD counts as pushed when it is the head (or an ancestor of the head) of a
# merged/closed PR for this branch: squash merges delete the remote branch, so its
# commits are no longer on any remote ref, but nothing local is lost.
pushed_via_pr() {
  local b="$1" head="$2" oid
  for oid in $(awk -F'\t' -v b="$b" '$1==b && $2!="OPEN"{print $3}' "$PRMAP"); do
    [ "$oid" = "$head" ] && return 0
    git cat-file -e "$oid^{commit}" 2>/dev/null && git merge-base --is-ancestor "$head" "$oid" 2>/dev/null && return 0
  done
  return 1
}
KEEPFILE="$(dirname "$0")/keep.txt"
if [ -f "$KEEPFILE" ]; then
  while IFS= read -r line; do
    line="${line%%#*}"; line="$(echo "$line" | xargs)"; [ -n "$line" ] && KEEP+=("$line")
  done < "$KEEPFILE"
fi
pr_state() {
  local s
  s=$(awk -F'\t' -v b="$1" '$1==b{print $2}' "$PRMAP")
  if echo "$s" | grep -q OPEN; then echo OPEN
  elif echo "$s" | grep -q MERGED; then echo MERGED
  elif echo "$s" | grep -q CLOSED; then echo CLOSED
  else echo NONE; fi
}

removed=0; kept=0
while IFS=$'\t' read -r path branch; do
  [ "$path" = "$MAIN" ] && continue
  [ "$path" = "$SELF" ] && { printf 'KEEP   %-60s this session\n' "$path"; kept=$((kept+1)); continue; }
  reason=""
  for k in "${KEEP[@]:-}"; do [ -n "$k" ] && [[ "$path" == *"$k"* ]] && reason="kept by --keep"; done
  if [ -z "$reason" ] && [ "$INCLUDE_APP" = 0 ] && [[ "$branch" == refs/heads/claude/* ]]; then
    reason="app session worktree (archive the session instead)"
  fi
  if [ -z "$reason" ] && [ ! -d "$path" ]; then
    reason="missing on disk (run: git worktree prune)"
  fi
  # The folder is gitignored, so git status misses it and a plain remove deletes the record of the
  # environment's containers and databases, which then keep running with nothing to tear them down.
  if [ -z "$reason" ] && [ -d "$path/.worktree-env" ]; then
    reason="per-worktree environment (.worktree-env): tear it down with the repo's own reset first"
  fi
  if [ -z "$reason" ] && lsof -a -d cwd -Fn 2>/dev/null | grep -q "^n$path\(/\|$\)"; then
    reason="a process is running inside it"
  fi
  if [ -z "$reason" ] && [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then
    reason="uncommitted changes"
  fi
  if [ -z "$reason" ]; then
    unpushed=$(git -C "$path" rev-list --count HEAD --not --remotes 2>/dev/null || echo 1)
    if [ "$unpushed" != "0" ]; then
      head=$(git -C "$path" rev-parse HEAD)
      pushed_via_pr "${branch#refs/heads/}" "$head" || reason="$unpushed unpushed commit(s)"
    fi
  fi
  state=NONE
  short=${branch#refs/heads/}
  if [ -z "$reason" ]; then
    if [ "$branch" = "(detached)" ]; then
      state=DETACHED
    else
      state=$(pr_state "$short")
      [ "$state" = OPEN ] && reason="PR open"
    fi
  fi
  if [ -z "$reason" ]; then
    in_main=0
    git -C "$path" merge-base --is-ancestor HEAD origin/main 2>/dev/null && in_main=1
    case "$state" in
      MERGED|CLOSED|DETACHED) : ;;
      NONE) [ "$in_main" = 1 ] || reason="no PR and not in origin/main" ;;
    esac
  fi
  if [ -n "$reason" ]; then
    printf 'KEEP   %-60s %s\n' "$path" "$reason"; kept=$((kept+1)); continue
  fi
  printf 'REMOVE %-60s %s %s\n' "$path" "$short" "$state"
  removed=$((removed+1))
  if [ "$APPLY" = 1 ]; then
    if git -C "$MAIN" worktree remove "$path"; then
      if [ "$branch" != "(detached)" ] && { [ "$state" = MERGED ] || [ "$in_main" = 1 ]; }; then
        git -C "$MAIN" branch -d "$short" >/dev/null 2>&1 || git -C "$MAIN" branch -D "$short" >/dev/null 2>&1 \
          && echo "       deleted local branch $short" || true
      fi
    else
      echo "       remove failed; left in place"
    fi
  fi
done < <(git worktree list --porcelain | awk '
  /^worktree /{p=substr($0,10)}
  /^branch /{b=$2}
  /^detached/{b="(detached)"}
  /^$/{if(p!="")print p"\t"b; p="";b=""}
  END{if(p!="")print p"\t"b}')

[ "$APPLY" = 1 ] && git -C "$MAIN" worktree prune
rm -f "$PRMAP"
echo "---"
echo "$([ "$APPLY" = 1 ] && echo removed || echo would remove): $removed  kept: $kept"
