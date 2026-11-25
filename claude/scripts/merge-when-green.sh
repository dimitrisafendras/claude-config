#!/bin/bash
# Usage: merge-when-green.sh [-R owner/repo] [-m merge|squash|rebase] <PR>
# Waits for the checks to settle (60 s poll, 2 h limit); merges when none fail; reports otherwise.
# Defaults: the repo of the current folder, method squash.
# Exit: 0 merged, 1 closed, 2 conflicting, 3 merge call failed, 4 red, 5 timeout, 64 usage.
R=""; M=squash
while getopts "R:m:" o; do
  case "$o" in R) R=$OPTARG;; m) M=$OPTARG;; *) echo "usage: $0 [-R owner/repo] [-m merge|squash|rebase] <PR>" >&2; exit 64;; esac
done
shift $((OPTIND - 1))
PR=${1:-}
[ -n "$PR" ] || { echo "usage: $0 [-R owner/repo] [-m merge|squash|rebase] <PR>" >&2; exit 64; }
case "$M" in merge|squash|rebase) ;; *) echo "bad method: $M" >&2; exit 64;; esac
[ -n "$R" ] || R=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
[ -n "$R" ] || { echo "no repo: pass -R owner/repo or run inside a repo" >&2; exit 64; }
tries=0
while [ "$tries" -lt 120 ]; do
  tries=$((tries + 1))
  st=$(gh pr view "$PR" -R "$R" --json state,mergeable --jq '.state+" "+.mergeable')
  case "$st" in MERGED*) echo "$PR already merged"; exit 0;; CLOSED*) echo "$PR closed"; exit 1;; *CONFLICTING) echo "$PR conflicting"; exit 2;; esac
  out=$(gh pr checks "$PR" -R "$R" 2>/dev/null)
  pending=$(echo "$out" | awk -F'\t' '$2=="pending"' | wc -l | tr -d ' ')
  if [ "$pending" = 0 ] && [ -n "$out" ]; then
    fails=$(echo "$out" | awk -F'\t' '$2=="fail"{print $1}')
    if [ -z "$fails" ]; then
      gh pr merge "$PR" -R "$R" "--$M" >/dev/null && echo "$PR merged ($M)" && exit 0
      echo "$PR merge call failed"; exit 3
    fi
    echo "$PR red: $fails"; exit 4
  fi
  sleep 60
done
echo "$PR timeout"; exit 5
