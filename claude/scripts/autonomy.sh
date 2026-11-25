#!/usr/bin/env bash
# autonomy.sh: the kill switch, the run record and the manual trigger of the scheduled loops (routines/).
#   check          exit 0 when loops may run; exit 1 (and the reason) when ~/.claude/autonomy.off exists
#   off [reason]   make the kill switch file, with the reason and the time
#   on             remove the kill switch file
#   status         the kill switch state, then each loop: schedule, last run, next run
#   stamp <loop>   record a run of <loop> in ~/.claude/autonomy/last-run.json
#   run <loop>     print the path and the prompt (no frontmatter) of routines/<loop>.md, then stamp it;
#                  exit 1 when the kill switch is on
# It uses HOME, so tests can use a temp home. AUTONOMY_ROUTINES names the routines folder
# (default: routines/ of the repo that holds this script, else of the repo in ~/.claude/claude-config.repo).
# AUTONOMY_NOW (epoch seconds) replaces the clock, for tests. Needs jq for stamp and status.
set -uo pipefail

D="$HOME/.claude"
OFF="$D/autonomy.off"
STATE_DIR="$D/autonomy"
LAST="$STATE_DIR/last-run.json"

die() { echo "autonomy: $*" >&2; exit 2; }

now_epoch() { if [ -n "${AUTONOMY_NOW:-}" ]; then echo "$AUTONOMY_NOW"; else date +%s; fi; }
# fmt_epoch <epoch> <format> [utc]: GNU date has -d @N, BSD date has -r N.
fmt_epoch() {
  if [ "${3:-}" = utc ]; then
    TZ=UTC0 date -d "@$1" "+$2" 2>/dev/null || TZ=UTC0 date -r "$1" "+$2"
  else
    date -d "@$1" "+$2" 2>/dev/null || date -r "$1" "+$2"
  fi
}
iso_now() { fmt_epoch "$(now_epoch)" '%Y-%m-%dT%H:%M:%SZ' utc; }

# The real path of this script, also through the symlink that install.sh makes.
self_path() {
  local p="${BASH_SOURCE[0]}" t
  while [ -L "$p" ]; do
    t=$(readlink "$p")
    case "$t" in /*) p="$t" ;; *) p="$(dirname "$p")/$t" ;; esac
  done
  (cd "$(dirname "$p")" && pwd -P)
}
routines_dir() {
  if [ -n "${AUTONOMY_ROUTINES:-}" ]; then echo "$AUTONOMY_ROUTINES"; return; fi
  local r; r="$(self_path)/../../routines"
  if [ -d "$r" ]; then (cd "$r" && pwd -P); return; fi
  if [ -f "$D/claude-config.repo" ]; then
    r="$(head -1 "$D/claude-config.repo" | tr -d '\r')/routines"
    [ -d "$r" ] && { echo "$r"; return; }
  fi
  die "no routines folder found (set AUTONOMY_ROUTINES)"
}

valid_loop() { [[ "$1" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "bad loop name '$1' (use lowercase letters, digits and -)"; }

# frontmatter <file>: the lines between the first two --- lines.
frontmatter() { awk 'NR==1 && $0!="---"{exit} NR==1{next} $0=="---"{exit} {print}' "$1"; }
# body <file>: the lines after the frontmatter (all lines when there is none).
body() { awk 'NR==1 && $0!="---"{fm=2} fm==2{print; next} $0=="---"{fm++; next} fm>=2{print}' "$1"; }
# schedules <file>: one cron line per output line, from `schedule: "..."` or `schedule: ["...", "..."]`.
schedules() { frontmatter "$1" | sed -n 's/^schedule:[[:space:]]*//p' | sed 's/#.*$//' | grep -o '"[^"]*"' | tr -d '"'; }

# ---- cron: next run ----
# expand <field> <min> <max>: the values of one cron field, space separated.
expand() {
  local field="$1" lo="$2" hi="$3" part range step a b v out="" parts=()
  IFS=',' read -r -a parts <<<"$field"
  for part in "${parts[@]}"; do
    step=1; range="$part"
    case "$part" in */*) step="${part#*/}"; range="${part%/*}" ;; esac
    case "$range" in
      '*') a=$lo; b=$hi ;;
      *-*) a="${range%-*}"; b="${range#*-}" ;;
      *) a="$range"; b="$range"; [ "$step" != 1 ] && b=$hi ;;
    esac
    [[ "$a$b$step" =~ ^[0-9]+$ ]] || return 1
    [ $((10#$step)) -gt 0 ] || return 1
    for ((v = 10#$a; v <= 10#$b; v += 10#$step)); do out+=" $v"; done
  done
  # ascending, so the first match of next_run is the earliest
  # shellcheck disable=SC2086  # $out is a list of numbers: split it on purpose
  printf '%s\n' $out | sort -n -u | tr '\n' ' '
}
has() { case " $1 " in *" $2 "*) return 0 ;; esac; return 1; }

# next_run <cron>: the next time (local, "YYYY-MM-DD HH:MM") after now, within 8 days; "?" when unknown.
next_run() {
  local m h dom mon dow extra
  read -r m h dom mon dow extra <<<"$1"
  [ -n "$dow" ] && [ -z "$extra" ] || { echo "?"; return; }
  local M H DOM MON DOW
  if ! { M=$(expand "$m" 0 59) && H=$(expand "$h" 0 23) && DOM=$(expand "$dom" 1 31) \
    && MON=$(expand "$mon" 1 12) && DOW=$(expand "$dow" 0 7); }; then echo "?"; return; fi
  has "$DOW" 7 && DOW+=" 0"
  local now hh mm ss midnight k day ymd d mo w okd hr mi best
  now=$(now_epoch)
  read -r hh mm ss <<<"$(fmt_epoch "$now" '%H %M %S')"
  midnight=$((now - 10#$hh * 3600 - 10#$mm * 60 - 10#$ss))
  for ((k = 0; k <= 8; k++)); do
    day=$((midnight + k * 86400 + 43200))   # noon: safe on a daylight saving day
    read -r ymd d mo w <<<"$(fmt_epoch "$day" '%Y-%m-%d %d %m %w')"
    d=$((10#$d)); mo=$((10#$mo))
    has "$MON" "$mo" || continue
    if [ "$dom" != '*' ] && [ "$dow" != '*' ]; then
      okd=1; has "$DOM" "$d" || has "$DOW" "$w" || okd=0
    else
      okd=1; has "$DOM" "$d" || okd=0; has "$DOW" "$w" || okd=0
    fi
    [ "$okd" = 1 ] || continue
    best=""
    for hr in $H; do
      for mi in $M; do
        if [ "$k" = 0 ] && [ $((hr * 60 + mi)) -le $((10#$hh * 60 + 10#$mm)) ]; then continue; fi
        best=$(printf '%s %02d:%02d' "$ymd" "$hr" "$mi"); break 2
      done
    done
    [ -n "$best" ] && { echo "$best"; return; }
  done
  echo "?"
}

# ---- subcommands ----
cmd_check() {
  if [ -e "$OFF" ]; then
    echo "autonomy off: $(tr '\n' ' ' <"$OFF" | sed 's/ *$//')"
    return 1
  fi
  echo "autonomy on: loops may run"
}

cmd_off() {
  local reason="${*:-no reason given}"
  mkdir -p "$D"
  printf 'reason: %s\nsince: %s\n' "$reason" "$(iso_now)" >"$OFF"
  echo "autonomy off: all loops stop ($OFF)"
}

cmd_on() {
  if [ -e "$OFF" ]; then rm -f "$OFF"; echo "autonomy on: loops may run"
  else echo "autonomy on: it was not off"; fi
}

cmd_stamp() {
  [ $# -eq 1 ] || die "usage: autonomy.sh stamp <loop>"
  valid_loop "$1"
  command -v jq >/dev/null || die "jq is not installed"
  mkdir -p "$STATE_DIR"
  local cur='{}' t
  [ -s "$LAST" ] && jq -e 'type == "object"' "$LAST" >/dev/null 2>&1 && cur=$(cat "$LAST")
  t=$(iso_now)
  jq --arg k "$1" --arg v "$t" '.[$k] = $v' <<<"$cur" >"$LAST.tmp.$$" && mv "$LAST.tmp.$$" "$LAST"
  echo "stamped $1 at $t"
}

cmd_status() {
  local dir f n s last next first
  if [ -e "$OFF" ]; then echo "kill switch: ON, loops stop ($(tr '\n' ' ' <"$OFF" | sed 's/ *$//'))"
  else echo "kill switch: off, loops may run"; fi
  dir=$(routines_dir) || exit 2
  printf '%-24s %-18s %-22s %s\n' loop schedule "last run" "next run"
  for f in "$dir"/*.md; do
    [ -f "$f" ] || continue
    n=$(basename "$f" .md)
    [ "$n" = README ] && continue
    last="never"
    if [ -s "$LAST" ] && command -v jq >/dev/null; then
      last=$(jq -r --arg k "$n" '.[$k] // "never"' "$LAST" 2>/dev/null || echo never)
    fi
    first=1
    while IFS= read -r s; do
      [ -n "$s" ] || continue
      next=$(next_run "$s")
      if [ "$first" = 1 ]; then printf '%-24s %-18s %-22s %s\n' "$n" "$s" "$last" "$next"
      else printf '%-24s %-18s %-22s %s\n' "" "$s" "" "$next"; fi
      first=0
    done < <(schedules "$f")
    if [ "$first" = 1 ]; then printf '%-24s %-18s %-22s %s\n' "$n" "-" "$last" "-"; fi
  done
  return 0
}

cmd_run() {
  [ $# -eq 1 ] || die "usage: autonomy.sh run <loop>"
  valid_loop "$1"
  if [ -e "$OFF" ]; then
    echo "refused: the kill switch is on ($(tr '\n' ' ' <"$OFF" | sed 's/ *$//')). Run 'autonomy.sh on' first." >&2
    return 1
  fi
  local dir f
  dir=$(routines_dir) || exit 2
  f="$dir/$1.md"
  [ -f "$f" ] || { echo "autonomy: no loop '$1' ($f does not exist)" >&2; return 1; }
  echo "routine: $f"
  echo "Run this prompt once now, as the scheduled task would:"
  echo "-----"
  body "$f"
  echo "-----"
  cmd_stamp "$1"
}

usage() { sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

sub="${1:-}"; [ $# -gt 0 ] && shift
case "$sub" in
  check) cmd_check ;;
  off) cmd_off "$@" ;;
  on) cmd_on ;;
  status) cmd_status ;;
  stamp) cmd_stamp "$@" ;;
  run) cmd_run "$@" ;;
  ""|-h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
