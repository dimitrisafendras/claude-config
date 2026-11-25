#!/usr/bin/env bash
# Test install.sh --check in a temporary HOME: it must find each planted difference and exit 1.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/.claude"
fail=0
expect() { echo "$out" | grep -q -- "$1" || { echo "FAIL: no line matches: $1"; fail=1; }; }

# Git Bash copies on "ln -s" unless it is told to make native Windows links (install.sh does the same).
case "$(uname -s)" in
  MINGW*|MSYS*) export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict";;
  CYGWIN*) export CYGWIN="${CYGWIN:+$CYGWIN }winsymlinks:nativestrict";;
esac
LINKS=1
if ! { ln -s "$ROOT/install.sh" "$T/link-probe" 2>/dev/null && [ -L "$T/link-probe" ]; }; then
  LINKS=""
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      if [ -n "${CI:-}" ]; then echo "FAIL: no symbolic links here, and CI is set"; fail=1
      else echo "skipped: no symbolic links here (tests 6, 9 and 10)"; fi;;
    *) echo "FAIL: cannot make a symbolic link in $T"; fail=1;;
  esac
fi
rm -f "$T/link-probe"

# 1. A flag that is false in the repo and true locally, a changed scalar, an extra plugin, no permissions.
jq '.enabledPlugins["superpowers@claude-plugins-official"]=true | .effortLevel="high"
    | .enabledPlugins["foo@bar"]=true | .permissions.allow=[]' "$ROOT/claude/settings.json" > "$T/.claude/settings.json"
out=$(HOME="$T" bash "$ROOT/install.sh" --check); rc=$?
[ "$rc" = 1 ] || { echo "FAIL: exit $rc, want 1"; fail=1; }
expect 'enabledPlugins.superpowers@claude-plugins-official: repo false, local true'
expect 'effortLevel: repo "medium", local "high"'
expect 'plugin on locally, not in repo settings: foo@bar'
expect 'permission not in local settings: mcp__ccd_session_mgmt__archive_session'
expect 'link: .*CLAUDE.md does not point to'

# 2. The same settings as the repo: no setting, permission or plugin line.
cp "$ROOT/claude/settings.json" "$T/.claude/settings.json"
out=$(HOME="$T" bash "$ROOT/install.sh" --check)
if echo "$out" | grep -E '^(setting|permission|plugin) ' ; then echo "FAIL: drift reported for equal settings"; fail=1; fi

# 3. The permission merge joins the lists.
# Files, not <(...): jq.exe on Windows cannot open the /proc/<pid>/fd paths of bash process substitution.
jq '.permissions.allow += ["local-only"]' "$ROOT/claude/settings.json" > "$T/local.json"
n=$(jq -s '(.[0] * .[1]) + {permissions: ((.[0].permissions // {}) * (.[1].permissions // {})
    + {allow: (((.[0].permissions.allow // []) + (.[1].permissions.allow // [])) | unique)})}
    | .permissions.allow | index("local-only") != null' "$T/local.json" "$ROOT/claude/settings.json")
[ "$n" = true ] || { echo "FAIL: merge dropped a local permission"; fail=1; }

# 4. A profile (the first one in profiles/): its links and permissions are checked; an unknown profile is refused.
PROF=$(ls "$ROOT/profiles" | head -1)
PSKILL=$(ls "$ROOT/profiles/$PROF/skills" | head -1)
PSRC=$(ls "$ROOT/profiles/$PROF/start-work.d" | head -1)
out=$(HOME="$T" bash "$ROOT/install.sh" --check --profile "$PROF")
expect 'link: .*profile.md does not point to'
expect "link: .*skills/$PSKILL does not point to"
expect "link: .*start-work.d/$PSRC does not point to"
expect 'permission not in local settings: Bash(gh pr merge'
out=$(HOME="$T" bash "$ROOT/install.sh" --check --profile nope 2>&1); rc=$?
[ "$rc" = 2 ] || { echo "FAIL: unknown profile gave exit $rc, want 2"; fail=1; }
# 5. Without a profile, no profile link is expected.
out=$(HOME="$T" bash "$ROOT/install.sh" --check --no-profile)
echo "$out" | grep -q "does not point to.*skills/$PSKILL" && { echo "FAIL: core check expects a profile skill"; fail=1; }

# 6. A link into the repo that is not wanted (a profile that is off) is drift.
if [ -n "$LINKS" ]; then
  mkdir -p "$T/.claude/skills"; ln -sfn "$ROOT/profiles/$PROF/skills/$PSKILL" "$T/.claude/skills/$PSKILL"
  out=$(HOME="$T" bash "$ROOT/install.sh" --check --no-profile)
  expect "link: .*skills/$PSKILL is not wanted"
  rm -f "$T/.claude/skills/$PSKILL"
fi

# 7. A profile by path, outside the repo: its links are checked, and the record holds the path.
PP="$T/my-profile"; cp -R "$ROOT/profiles/example" "$PP"
out=$(HOME="$T" bash "$ROOT/install.sh" --check --profile "$PP")
expect 'link: .*profile.md does not point to '"$PP"
expect "link: .*skills/release-notes does not point to $PP"
echo "$PP" > "$T/.claude/claude-config.profile"
out=$(HOME="$T" bash "$ROOT/install.sh" --check)
expect "link: .*start-work.d/tracker.md does not point to $PP"
rm "$T/.claude/claude-config.profile"

# 8. The repo record (~/.claude/claude-config.repo): missing or another path is drift; this checkout is not.
rm -f "$T/.claude/claude-config.repo"
out=$(HOME="$T" bash "$ROOT/install.sh" --check)
expect 'repo: .*claude-config.repo is missing'
echo "$T/elsewhere" > "$T/.claude/claude-config.repo"
out=$(HOME="$T" bash "$ROOT/install.sh" --check)
expect "repo: .*claude-config.repo points to '$T/elsewhere'"
echo "$ROOT" > "$T/.claude/claude-config.repo"
out=$(HOME="$T" bash "$ROOT/install.sh" --check)
if echo "$out" | grep 'claude-config.repo'; then echo "FAIL: drift reported for a correct repo record"; fail=1; fi

# 9. A real install into an empty HOME, from a copy of the repo (a main checkout, not a worktree).
# A stub "claude" on PATH takes the plugin commands, so nothing outside the temporary folder changes.
# The install must record the repo, and a check right after it must find no drift.
if [ -n "$LINKS" ]; then
  R="$T/repo"; H="$T/home9"; mkdir -p "$R" "$H/.claude" "$T/bin"
  cp -R "$ROOT/install.sh" "$ROOT/claude" "$R/"
  git -C "$R" init -q -b main
  R="$(cd "$R" && pwd)"
  printf '#!/bin/sh\nexit 0\n' > "$T/bin/claude"; chmod +x "$T/bin/claude"
  out=$(HOME="$H" USERPROFILE="$H" PATH="$T/bin:$PATH" bash "$R/install.sh" 2>&1); rc=$?
  [ "$rc" = 0 ] || { echo "FAIL: install gave exit $rc"; echo "$out" | tail -5; fail=1; }
  got=$( [ -f "$H/.claude/claude-config.repo" ] && cat "$H/.claude/claude-config.repo" || echo none)
  [ "$got" = "$R" ] || { echo "FAIL: install recorded the repo '$got', want '$R'"; fail=1; }
  out=$(HOME="$H" USERPROFILE="$H" PATH="$T/bin:$PATH" bash "$R/install.sh" --check 2>&1); rc=$?
  [ "$rc" = 0 ] || { echo "FAIL: check after install gave exit $rc, want 0:"; echo "$out" | head -10; fail=1; }
fi

# 10. merge-policy.json of a profile: copied once, never overwritten, and not made when the profile has none.
# It permits merges with no prompt, so an install must never change a file that is already there.
if [ -n "$LINKS" ]; then
  R="$T/repo10"; H="$T/home10"; mkdir -p "$R" "$H/.claude" "$T/bin"
  cp -R "$ROOT/install.sh" "$ROOT/claude" "$R/"
  git -C "$R" init -q -b main
  R="$(cd "$R" && pwd)"
  printf '#!/bin/sh\nexit 0\n' > "$T/bin/claude"; chmod +x "$T/bin/claude"
  P10="$T/profile10"; cp -R "$ROOT/profiles/example" "$P10"
  printf '{\n  "repos": {},\n  "requireGreen": true,\n  "allowAdmin": false\n}\n' > "$P10/merge-policy.json"
  # (a) the first install copies the file, with the same content, and says what it does.
  out=$(HOME="$H" USERPROFILE="$H" PATH="$T/bin:$PATH" bash "$R/install.sh" --profile "$P10" 2>&1); rc=$?
  [ "$rc" = 0 ] || { echo "FAIL: profile install gave exit $rc"; echo "$out" | tail -5; fail=1; }
  expect "copied merge-policy.json (it permits gh pr merge with no prompt"
  if [ -f "$H/.claude/merge-policy.json" ] && cmp -s "$P10/merge-policy.json" "$H/.claude/merge-policy.json"; then :
  else echo "FAIL: merge-policy.json was not copied with the same content"; fail=1; fi
  # (b) a second install does not overwrite a changed file.
  printf '{"repos":{},"requireGreen":false,"allowAdmin":false}\n' > "$H/.claude/merge-policy.json"
  cp "$H/.claude/merge-policy.json" "$T/policy10.changed"
  out=$(HOME="$H" USERPROFILE="$H" PATH="$T/bin:$PATH" bash "$R/install.sh" --profile "$P10" 2>&1); rc=$?
  [ "$rc" = 0 ] || { echo "FAIL: second profile install gave exit $rc"; echo "$out" | tail -5; fail=1; }
  cmp -s "$T/policy10.changed" "$H/.claude/merge-policy.json" || { echo "FAIL: a second install changed merge-policy.json"; fail=1; }
  if echo "$out" | grep -q "copied merge-policy.json"; then echo "FAIL: a second install says it copied merge-policy.json"; fail=1; fi
  # (c) a profile without the file makes none.
  H="$T/home10b"; mkdir -p "$H/.claude"; rm "$P10/merge-policy.json"
  out=$(HOME="$H" USERPROFILE="$H" PATH="$T/bin:$PATH" bash "$R/install.sh" --profile "$P10" 2>&1); rc=$?
  [ "$rc" = 0 ] || { echo "FAIL: install of a profile without a policy gave exit $rc"; echo "$out" | tail -5; fail=1; }
  [ ! -e "$H/.claude/merge-policy.json" ] || { echo "FAIL: merge-policy.json made from a profile that has none"; fail=1; }
fi

[ "$fail" = 0 ] && echo "install-check: all tests passed"
exit "$fail"
