#!/usr/bin/env bash
# Stage 1 and the PR part of stage 2 of /start-work. Read-mostly and fast:
# - fetches every git repo found in the projects folder (list-projects.sh) and fast-forwards the default branch only when the
#   main checkout is ON that branch and clean (never switches, stashes or merges);
# - lists your open PRs per repo with a CI / review / conflict verdict;
# - prints the free-memory budget.
# Usage: morning.sh [folder ...]   with folders, only those projects (a project run); else every project.
# Output: one JSON object on stdout. Progress and errors go to stderr.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${PROJECTS_DIR:-$HOME/Projects}"
LIST=""
for f in "$HOME/.claude/list-projects.sh" "$HERE/../../scripts/list-projects.sh"; do
  [ -f "$f" ] && { LIST="$f"; break; }
done
[ -n "$LIST" ] || { echo "list-projects.sh not found" >&2; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

repo_job() {
  local name="$1" surfaces="$2" board="$3" dir="$ROOT/$1" out="$TMP/$1.json"
  if [ ! -d "$dir/.git" ]; then
    jq -n --arg n "$name" '{repo:$n, error:"not cloned"}' > "$out"; return
  fi
  local slug def cur dirty fetched=true updated=false behind=0 note=""
  slug=$(git -C "$dir" remote get-url origin 2>/dev/null | sed -E 's#(https://github.com/|git@github.com:)##; s#\.git$##')
  git -C "$dir" fetch -q --prune origin 2>/dev/null || fetched=false
  def=$(git -C "$dir" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##'); def=${def:-main}
  cur=$(git -C "$dir" branch --show-current 2>/dev/null)
  dirty=$(git -C "$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  behind=$(git -C "$dir" rev-list --count "HEAD..origin/$def" 2>/dev/null || echo 0)
  if [ "$cur" = "$def" ] && [ "$dirty" = 0 ] && [ "$behind" -gt 0 ]; then
    git -C "$dir" merge -q --ff-only "origin/$def" 2>/dev/null && updated=true || note="fast-forward failed"
  elif [ -z "$cur" ]; then note="main checkout is on a detached HEAD"
  elif [ "$cur" != "$def" ]; then note="main checkout is on $cur"
  elif [ "$dirty" != 0 ]; then note="main checkout has $dirty changed files"
  fi
  local wts; wts=$(( $(git -C "$dir" worktree list 2>/dev/null | wc -l) - 1 ))
  local prs='[]'
  if [ -n "$slug" ]; then
    prs=$(gh pr list -R "$slug" --author @me --state open --limit 50 \
      --json number,title,url,isDraft,headRefName,reviewDecision,mergeable,statusCheckRollup,updatedAt 2>/dev/null \
      | jq '[.[] | {number,title,url,draft:.isDraft,branch:.headRefName,review:(.reviewDecision // ""),
          conflict:(.mergeable=="CONFLICTING"), updatedAt,
          ci:( [.statusCheckRollup[]? | (.conclusion // .state // .status // "")] as $s
               | if ($s|length)==0 then "none"
                 elif any($s[]; .=="FAILURE" or .=="ERROR" or .=="TIMED_OUT" or .=="CANCELLED" or .=="ACTION_REQUIRED") then "red"
                 elif any($s[]; .=="PENDING" or .=="IN_PROGRESS" or .=="QUEUED" or .=="EXPECTED" or .=="") then "pending"
                 else "green" end)}]' 2>/dev/null || echo '[]')
  fi
  jq -n --arg n "$name" --arg slug "$slug" --arg s "$surfaces" --arg b "$board" --arg def "$def" --arg cur "$cur" \
    --argjson dirty "$dirty" --argjson behind "${behind:-0}" --argjson fetched "$fetched" --argjson updated "$updated" \
    --arg note "$note" --argjson wts "$wts" --argjson prs "$prs" \
    '{repo:$n, slug:$slug, surfaces:($s|split(",")), board:($b=="board"), default:$def, checkout:$cur,
      dirty:$dirty, behind_before:$behind, fetched:$fetched, updated:$updated, note:$note, worktrees:$wts, prs:$prs}' > "$out"
}
ONLY=" $* "
found=0
while read -r n s b; do
  if [ $# -gt 0 ]; then case "$ONLY" in *" $n "*) ;; *) continue;; esac; fi
  found=$((found + 1))
  repo_job "$n" "$s" "${b:-}" &
  while [ "$(jobs -rp | wc -l)" -ge 6 ]; do sleep 0.2; done
done < <(bash "$LIST")
wait
[ "$found" -gt 0 ] || { echo "no project matches: $*" >&2; exit 1; }

MEM='{}'
for f in "$HOME/.claude/mem-budget.sh" "$HERE/../../scripts/mem-budget.sh"; do
  if [ -x "$f" ] || [ -f "$f" ]; then
    m=$(bash "$f" 2>/dev/null); rc=$?
    room=false; [ "$rc" = 0 ] && room=true
    MEM=$(jq -n --arg out "$m" --argjson room "$room" '{room_for_heavy_jobs:$room, detail:$out}'); break
  fi
done
GH=$(gh api user -q .login 2>/dev/null || echo "")
jq -s --argjson mem "$MEM" --arg gh "$GH" --arg email "$(git config --global user.email)" \
  '{github_login:$gh, git_email:$email, memory:$mem, repos:(sort_by(.repo)),
    pr_counts:{open:([.[].prs[]?]|length), red:([.[].prs[]?|select(.ci=="red")]|length),
               conflict:([.[].prs[]?|select(.conflict)]|length),
               changes_requested:([.[].prs[]?|select(.review=="CHANGES_REQUESTED")]|length)}}' "$TMP"/*.json
