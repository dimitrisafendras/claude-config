#!/usr/bin/env bash
# Sourced, not run: audit.sh and tests/mods.sh use newest_claude.
# The claude CLI on PATH can be older than the one that the desktop app brings, and an old CLI
# does not know the newer events. So pick the newest claude CLI that is installed.
# Sources: $CLAUDE_BIN, the claude on PATH, the desktop app's CLI on macOS
# (~/Library/Application Support/Claude/claude-code/<version>/<id>/claude.app) and on Windows
# (%LOCALAPPDATA%/Claude-Data/claude_<id>/claude-code/<version>/<id>/claude.exe).
# Prints "<path><TAB><version>", or nothing when no CLI answers to --version.
newest_claude() {
  local c v best="" bestv=""
  for c in "${CLAUDE_BIN:-}" "$(command -v claude 2>/dev/null)" \
    "$HOME"/Library/Application\ Support/Claude/claude-code/*/*/claude.app/Contents/MacOS/claude \
    "${LOCALAPPDATA:-/nonexistent}"/Claude-Data/claude_*/claude-code/*/*/claude.exe; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    v=$("$c" --version 2>/dev/null | awk '{print $1; exit}')
    [ -n "$v" ] || continue
    if [ -z "$bestv" ] || [ "$(printf '%s\n%s\n' "$bestv" "$v" | sort -V | tail -1)" = "$v" ]; then best=$c; bestv=$v; fi
  done
  [ -n "$best" ] && printf '%s\t%s\n' "$best" "$bestv"
}
