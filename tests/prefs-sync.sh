#!/usr/bin/env bash
# prefs-sync.sh sends local preferences to a repo worktree, one way, and skips what must stay local.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
S="$ROOT/claude/scripts/prefs-sync.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
R="$T/repo"; H="$T/home"
mkdir -p "$R/claude" "$R/profiles/acme" "$H"
git -C "$R" init -q -b main
echo '{"theme":"auto","effortLevel":"low","enabledPlugins":{"a@official":true}}' > "$R/claude/settings.json"
echo '{"permissions":{"allow":["Bash(old)"]}}' > "$R/profiles/acme/settings.json"
git -C "$R" -c core.autocrlf=false add -A &&git -C "$R" -c user.name=t -c user.email=t@t commit -q -m init
git -C "$R" worktree add -q "$T/wt" -b prefs
echo acme > "$H/claude-config.profile"
cat > "$H/settings.json" <<'JSON'
{"theme":"dark","effortLevel":"medium","model":"m1","hooks":{"X":[{"command":"/home/u/x.sh"}]},
 "env":{"TOKEN":"secret"},"extraKnownMarketplaces":{"p":{"path":"/home/u"}},
 "permissions":{"allow":["Bash(new)"]},
 "enabledPlugins":{"a@official":true,"b@official":false,"mod@claude-config":true,"co@claude-config-acme":true}}
JSON
echo '{"buttons":[{"label":"x","command":"/x"}]}' > "$H/cheat-buttons.json"

fail=0
chk() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2' expected '$3'"; fail=1; }; }
export CLAUDE_HOME="$H"
bash "$S" --check --repo "$T/wt" >/dev/null; chk "check finds a difference" "$?" "1"
bash "$S" --apply --repo "$R" >/dev/null 2>&1; chk "refuses the main checkout" "$?" "2"
# run through a link, as install.sh makes it: the repo is found from the link target, with no --repo.
# Git Bash copies on "ln -s" unless it is told to make native Windows links (install.sh does the same).
case "$(uname -s)" in
  MINGW*|MSYS*) export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict";;
  CYGWIN*) export CYGWIN="${CYGWIN:+$CYGWIN }winsymlinks:nativestrict";;
esac
mkdir -p "$T/linkhome"
if ln -s "$S" "$T/linkhome/prefs-sync.sh" 2>/dev/null && [ -L "$T/linkhome/prefs-sync.sh" ]; then
  bash "$T/linkhome/prefs-sync.sh" --check >/dev/null 2>&1; chk "check through a link finds the repo" "$?" "1"
else
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) echo "skipped: no symbolic links here (check through a link)";;
    *) echo "FAIL: cannot make a symbolic link in $T"; fail=1;;
  esac
fi
bash "$S" --apply --repo "$T/wt" >/dev/null 2>&1; chk "apply works" "$?" "0"
C="$T/wt/claude/settings.json"; P="$T/wt/profiles/acme/settings.json"
chk "theme copied"        "$(jq -r .theme "$C")" "dark"
chk "model added"         "$(jq -r .model "$C")" "m1"
chk "hooks stay local"    "$(jq 'has("hooks")' "$C")" "false"
chk "env stays local"     "$(jq 'has("env")' "$C")" "false"
chk "marketplaces local"  "$(jq 'has("extraKnownMarketplaces")' "$C")" "false"
chk "plugins of others"   "$(jq -c '.enabledPlugins|keys' "$C")" '["a@official","b@official"]'
chk "permissions to profile" "$(jq -r '.permissions.allow[0]' "$P")" "Bash(new)"
chk "profile plugin to profile" "$(jq -c '.enabledPlugins|keys' "$P")" '["co@claude-config-acme"]'
chk "buttons copied"      "$(jq -r '.buttons[0].label' "$T/wt/profiles/acme/cheat-buttons.json")" "x"
bash "$S" --check --repo "$T/wt" >/dev/null; chk "in sync after apply" "$?" "0"
# one way: a change in the repo does not flow back
jq '.effortLevel="high"' "$C" > "$C.t" && mv "$C.t" "$C"
bash "$S" --apply --repo "$T/wt" >/dev/null 2>&1
chk "local wins over the repo" "$(jq -r .effortLevel "$C")" "medium"
chk "local file untouched" "$(jq -r .effortLevel "$H/settings.json")" "medium"
# no profile: the profile parts are skipped
rm "$H/claude-config.profile"; rm "$P"
bash "$S" --check --repo "$T/wt" >/dev/null 2>&1; chk "no profile: no profile file made" "$([ -f "$P" ] && echo yes || echo no)" "no"
[ "$fail" = 0 ] && echo "prefs-sync: all tests passed"
exit "$fail"
