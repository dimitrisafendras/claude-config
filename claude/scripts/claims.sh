#!/usr/bin/env bash
# claims.sh: one owner for each ticket, across all sessions of this computer.
# Two sessions that work on the same board (an automated morning loop and a manual /start-work, a lane and a
# person) read and write the same claim folder, so a ticket never has two lanes.
#   claim <key> --owner <id> [--ttl <hours>] [--note <text>]
#                    take the claim. Exit 0: taken, or renewed by the same owner. Exit 1: another owner holds it
#                    and the claim has not expired; the holder is printed. An expired claim is taken over.
#   heartbeat <key> --owner <id> [--ttl <hours>]
#                    renew the claim of this owner. Exit 1 when another owner holds it or nobody does.
#   release <key> --owner <id>
#                    free the claim. Exit 0 also when it was free. Exit 1 when another owner holds it.
#   check <key>      exit 0 and "free" when nobody holds it (or it expired); exit 1 and the holder when one does.
#   list             each live claim: key, owner, age, time left, note. Expired claims are marked.
#   prune            remove the expired claims.
# <key> is "<board>:<ticket>", for example "my-app:TICKET-123". Letters, digits and . _ : - only.
# A claim is a folder in ~/.claude/claims, made with mkdir: that call is atomic, so two sessions that claim at the
# same moment cannot both win. A claim ends after its TTL (default 4 hours) without a heartbeat, so a session that
# died frees its ticket by itself. Claims are local: another computer sees the ClickUp status and not this folder.
# CLAIMS_DIR replaces the folder and CLAIMS_NOW (epoch seconds) replaces the clock, for tests.
set -uo pipefail

DIR="${CLAIMS_DIR:-$HOME/.claude/claims}"
DEFAULT_TTL_HOURS=4

die() { echo "claims: $*" >&2; exit 2; }
now_epoch() { if [ -n "${CLAIMS_NOW:-}" ]; then echo "$CLAIMS_NOW"; else date +%s; fi; }
fmt_epoch() { date -d "@$1" "+$2" 2>/dev/null || date -r "$1" "+$2"; }

valid_key() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]*$ ]] || die "bad key '$1' (use letters, digits and . _ : -)"; }
valid_owner() { [ -n "$1" ] || die "--owner is required (the name of this session or lane)"; case "$1" in *$'\n'*) die "bad owner" ;; esac; }
valid_ttl() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -gt 0 ] || die "bad --ttl '$1' (whole hours, 1 or more)"; }

# The change time of a file, on GNU and on BSD.
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null; }

# A short guard around each change of one claim. Without it, a session that sees an expired claim could remove the
# new claim that another session made a moment later. mkdir is atomic: only one session holds the guard. A guard
# older than 30 seconds belongs to a dead session and is removed.
guard() {
  local g="$1.lock" n m
  for ((n = 0; n < 100; n++)); do
    if mkdir "$g" 2>/dev/null; then return 0; fi
    m=$(mtime "$g")
    if [[ "$m" =~ ^[0-9]+$ ]] && [ $(($(date +%s) - m)) -gt 30 ]; then rmdir "$g" 2>/dev/null; fi
    sleep 0.05
  done
  return 1
}
unguard() { rmdir "$1.lock" 2>/dev/null; return 0; }

# The text of a field of a claim folder, or nothing.
field() { [ -f "$1/$2" ] && head -1 "$1/$2" | tr -d '\r'; }

# state <dir>: "free", "live" or "expired". A folder with no data is a claim that is being written: live for 60
# seconds, then expired.
state() {
  local dir="$1" exp now owner
  [ -d "$dir" ] || { echo free; return; }
  now=$(now_epoch)
  owner=$(field "$dir" owner)
  exp=$(field "$dir" expires)
  if [ -z "$owner" ] || ! [[ "$exp" =~ ^[0-9]+$ ]]; then
    local made; made=$(field "$dir" made)
    [[ "$made" =~ ^[0-9]+$ ]] || made=$(mtime "$dir")
    [[ "$made" =~ ^[0-9]+$ ]] || made=$now
    if [ $((now - made)) -gt 60 ]; then echo expired; else echo live; fi
    return
  fi
  if [ "$now" -ge "$exp" ]; then echo expired; else echo live; fi
}

holder() {
  local dir="$1" owner exp
  owner=$(field "$dir" owner); exp=$(field "$dir" expires)
  [ -n "$owner" ] || owner="(being written)"
  if [[ "$exp" =~ ^[0-9]+$ ]]; then
    printf 'held by %s since %s, until %s\n' "$owner" "$(fmt_epoch "$(field "$dir" since)" '%Y-%m-%d %H:%M')" "$(fmt_epoch "$exp" '%Y-%m-%d %H:%M')"
  else
    printf 'held by %s\n' "$owner"
  fi
}

write_data() { # <dir> <owner> <ttl hours> <note> <since>
  local dir="$1" owner="$2" ttl="$3" note="$4" since="$5" now
  now=$(now_epoch)
  printf '%s\n' "$now" >"$dir/made"
  printf '%s\n' "$owner" >"$dir/owner"
  printf '%s\n' "$since" >"$dir/since"
  printf '%s\n' "$((now + ttl * 3600))" >"$dir/expires"
  printf '%s\n' "$note" >"$dir/note"
}

parse() { # sets OWNER TTL NOTE from the options
  OWNER=""; TTL="$DEFAULT_TTL_HOURS"; NOTE=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --owner) OWNER="${2-}"; shift 2 || die "--owner needs a value" ;;
      --ttl) TTL="${2-}"; shift 2 || die "--ttl needs a value" ;;
      --note) NOTE="${2-}"; shift 2 || die "--note needs a value" ;;
      *) die "unknown option '$1'" ;;
    esac
  done
  valid_ttl "$TTL"
}

cmd_claim() {
  local key="${1-}"; [ -n "$key" ] || die "claim needs a key"; shift
  valid_key "$key"; parse "$@"; valid_owner "$OWNER"
  mkdir -p "$DIR" || die "cannot make $DIR"
  local dir="$DIR/$key" rc=0
  guard "$dir" || { echo "$key: busy, try again"; return 1; }
  case "$(state "$dir")" in
    live)
      if [ "$(field "$dir" owner)" = "$OWNER" ]; then
        write_data "$dir" "$OWNER" "$TTL" "${NOTE:-$(field "$dir" note)}" "$(field "$dir" since)"
        echo "renewed $key for $OWNER"
      else
        echo "$key: $(holder "$dir")"; rc=1
      fi ;;
    *)
      rm -rf "$dir"   # free, or expired: the guard makes this safe
      mkdir "$dir" && write_data "$dir" "$OWNER" "$TTL" "$NOTE" "$(now_epoch)" && echo "claimed $key for $OWNER" || rc=1 ;;
  esac
  unguard "$dir"
  return "$rc"
}

cmd_heartbeat() {
  local key="${1-}"; [ -n "$key" ] || die "heartbeat needs a key"; shift
  valid_key "$key"; parse "$@"; valid_owner "$OWNER"
  local dir="$DIR/$key" rc=0
  guard "$dir" || { echo "$key: busy, try again"; return 1; }
  if [ "$(state "$dir")" = live ] && [ "$(field "$dir" owner)" = "$OWNER" ]; then
    write_data "$dir" "$OWNER" "$TTL" "$(field "$dir" note)" "$(field "$dir" since)"
    echo "renewed $key for $OWNER"
  elif [ "$(state "$dir")" = live ]; then
    echo "$key: $(holder "$dir")"; rc=1
  else
    echo "$key: no live claim of $OWNER"; rc=1
  fi
  unguard "$dir"
  return "$rc"
}

cmd_release() {
  local key="${1-}"; [ -n "$key" ] || die "release needs a key"; shift
  valid_key "$key"; parse "$@"; valid_owner "$OWNER"
  local dir="$DIR/$key" st rc=0
  guard "$dir" || { echo "$key: busy, try again"; return 1; }
  st=$(state "$dir")
  if [ "$st" = free ]; then echo "$key: it was free"
  elif [ "$st" = live ] && [ "$(field "$dir" owner)" != "$OWNER" ]; then echo "$key: $(holder "$dir")"; rc=1
  else rm -rf "$dir"; echo "released $key"; fi
  unguard "$dir"
  return "$rc"
}

cmd_check() {
  local key="${1-}"; [ -n "$key" ] || die "check needs a key"
  valid_key "$key"
  local dir="$DIR/$key"
  if [ "$(state "$dir")" = live ]; then echo "$key: $(holder "$dir")"; return 1; fi
  echo "$key: free"
}

cmd_list() {
  local d key st now exp left
  now=$(now_epoch)
  [ -d "$DIR" ] || { echo "no claims"; return 0; }
  local any=0
  for d in "$DIR"/*/; do
    [ -d "$d" ] || continue
    d="${d%/}"; key=$(basename "$d")
    case "$key" in *.lock|*.dead.*) continue ;; esac
    st=$(state "$d"); exp=$(field "$d" expires)
    any=1
    if [ "$st" = live ] && [[ "$exp" =~ ^[0-9]+$ ]]; then
      left=$(((exp - now) / 60))
      printf '%s\t%s\t%s min left\t%s\n' "$key" "$(field "$d" owner)" "$left" "$(field "$d" note)"
    else
      printf '%s\t%s\texpired\t%s\n' "$key" "$(field "$d" owner)" "$(field "$d" note)"
    fi
  done
  [ "$any" = 1 ] || echo "no claims"
}

cmd_prune() {
  local d n=0
  [ -d "$DIR" ] || { echo "pruned 0"; return 0; }
  for d in "$DIR"/*/; do
    [ -d "$d" ] || continue
    d="${d%/}"
    case "$(basename "$d")" in *.lock|*.dead.*) continue ;; esac
    guard "$d" || continue
    if [ "$(state "$d")" = expired ]; then rm -rf "$d"; n=$((n + 1)); fi
    unguard "$d"
  done
  echo "pruned $n"
}

sub="${1-}"; [ $# -gt 0 ] && shift
case "$sub" in
  claim) cmd_claim "$@" ;;
  heartbeat) cmd_heartbeat "$@" ;;
  release) cmd_release "$@" ;;
  check) cmd_check "$@" ;;
  list) cmd_list ;;
  prune) cmd_prune ;;
  *) die "usage: claims.sh claim|heartbeat|release <key> --owner <id> | check <key> | list | prune" ;;
esac
