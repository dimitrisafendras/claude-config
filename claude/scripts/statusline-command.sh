#!/bin/bash
# Claude Code statusline: model · branch · 5h pct → reset · 7d pct → reset · ctx pct
#
# Example: Fable 5 · ⎇ feat/x* · ⏱ 42% →12:31 · 📅 87% →Sun 10:31 · ◔ 63%
#
# Segments are joined with a dim-gray " · " separator. A segment whose data is
# not available (rate limits before the first API response, context usage
# before the first message, a folder that is not a git repo) is omitted.

input=$(cat)

# --- colors -----------------------------------------------------------
RESET=$'\033[0m'
DIM=$'\033[38;5;244m'   # separators / glyphs / reset arrows
CYAN=$'\033[36m'        # model name
GREEN=$'\033[32m'       # pct < 50
YELLOW=$'\033[33m'      # 50 <= pct < 80
RED=$'\033[31m'         # pct >= 80

pct_color() {
  local v="$1"
  if [ "$v" -ge 80 ]; then
    printf '%s' "$RED"
  elif [ "$v" -ge 50 ]; then
    printf '%s' "$YELLOW"
  else
    printf '%s' "$GREEN"
  fi
}

# Renders "→HH:MM" (fmt="+%H:%M") or "→Ddd HH:MM" (fmt="+%a %H:%M") in the
# user's local timezone from a unix-epoch-seconds value. Empty in/out on any
# missing/unparsable input — callers just skip appending it.
reset_arrow() {
  local epoch="$1" fmt="$2"
  [ -z "$epoch" ] && return
  local secs; secs=$(printf '%.0f' "$epoch" 2>/dev/null)
  [ -z "$secs" ] && return
  local rendered; rendered=$(date -r "$secs" "$fmt" 2>/dev/null)
  [ -z "$rendered" ] && return
  printf ' %s→%s%s' "$DIM" "$rendered" "$RESET"
}

# --- data -----------------------------------------------------------
model=$(echo "$input" | jq -r '.model.display_name // empty')
five_hour=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
five_hour_resets=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
seven_day=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
seven_day_resets=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')
ctx_used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')

# Git branch of the session folder, with * when the tree has changes. Fast: two local git calls.
branch=""
if [ -n "$cwd" ] && git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git -C "$cwd" branch --show-current 2>/dev/null)
  [ -z "$branch" ] && branch=$(git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
  [ -n "$(git -C "$cwd" status --porcelain 2>/dev/null | head -1)" ] && branch="${branch}*"
fi

segments=()

[ -n "$model" ] && segments+=("${CYAN}${model}${RESET}")
[ -n "$branch" ] && segments+=("${DIM}⎇${RESET} ${branch}")

if [ -n "$five_hour" ]; then
  rounded=$(printf '%.0f' "$five_hour")
  color=$(pct_color "$rounded")
  arrow=$(reset_arrow "$five_hour_resets" "+%H:%M")
  segments+=("${DIM}⏱${RESET} ${color}${rounded}%${RESET}${arrow}")
fi

if [ -n "$seven_day" ]; then
  rounded=$(printf '%.0f' "$seven_day")
  color=$(pct_color "$rounded")
  arrow=$(reset_arrow "$seven_day_resets" "+%a %H:%M")
  segments+=("${DIM}📅${RESET} ${color}${rounded}%${RESET}${arrow}")
fi

if [ -n "$ctx_used" ]; then
  rounded=$(printf '%.0f' "$ctx_used")
  color=$(pct_color "$rounded")
  segments+=("${DIM}◔${RESET} ${color}${rounded}%${RESET}")
fi

SEP="${DIM} · ${RESET}"

output=""
for segment in "${segments[@]}"; do
  if [ -z "$output" ]; then
    output="$segment"
  else
    output="$output$SEP$segment"
  fi
done

printf '%s' "$output"
