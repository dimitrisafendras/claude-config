#!/usr/bin/env bash
# merge-when-green.sh: a cancelled or failed check is red (exit 4, no merge call);
# all checks passing merges (exit 0). A fake gh is first on PATH. Pending is not tested (60 s sleep).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
cat >"$T/bin/gh" <<'GH'
#!/usr/bin/env bash
# Fake gh: pr view -> "OPEN MERGEABLE"; pr checks -> $FAKE_CHECKS; pr merge -> recorded in $FAKE_LOG.
case "$1 $2" in
  "pr view") echo "OPEN MERGEABLE" ;;
  "pr checks") printf '%b' "$FAKE_CHECKS" ;;
  "pr merge") echo "$*" >>"$FAKE_LOG" ;;
esac
GH
chmod +x "$T/bin/gh"

fail=0
chk() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2' expected '$3'"; fail=1; }; }

# run <checks text>: sets OUT, RC, MERGES
run() {
  : >"$T/log"
  OUT=$(PATH="$T/bin:$PATH" FAKE_LOG="$T/log" FAKE_CHECKS="$1" bash "$ROOT/claude/scripts/merge-when-green.sh" -R o/r 7 2>&1); RC=$?
  MERGES=$(wc -l <"$T/log" | tr -d ' ')
}

# the fake must win over a real gh
chk "fake gh is found first" "$(PATH="$T/bin:$PATH" command -v gh)" "$T/bin/gh"

run 'build\tpass\t1m\turl\nlint\tcancel\t1m\turl\n'
chk "cancel: exit" "$RC" "4"
chk "cancel: merge calls" "$MERGES" "0"
chk "cancel: message" "$OUT" "7 red: lint"

run 'build\tpass\t1m\turl\nlint\tfail\t1m\turl\n'
chk "fail: exit" "$RC" "4"
chk "fail: merge calls" "$MERGES" "0"
chk "fail: message" "$OUT" "7 red: lint"

run 'build\tpass\t1m\turl\nlint\tcancel\t1m\turl\ntest\tfail\t1m\turl\n'
chk "cancel and fail: message" "$OUT" "$(printf '7 red: lint\ntest')"

run 'build\tpass\t1m\turl\nlint\tskipping\t0\turl\n'
chk "pass: exit" "$RC" "0"
chk "pass: merge calls" "$MERGES" "1"
chk "pass: merge args" "$(cat "$T/log")" "pr merge 7 -R o/r --squash"
chk "pass: message" "$OUT" "7 merged (squash)"

[ "$fail" = 0 ] && echo "merge-when-green: all tests passed"
exit "$fail"
