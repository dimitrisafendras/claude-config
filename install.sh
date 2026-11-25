#!/usr/bin/env bash
# Install the Claude Code plugins, merge the settings and link the repo files into ~/.claude.
# Core (claude/) is generic. A profile (profiles/<name>/) adds company or personal parts on top.
# Safe to rerun: marketplace and plugin adds are idempotent.
#
# Usage: ./install.sh                      install the core (and the profile that is recorded, if any)
#        ./install.sh --profile <name>     install the core and profiles/<name> of this repo; the name is recorded
#        ./install.sh --profile <path>     install the core and a profile folder anywhere (your private repo); the path is recorded
#        ./install.sh --no-profile         install the core only and forget the recorded profile
#        ./install.sh --check              change nothing; list where ~/.claude differs from this repo; exit 1 on drift
#        ./install.sh --mods               install the mods (core, and the profile's) as local marketplaces
# Run it from the main checkout, never from a worktree.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$HERE/claude/settings.json"
C="$HERE/claude"; D="$HOME/.claude"; L="$D/settings.json"
RECORD="$D/claude-config.profile"
# jq.exe on Windows writes CRLF. A CR at the end of a value breaks names ("plugin@market\r" is not found).
jq() { command jq "$@" | tr -d '\r'; }

MODE=install; PROFILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check;;
    --mods) MODE=mods;;
    --profile) PROFILE="${2:?--profile needs a name}"; shift;;
    --no-profile) PROFILE=none;;
    *) echo "unknown option: $1" >&2; exit 2;;
  esac
  shift
done
if [ -z "$PROFILE" ] && [ -f "$RECORD" ]; then PROFILE="$(tr -d '[:space:]' < "$RECORD")"; fi
[ "$PROFILE" = none ] && PROFILE=""
# A profile is a name under profiles/ of this repo, or a path to a profile folder in any repo (recorded as given).
PR=""
if [ -n "$PROFILE" ]; then
  case "$PROFILE" in
    */*|.|..|~*) PR="${PROFILE/#\~/$HOME}"; [ -d "$PR" ] && PR="$(cd "$PR" && pwd)";;
    *) PR="$HERE/profiles/$PROFILE";;
  esac
  [ -d "$PR" ] || { echo "no such profile: $PROFILE (a folder in profiles/: $(ls "$HERE/profiles" 2>/dev/null | tr '\n' ' '); or a path)" >&2; exit 2; }
fi
SETTINGS=("$S"); [ -n "$PR" ] && [ -f "$PR/settings.json" ] && SETTINGS+=("$PR/settings.json")

# The links to make, one "source<TAB>target" per line. Skills are found by folder, so a new skill needs no list.
links() {
  printf '%s\t%s\n' "$C/CLAUDE.md" "$D/CLAUDE.md" "$C/output-styles/ste.md" "$D/output-styles/ste.md" \
    "$C/agents/pr-reviewer.md" "$D/agents/pr-reviewer.md"
  local d f
  for d in "$C"/skills/*/; do printf '%s\t%s\n' "${d%/}" "$D/skills/$(basename "$d")"; done
  for f in "$C"/scripts/*; do printf '%s\t%s\n' "$f" "$D/$(basename "$f")"; done
  [ -n "$PR" ] || return 0
  for d in "$PR"/skills/*/; do [ -d "$d" ] && printf '%s\t%s\n' "${d%/}" "$D/skills/$(basename "$d")"; done
  [ -f "$PR/profile.md" ] && printf '%s\t%s\n' "$PR/profile.md" "$D/profile.md"
  for f in "$PR"/start-work.d/*; do [ -f "$f" ] && printf '%s\t%s\n' "$f" "$D/start-work.d/$(basename "$f")"; done
  return 0
}

if [ "$MODE" = mods ]; then
  # Not part of a plain install, because mods change how every session works (some refuse tool calls).
  # Turn one off with: claude plugin disable <mod>@<marketplace>
  claude plugin marketplace add "$HERE" || claude plugin marketplace update claude-config || true
  for d in "$HERE"/mods/*/; do
    m=$(basename "$d")
    claude plugin install "$m@claude-config" || claude plugin enable "$m@claude-config" || true
  done
  if [ -n "$PR" ] && [ -f "$PR/.claude-plugin/marketplace.json" ]; then
    # The profile's marketplace has its own name (in its marketplace.json).
    pm=$(jq -r .name "$PR/.claude-plugin/marketplace.json")
    claude plugin marketplace add "$PR" || claude plugin marketplace update "$pm" || true
    for d in "$PR"/mods/*/; do
      m=$(basename "$d")
      claude plugin install "$m@$pm" || claude plugin enable "$m@$pm" || true
    done
  fi
  echo "Done. Restart Claude Code. merge-policy gives no permission until ~/.claude/merge-policy.json exists."
  exit 0
fi

if [ "$MODE" = check ]; then
  drift=0
  say() { echo "$1"; drift=1; }
  [ -f "$L" ] || { echo "missing: $L"; exit 1; }
  for SF in "${SETTINGS[@]}"; do
    # Each scalar setting in the repo (plugin flags included) must have the same value locally.
    while read -r line; do
      [ -n "$line" ] && say "$line"
    done < <(jq -rn --slurpfile r "$SF" --slurpfile l "$L" '$r[0] as $r | $l[0] as $l
      | [$r | paths(type != "object" and type != "array")][] | select(.[0] != "permissions") as $p
      | select(($r | getpath($p)) != ($l | getpath($p)))
      | "setting \($p | map(tostring) | join(".")): repo \($r | getpath($p) | tojson), local \($l | getpath($p) | tojson)"')
    # Each repo permission must be in the local allow list.
    while read -r perm; do
      [ -n "$perm" ] || continue
      jq -e --arg p "$perm" '(.permissions.allow // []) | index($p) != null' "$L" >/dev/null || say "permission not in local settings: $perm"
    done < <(jq -r '.permissions.allow[]?' "$SF")
  done
  # Plugins that are on locally but that the repo does not list.
  while read -r p; do
    [ -n "$p" ] && say "plugin on locally, not in repo settings: $p"
  done < <(jq -r --slurpfile r "$S" '(.enabledPlugins // {}) | to_entries[] | select(.value) | .key
    | select((endswith("@claude-config") or contains("@claude-config-")) | not) | . as $k | select(($r[0].enabledPlugins // {}) | has($k) | not)' "$L")
  # The links into the repo.
  while IFS=$'\t' read -r src dst; do
    [ "$(readlink "$dst" 2>/dev/null)" = "$src" ] || say "link: $dst does not point to $src"
  done < <(links)
  # A link into this repo or the profile that is no longer asked for (a removed skill, or a profile that is off).
  want=$(links | cut -f2)
  for l in "$D"/skills/* "$D"/start-work.d/*; do
    [ -L "$l" ] || continue
    case "$(readlink "$l")" in "$HERE"/*|"${PR:-/nonexistent}"/*) echo "$want" | grep -qxF "$l" || say "link: $l is not wanted (target ${l:+$(readlink "$l")})";; esac
  done
  [ "$PROFILE" = "$( [ -f "$RECORD" ] && cat "$RECORD" || true )" ] || say "profile: recorded '$( [ -f "$RECORD" ] && cat "$RECORD" || true )', repo run with '$PROFILE'"
  # The links serve whatever this checkout has, so it must be on main.
  br=$(git -C "$HERE" branch --show-current)
  [ "$br" = "main" ] || say "repo: checkout is on '$br', not main"
  [ "$drift" = 0 ] && echo "no drift: ~/.claude matches the repo${PROFILE:+ (profile: $PROFILE)}"
  exit "$drift"
fi

# A run from a worktree would point every link into that worktree, and the links break when it goes.
if [ "$(git -C "$HERE" rev-parse --git-dir)" != "$(git -C "$HERE" rev-parse --git-common-dir)" ]; then
  echo "stop: $HERE is a git worktree. Run install.sh from the main checkout." >&2
  exit 1
fi

# Git Bash and Cygwin copy on "ln -s" unless they are told to make native Windows links.
case "$(uname -s)" in
  MINGW*|MSYS*) export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict";;
  CYGWIN*) export CYGWIN="${CYGWIN:+$CYGWIN }winsymlinks:nativestrict";;
esac
# Make one test link before anything changes. Without links the link step would move files away and stop part way.
mkdir -p "$D"
probe="$D/.install-link-test.$$"
if ln -s "$C/CLAUDE.md" "$probe" 2>/dev/null && [ -L "$probe" ]; then
  rm -f "$probe"
else
  rm -rf "$probe"
  echo "stop: cannot make a symbolic link in $D. Nothing changed." >&2
  echo "On Windows, turn on Developer Mode (Settings > System > For developers), then run install.sh again." >&2
  exit 1
fi

# Back up the settings first: the plugin commands below also write to settings.json.
[ -f "$L" ] && cp "$L" "$L.bak-install"

# Marketplaces and plugins: read from claude/settings.json.
jq -r '(.extraKnownMarketplaces // {})[].source.repo' "$S" | while read -r repo; do
  claude plugin marketplace add "$repo" || true
done
jq -r '.enabledPlugins | to_entries[] | select(.value) | .key' "$S" | while read -r plugin; do
  claude plugin install "$plugin" || claude plugin enable "$plugin" || true
done

# Settings: merge the repo settings (core, then profile) into ~/.claude/settings.json (repo values win).
# The permission lists are joined, not replaced, so local permissions stay.
[ -f "$L" ] || echo '{}' > "$L"
for SF in "${SETTINGS[@]}"; do
  jq -s '(.[0] * .[1]) + {permissions: ((.[0].permissions // {}) * (.[1].permissions // {})
    + {allow: (((.[0].permissions.allow // []) + (.[1].permissions.allow // [])) | unique)})}' \
    "$L" "$SF" > "$L.tmp"
  mv "$L.tmp" "$L"
done
echo "installed plugins and merged settings.json (old file: settings.json.bak-install)"

# Global instructions, output style, skills, agents and scripts: symlinked, so the repo is the one source.
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$D/output-styles" "$D/skills" "$D/agents" "$D/start-work.d"
BK="$D/backups/install-$STAMP"  # outside skills/ and agents/, so Claude Code does not load the backups
link() {  # link <source> <target>; a real file or folder at <target> is moved into $BK first
  local src="$1" dst="$2" rel="${2#"$D"/}" moved=""
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    mkdir -p "$BK/$(dirname "$rel")"; mv "$dst" "$BK/$rel"; moved=1; echo "moved $dst to $BK/$rel"
  fi
  if ! ln -sfn "$src" "$dst"; then  # put the file back, so a failed link never leaves a gap
    [ -n "$moved" ] && [ ! -e "$dst" ] && mv "$BK/$rel" "$dst" && echo "put back $dst" >&2
    return 1
  fi
}
while IFS=$'\t' read -r src dst; do link "$src" "$dst"; done < <(links)
if [ -n "$PR" ]; then
  for f in projects.conf work-monitor-url cheat-sheet-url cheat-buttons.json; do  # copied, not linked: yours to edit; never overwritten
    if [ -f "$PR/$f" ] && [ ! -e "$D/$f" ]; then cp "$PR/$f" "$D/$f"; echo "copied $f (yours to edit)"; fi
  done
  echo "$PROFILE" > "$RECORD"
elif [ -f "$RECORD" ] || [ "$PROFILE" = "" ]; then
  rm -f "$RECORD" "$D/profile.md"
fi
want=$(links | cut -f2)  # remove links into this repo or the profile that are no longer wanted (a profile turned off, a skill removed)
for l in "$D"/skills/* "$D"/start-work.d/*; do
  [ -L "$l" ] || continue
  case "$(readlink "$l")" in "$HERE"/*|"${PR:-/nonexistent}"/*) echo "$want" | grep -qxF "$l" || { rm "$l"; echo "removed link $l"; };; esac
done
echo "linked CLAUDE.md, ASD-STE100 output style, skills, pr-reviewer, scripts${PROFILE:+, profile $PROFILE}"

echo
echo "Done. Restart Claude Code. Then run ./install.sh --check."
