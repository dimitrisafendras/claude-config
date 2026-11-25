#!/usr/bin/env bash
# decisions.sh keeps one format of decision records, replaces by id, and refuses bad input.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export DECISIONS_FILE="$T/d.json"
S="$ROOT/claude/scripts/decisions.sh"
fail=0
chk() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2' expected '$3'"; fail=1; }; }
js() { python3 -X utf8 -c "import json,os;d=json.load(open(os.environ['DECISIONS_FILE']));$1"; }
bad() { if "$@" >/dev/null 2>&1; then echo "FAIL: should refuse: $*"; fail=1; fi; }
bash "$S" add --id t1 --ticket T-1 --question "Ship it?" --option yes --option no --default no >/dev/null
chk "one record" "$(js "print(len(d))")" 1
chk "fields" "$(js "print(sorted(d[0]))")" "['deadline', 'default', 'id', 'options', 'question', 'reversible', 'ticket']"
bash "$S" add --id t1 --ticket T-1 --question "Ship it now?" --option yes --option no --default yes >/dev/null
chk "replace by id" "$(js "print(len(d),d[0]['default'])")" "1 yes"
bash "$S" add --id t2 --question "Drop?" --option a --option b --default a --deadline 2020-01-01T00:00:00Z >/dev/null
bash "$S" add --id t3 --question "Pay?" --option a --option b --default a --deadline 2020-01-01T00:00:00Z --irreversible >/dev/null
chk "due only reversible and late" "$(bash "$S" due)" "$(printf 't2\ta')"
bash "$S" resolve t2 b >/dev/null
chk "resolved leaves list" "$(bash "$S" list | cut -f1 | tr '\n' ' ')" "t1 t3 "
chk "all shows resolved" "$(bash "$S" list --all | wc -l | tr -d ' ')" 3
chk "resolved not due" "$(bash "$S" due)" ""
bash "$S" remove t3 >/dev/null
chk "remove" "$(bash "$S" list --all | wc -l | tr -d ' ')" 2
bad bash "$S" add --id x --question q --option a --default a
bad bash "$S" add --id x --question q --option a --option b --default c
bad bash "$S" add --id "bad id" --question q --option a --option b --default a
bad bash "$S" resolve t1 maybe
bad bash "$S" resolve nope a
bad bash "$S" remove nope
echo '{"not":"an array"}' >"$DECISIONS_FILE"
bad bash "$S" add --id y --question q --option a --option b --default a
chk "bad file kept" "$(cat "$DECISIONS_FILE")" '{"not":"an array"}'
[ "$fail" = 0 ] && echo "decisions: all tests passed"
exit "$fail"
