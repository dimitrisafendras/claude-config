#!/usr/bin/env bash
# One-way sync: your local Claude preferences -> a checkout of this repo. Local wins. Never the other way.
#
# Usage: prefs-sync.sh --check [--repo <dir>]   change nothing; list what differs; exit 1 when something differs
#        prefs-sync.sh --apply --repo <dir>     write the differences into <dir> (a worktree of this repo, never the main checkout)
# Reads $CLAUDE_HOME (default ~/.claude). Needs jq.
#
# What it syncs (the desktop app preferences are not here: only Claude can read them, see the sync-prefs skill):
#   settings.json   a fixed list of keys -> claude/settings.json. The permissions and the plugins of the profile's own
#                   marketplace -> profiles/<profile>/settings.json (they can name company repos).
#   copied files    cheat-buttons.json, projects.conf, work-monitor-url, cheat-sheet-url -> profiles/<profile>/
# What it never syncs: extraKnownMarketplaces and hooks (they hold paths of this computer), env (secrets), the
# plugins of the claude-config marketplaces (install.sh --mods owns them), anything outside the list above.
# Without a recorded profile (~/.claude/claude-config.profile) the profile parts are skipped and said so.
set -euo pipefail

MODE=""; REPO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check;;
    --apply) MODE=apply;;
    --repo) REPO="${2:?--repo needs a folder}"; shift;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
  shift
done
[ -n "$MODE" ] || { echo "usage: prefs-sync.sh --check|--apply [--repo <dir>]" >&2; exit 2; }
D="${CLAUDE_HOME:-$HOME/.claude}"
L="$D/settings.json"
if [ -z "$REPO" ]; then
  [ "$MODE" = check ] || { echo "--apply needs --repo <dir>" >&2; exit 2; }
  SELF="${BASH_SOURCE[0]}"; [ -L "$SELF" ] && SELF="$(readlink "$SELF")"   # install.sh links this script into ~/.claude
  REPO="$(cd "$(dirname "$SELF")" && pwd -P)"; REPO="${REPO%/claude/scripts}"
fi
[ -f "$REPO/claude/settings.json" ] || { echo "not a claude-config checkout: $REPO" >&2; exit 2; }
[ -f "$L" ] || { echo "no $L" >&2; exit 2; }
if [ "$MODE" = apply ]; then
  main="$(git -C "$REPO" rev-parse --git-common-dir 2>/dev/null)"; here="$(git -C "$REPO" rev-parse --git-dir 2>/dev/null)"
  [ -n "$main" ] && [ "$main" = "$here" ] && { echo "refusing to write into the main checkout: use a worktree" >&2; exit 2; }
fi

PROFILE=""; [ -f "$D/claude-config.profile" ] && PROFILE="$(tr -d '[:space:]' < "$D/claude-config.profile")"
# Only a profile inside this repo is synced here: one in another repo has its own git.
PDIR=""; case "$PROFILE" in ""|*/*|~*) ;; *) [ -d "$REPO/profiles/$PROFILE" ] && PDIR="$REPO/profiles/$PROFILE";; esac
CORE="$REPO/claude/settings.json"
PSET="${PDIR:+$PDIR/settings.json}"

# Keys that travel. Local wins: a key set here is copied, a key not set here is removed from the repo.
KEYS='["agentPushNotifEnabled","autoCompactWindow","editorMode","effortLevel","model","outputStyle","skipWorkflowUsageWarning","statusLine","theme","tui"]'
MARKET="${PROFILE:+@claude-config-$PROFILE}"   # the plugins of the profile's marketplace belong to the profile

# The new core file: the old one, with the list of keys and the plugins (not of claude-config) from the local file.
new_core() {
  jq --slurpfile loc "$L" --argjson keys "$KEYS" '
    ($loc[0]) as $l
    | reduce $keys[] as $k (.; if ($l|has($k)) then .[$k] = $l[$k] else del(.[$k]) end)
    | .enabledPlugins = ($l.enabledPlugins // {} | with_entries(select(.key | test("@claude-config") | not)))' "$CORE"
}
# The new profile file: the permissions, and the plugins of the profile's marketplace.
new_profile() {
  jq --slurpfile loc "$L" --arg m "$MARKET" '
    ($loc[0]) as $l
    | (if ($l|has("permissions")) then .permissions = $l.permissions else del(.permissions) end)
    | (if $m == "" then . else
        ($l.enabledPlugins // {} | with_entries(select(.key | endswith($m)))) as $p
        | if ($p|length) > 0 then .enabledPlugins = $p else del(.enabledPlugins) end end)' "$PSET"
}

diffs=0
note() { echo "$1"; diffs=$((diffs + 1)); }
# put <target> <new content file> <label>
put() {
  if [ -f "$1" ] && cmp -s "$1" "$2"; then return 0; fi
  note "$3"
  [ "$MODE" = apply ] && { mkdir -p "$(dirname "$1")"; cp "$2" "$1"; }
  return 0
}
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

new_core | jq -S . > "$T/core"; jq -S . "$CORE" > "$T/core.old"
if ! cmp -s "$T/core" "$T/core.old"; then
  note "changed: claude/settings.json ($(diff <(jq -c 'to_entries[]' "$T/core.old") <(jq -c 'to_entries[]' "$T/core") | grep -c '^[<>]') lines differ)"
  [ "$MODE" = apply ] && jq . "$T/core" > "$CORE.tmp" && mv "$CORE.tmp" "$CORE"
fi

if [ -n "$PDIR" ]; then
  [ -f "$PSET" ] || { echo '{}' > "$T/base"; PSET="$T/base"; }
  new_profile | jq -S . > "$T/prof"; jq -S . "$PSET" > "$T/prof.old"
  if ! cmp -s "$T/prof" "$T/prof.old"; then
    note "changed: profiles/$PROFILE/settings.json (permissions or plugins of the profile)"
    [ "$MODE" = apply ] && jq . "$T/prof" > "$PDIR/settings.json.tmp" && mv "$PDIR/settings.json.tmp" "$PDIR/settings.json"
  fi
  for f in cheat-buttons.json projects.conf work-monitor-url cheat-sheet-url; do
    [ -f "$D/$f" ] || continue
    if [ -f "$PDIR/$f" ] && cmp -s "$D/$f" "$PDIR/$f"; then continue; fi
    note "changed: profiles/$PROFILE/$f"
    [ "$MODE" = apply ] && cp "$D/$f" "$PDIR/$f"
  done
else
  echo "skipped: no profile recorded (or no such profile folder), so permissions and the copied files stay local" >&2
fi

if [ "$diffs" = 0 ]; then echo "in sync: nothing to send to the repo"; exit 0; fi
[ "$MODE" = apply ] && { echo "applied $diffs change(s) in $REPO"; exit 0; }
exit 1
