#!/usr/bin/env bash
# list-projects.sh finds every git repo in the projects folder, with surfaces from the files,
# and obeys projects.conf (override a line, hide with !folder).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
P="$T/Projects"; mkdir -p "$P"
mk() { mkdir -p "$P/$1" && git -C "$P/$1" init -q && shift && for f in "$@"; do mkdir -p "$(dirname "$P/$REPO/$f")"; : >"$P/$REPO/$f"; done; git -C "$P/$REPO" add -A 2>/dev/null; }
REPO=webapp;  mk webapp  package.json src/index.ts
REPO=api;     mk api     go.mod main.go
REPO=infra;   mk infra   main.tf
REPO=notes;   mk notes   README.md
mkdir -p "$P/not-a-repo"
run() { PROJECTS_DIR="$P" PROJECTS_CONF="${1:-/dev/null}" bash "$ROOT/claude/scripts/list-projects.sh"; }

fail=0
chk() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2' expected '$3'"; fail=1; }; }
out=$(run)
chk "folders" "$(echo "$out" | awk '{print $1}' | tr '\n' ' ')" "api infra notes webapp "
chk "web"     "$(echo "$out" | awk '$1=="webapp"{print $2}')" "web"
chk "backend" "$(echo "$out" | awk '$1=="api"{print $2}')" "backend"
chk "infra"   "$(echo "$out" | awk '$1=="infra"{print $2}')" "infra"
chk "docs"    "$(echo "$out" | awk '$1=="notes"{print $2}')" "docs"
printf '# c\n!notes\nwebapp web,mobile board\n' >"$T/conf"
out=$(run "$T/conf")
chk "hidden"   "$(echo "$out" | grep -c '^notes ')" "0"
chk "override" "$(echo "$out" | grep '^webapp ')" "webapp web,mobile board"
[ "$fail" = 0 ] && echo "list-projects: all tests passed"
exit "$fail"
