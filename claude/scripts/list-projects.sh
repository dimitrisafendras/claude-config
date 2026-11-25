#!/usr/bin/env bash
# Lists every project (git repository) in the projects folder. One line each:
#   <folder> <surfaces> [board]
# surfaces are found from the files in the repo: web, mobile, backend, infra, lib, docs, other.
# No list of projects is kept: a new clone shows up at once.
#
# Folder: $PROJECTS_DIR, default ~/Projects. Only folders that hold a .git directory (a main checkout).
# Optional overrides in $PROJECTS_CONF, default ~/.claude/projects.conf, one per line:
#   <folder> <surfaces> [board]   replace what was found for that folder
#   !<folder>                       leave that folder out
# "board" marks the project that owns the ticket board.
set -uo pipefail
ROOT="${PROJECTS_DIR:-$HOME/Projects}"
CONF="${PROJECTS_CONF:-$HOME/.claude/projects.conf}"

surfaces_of() {
  local d="$1" files out=()
  files=$(git -C "$d" ls-files 2>/dev/null | grep -v -E '(^|/)(node_modules|vendor|dist|build)/' | head -20000)
  [ -n "$files" ] || { echo other; return; }
  # mobile: an Expo or React Native app, or a native project
  if echo "$files" | grep -E '(^|/)app\.json$' | head -5 | while read -r f; do grep -q -E '"expo"' "$d/$f" 2>/dev/null && echo y; done | grep -q y \
     || echo "$files" | grep -q -E '\.xcodeproj/|(^|/)android/app/build\.gradle'; then out+=(mobile); fi
  echo "$files" | grep -q -E '(^|/)package\.json$' && out+=(web)
  echo "$files" | grep -q -E '(^|/)(go\.mod|Cargo\.toml|pyproject\.toml|requirements\.txt|pom\.xml|build\.gradle|Gemfile|mix\.exs)$' && out+=(backend)
  echo "$files" | grep -q -E '(^|/)(Dockerfile|Chart\.yaml|[^/]+\.tf)$|(^|/)(helm|k8s|terraform)/' && out+=(infra)
  if [ "${#out[@]}" -eq 0 ]; then
    if echo "$files" | grep -q -E '\.(md|rst|adoc)$'; then
      [ "$(echo "$files" | grep -c -v -E '\.(md|rst|adoc|png|jpe?g|svg|json|ya?ml)$')" -lt 3 ] && out+=(docs)
    fi
  fi
  [ "${#out[@]}" -eq 0 ] && out+=(other)
  local IFS=,; echo "${out[*]}"
}

declare -a skip=()
declare -a over_dir=() over_line=()
if [ -f "$CONF" ]; then
  while IFS= read -r line; do
    line=${line%%#*}; set -- $line
    [ $# -gt 0 ] || continue
    case "$1" in !*) skip+=("${1#!}");; *) over_dir+=("$1"); over_line+=("$*");; esac
  done <"$CONF"
fi

for d in "$ROOT"/*/; do
  name=$(basename "$d")
  [ -d "$d/.git" ] || continue
  hit=0
  for s in "${skip[@]:-}"; do [ "$s" = "$name" ] && hit=1; done
  [ "$hit" = 1 ] && continue
  line=""
  for i in "${!over_dir[@]}"; do [ "${over_dir[$i]}" = "$name" ] && line="${over_line[$i]}"; done
  if [ -n "$line" ]; then echo "$line"; else echo "$name $(surfaces_of "$d")"; fi
done
