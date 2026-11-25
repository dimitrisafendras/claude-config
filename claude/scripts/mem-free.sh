#!/usr/bin/env bash
# mem-free.sh: give memory back before a heavy job or a new session.
#
#   mem-free.sh                 dry run: list what is idle and what uses the memory
#   mem-free.sh --apply         stop the idle Docker Compose projects
#   mem-free.sh --apply --apps  also quit the apps named in ~/.claude/mem-free.apps
#
# A Compose project is idle when no host process has its working folder inside
# the git checkout that started the project. A worktree environment whose dev
# servers and session are gone is idle; the shared data plane of a repo stays
# while a process works in any worktree of that repo.
#
# It only stops containers (`docker compose stop`): volumes, networks and the
# containers themselves stay, so `docker compose start` or the repo's own "up"
# command brings the project back. It never removes anything.
#
# ~/.claude/mem-free.keep   one substring per line: a project whose name has it is never stopped
# ~/.claude/mem-free.apps   one app name per line (as in the Dock): quit with --apps, the normal
#                           quit that lets the app save its state. No file means no app is quit.
#
# The last line is the result, for the memory-governor mod:
#   mem-free: stopped 1 docker project(s), quit 0 app(s)
set -uo pipefail

APPLY=0; APPS=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --apps) APPS=1 ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "mem-free: unknown argument: $a" >&2; exit 2 ;;
  esac
done

KEEP_FILE="${MEM_FREE_KEEP:-$HOME/.claude/mem-free.keep}"
APPS_FILE="${MEM_FREE_APPS:-$HOME/.claude/mem-free.apps}"
stopped=0; quit=0

# The lines of a list file, without comments and empty lines.
lines() { [ -f "$1" ] && sed -e 's/#.*//' -e 's/[[:space:]]*$//' -e '/^$/d' "$1"; }

is_kept() {
  local name="$1" k
  while IFS= read -r k; do
    case "$name" in *"$k"*) return 0 ;; esac
  done < <(lines "$KEEP_FILE")
  return 1
}

# The working folder of every process of this user, one per line.
cwds() { lsof -a -d cwd -Fn -u "$(id -un)" 2>/dev/null | sed -n 's/^n//p' | sort -u; }

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  CWDS="$(cwds)"
  echo "Docker Compose projects:"
  # project <TAB> working folder, one line per running project
  docker ps --format '{{.Label "com.docker.compose.project"}}	{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null \
    | awk -F'\t' '$1 != "" { if (!($1 in wd)) order[++n] = $1; if (wd[$1] == "") wd[$1] = $2 } END { for (i = 1; i <= n; i++) print order[i] "\t" wd[order[i]] }' \
    | while IFS=$'\t' read -r project wd; do
        root=""
        if [ -n "$wd" ] && [ -d "$wd" ]; then
          root="$(git -C "$wd" rev-parse --show-toplevel 2>/dev/null || true)"
          [ -n "$root" ] || root="$wd"
        fi
        if is_kept "$project"; then
          echo "  KEEP  $project (in mem-free.keep)"
        elif [ -z "$root" ] || [ ! -d "$root" ]; then
          echo "  KEEP  $project (its folder is unknown or gone: $wd)"
        elif printf '%s\n' "$CWDS" | awk -v r="$root" '$0 == r || index($0, r "/") == 1 { f = 1 } END { exit !f }'; then
          echo "  KEEP  $project (a process works in $root)"
        elif [ "$APPLY" = 1 ]; then
          if docker compose -p "$project" stop >/dev/null 2>&1; then
            echo "  STOP  $project (no process works in $root)"; echo "$project" >>"${TMPDIR:-/tmp}/mem-free.$$"
          else
            echo "  FAIL  $project (docker compose stop failed)"
          fi
        else
          echo "  IDLE  $project (no process works in $root; --apply stops it)"
        fi
      done
  if [ -f "${TMPDIR:-/tmp}/mem-free.$$" ]; then
    stopped=$(wc -l <"${TMPDIR:-/tmp}/mem-free.$$" | tr -d ' '); rm -f "${TMPDIR:-/tmp}/mem-free.$$"
  fi
  other=$(docker ps --format '{{.Names}}	{{.Label "com.docker.compose.project"}}' 2>/dev/null | awk -F'\t' '$2 == "" {print $1}' | tr '\n' ' ')
  [ -n "$other" ] && echo "  Not in a Compose project (not touched): $other"
else
  echo "Docker: not running."
fi

if [ "$(uname)" = "Darwin" ]; then
  echo "Apps that use the most memory:"
  ps -axo rss=,comm= | awk '{
      n=$2; for (i=3; i<=NF; i++) n=n" "$i
      if (match(n, /\/[^\/]+\.app\//)) { app=substr(n, RSTART+1, RLENGTH-6) } else { sub(/.*\//, "", n); app=n }
      a[app]+=$1
    } END { for (k in a) if (a[k] > 300000) printf "  %6.0f MB  %s\n", a[k]/1024, k }' | sort -rn | head -8
  if [ "$APPS" = 1 ] && [ "$APPLY" = 1 ]; then
    while IFS= read -r app; do
      if pgrep -qf "/$app.app/" 2>/dev/null; then
        if osascript -e "tell application \"$app\" to quit" >/dev/null 2>&1; then
          echo "  QUIT  $app"; quit=$((quit + 1))
        else
          echo "  FAIL  $app (it did not accept the quit)"
        fi
      fi
    done < <(lines "$APPS_FILE")
  elif [ -n "$(lines "$APPS_FILE")" ]; then
    echo "  In mem-free.apps (--apply --apps quits them): $(lines "$APPS_FILE" | tr '\n' ',' | sed 's/,$//')"
  fi
fi

echo "mem-free: stopped ${stopped} docker project(s), quit ${quit} app(s)"
