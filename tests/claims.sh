#!/usr/bin/env bash
# claims.sh: one owner for each ticket. A temp folder (CLAIMS_DIR) and a fixed clock (CLAIMS_NOW) keep it the
# same on every machine. The race test starts 8 sessions that claim one ticket at the same moment: one wins.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
S="$ROOT/claude/scripts/claims.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export CLAIMS_DIR="$T/claims"
export CLAIMS_NOW=1800000000
fail=0
chk() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2' expected '$3'"; fail=1; }; }
has() { case "$2" in *"$3"*) ;; *) echo "FAIL: $1: '$2' lacks '$3'"; fail=1 ;; esac; }
run() { out=$(bash "$S" "$@" 2>&1); rc=$?; }

KEY="my-app:TICKET-1"

run check "$KEY"; chk "free at the start (exit)" "$rc" 0; has "free at the start" "$out" "free"
run claim "$KEY" --owner lane-a --note "Fix login"; chk "first claim exit" "$rc" 0; has "first claim" "$out" "claimed"
run claim "$KEY" --owner lane-b; chk "second owner is refused" "$rc" 1; has "refusal names the holder" "$out" "held by lane-a"
run claim "$KEY" --owner lane-a; chk "same owner renews" "$rc" 0; has "renew" "$out" "renewed"
run check "$KEY"; chk "check shows the holder (exit)" "$rc" 1; has "check holder" "$out" "lane-a"
run list; has "list shows the key" "$out" "$KEY"; has "list shows the owner" "$out" "lane-a"; has "list keeps the note" "$out" "Fix login"
run release "$KEY" --owner lane-b; chk "another owner cannot release" "$rc" 1
run heartbeat "$KEY" --owner lane-b; chk "another owner cannot renew" "$rc" 1
run heartbeat "$KEY" --owner lane-a --ttl 6; chk "owner renews with a heartbeat" "$rc" 0

# A claim of 6 hours is live after 5 hours and expired after 7.
CLAIMS_NOW=$((1800000000 + 5 * 3600)) run claim "$KEY" --owner lane-b; chk "live after 5 hours" "$rc" 1
CLAIMS_NOW=$((1800000000 + 7 * 3600)) run check "$KEY"; chk "expired after 7 hours (exit)" "$rc" 0
CLAIMS_NOW=$((1800000000 + 7 * 3600)) run list; has "list marks an expired claim" "$out" "expired"
CLAIMS_NOW=$((1800000000 + 7 * 3600)) run claim "$KEY" --owner lane-b; chk "takeover of an expired claim" "$rc" 0
export CLAIMS_NOW=$((1800000000 + 7 * 3600))
run claim "$KEY" --owner lane-a; chk "the old owner is refused now" "$rc" 1
run release "$KEY" --owner lane-b; chk "owner releases" "$rc" 0; has "release" "$out" "released"
run check "$KEY"; chk "free after release" "$rc" 0
run release "$KEY" --owner lane-b; chk "release of a free claim" "$rc" 0; has "free release" "$out" "was free"

# Prune removes expired claims and keeps live ones.
run claim "board:OLD-1" --owner x --ttl 1
export CLAIMS_NOW=$((CLAIMS_NOW + 2 * 3600))
run claim "board:NEW-1" --owner y --ttl 1
run prune; has "prune count" "$out" "pruned 1"
run check "board:OLD-1"; chk "pruned claim is free" "$rc" 0
run check "board:NEW-1"; chk "live claim stays" "$rc" 1

# A claim with no data and no age is live, and a claim with no data after 60 seconds is expired.
mkdir -p "$CLAIMS_DIR/board:HALF-1"; echo "$CLAIMS_NOW" >"$CLAIMS_DIR/board:HALF-1/made"
run check "board:HALF-1"; chk "claim being written is live" "$rc" 1
CLAIMS_NOW=$((CLAIMS_NOW + 120)) run check "board:HALF-1"; chk "empty claim expires" "$rc" 0

# Bad input.
run claim "bad key!" --owner a; chk "bad key" "$rc" 2
run claim "board:X-1"; chk "owner is required" "$rc" 2
run claim "board:X-1" --owner a --ttl 0; chk "bad ttl" "$rc" 2
run nothing; chk "unknown command" "$rc" 2

# The race: 8 sessions claim one ticket at the same moment. Exactly one wins.
RACE="board:RACE-1"
for i in 1 2 3 4 5 6 7 8; do
  ( bash "$S" claim "$RACE" --owner "lane-$i" >"$T/race.$i" 2>&1; echo $? >"$T/race.$i.rc" ) &
done
wait
wins=0
for i in 1 2 3 4 5 6 7 8; do [ "$(cat "$T/race.$i.rc")" = 0 ] && wins=$((wins + 1)); done
chk "exactly one session wins the race" "$wins" 1
run check "$RACE"; chk "the race ticket is held" "$rc" 1

# The expired-claim race: 8 sessions take over one expired claim. Exactly one wins.
run claim "board:RACE-2" --owner old --ttl 1
export CLAIMS_NOW=$((CLAIMS_NOW + 2 * 3600))
for i in 1 2 3 4 5 6 7 8; do
  ( bash "$S" claim "board:RACE-2" --owner "lane-$i" >"$T/take.$i" 2>&1; echo $? >"$T/take.$i.rc" ) &
done
wait
wins=0
for i in 1 2 3 4 5 6 7 8; do [ "$(cat "$T/take.$i.rc")" = 0 ] && wins=$((wins + 1)); done
chk "exactly one session takes over an expired claim" "$wins" 1

[ "$fail" = 0 ] && echo "claims: all tests passed"
exit "$fail"
