#!/usr/bin/env bash
# Test install.sh --check in a temporary HOME: it must find each planted difference and exit 1.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/.claude"
fail=0
expect() { echo "$out" | grep -q -- "$1" || { echo "FAIL: no line matches: $1"; fail=1; }; }

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
n=$(jq -s '(.[0] * .[1]) + {permissions: ((.[0].permissions // {}) * (.[1].permissions // {})
    + {allow: (((.[0].permissions.allow // []) + (.[1].permissions.allow // [])) | unique)})}
    | .permissions.allow | index("local-only") != null' \
    <(jq '.permissions.allow += ["local-only"]' "$ROOT/claude/settings.json") "$ROOT/claude/settings.json")
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
mkdir -p "$T/.claude/skills"; ln -sfn "$ROOT/profiles/$PROF/skills/$PSKILL" "$T/.claude/skills/$PSKILL"
out=$(HOME="$T" bash "$ROOT/install.sh" --check --no-profile)
expect "link: .*skills/$PSKILL is not wanted"

[ "$fail" = 0 ] && echo "install-check: all tests passed"
exit "$fail"

# 5. A profile by path, outside the repo: its links are checked, and the record holds the path.
PP="$T/my-profile"; cp -R "$ROOT/profiles/example" "$PP"
out=$(HOME="$T" bash "$ROOT/install.sh" --check --profile "$PP")
expect 'link: .*profile.md does not point to '"$PP"
expect "link: .*skills/release-notes does not point to $PP"
echo "$PP" > "$T/.claude/claude-config.profile"
out=$(HOME="$T" bash "$ROOT/install.sh" --check)
expect "link: .*start-work.d/tracker.md does not point to $PP"
rm "$T/.claude/claude-config.profile"
