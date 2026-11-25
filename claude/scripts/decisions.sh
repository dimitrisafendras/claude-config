#!/usr/bin/env bash
# decisions.sh: the one place that reads and writes decision records of the loops.
# A record: {"id","ticket","question","options":[a,b],"default","deadline","reversible"}.
# File: ~/.claude/autonomy/decisions.json (a JSON array). Set DECISIONS_FILE to use another file.
# Usage:
#   decisions.sh add --id ID --ticket T --question Q --option A --option B --default A [--deadline ISO|+24h] [--irreversible]
#   decisions.sh list [--all]        open records, one line each (--all also the resolved ones)
#   decisions.sh due                 open reversible records past their deadline: "id<TAB>default"
#   decisions.sh resolve ID OPTION   mark a record resolved with one of its options
#   decisions.sh remove ID           delete a record
# A record with the same id is replaced. The write is atomic (lock folder, temp file, mv).
# This script never acts on a record: the person or a loop decides what a default means.
set -euo pipefail
F="${DECISIONS_FILE:-$HOME/.claude/autonomy/decisions.json}"
die() { echo "decisions: $*" >&2; exit 1; }
command -v python3 >/dev/null || die "python3 is needed"
[ $# -ge 1 ] || die "usage: decisions.sh add|list|due|resolve|remove (see the file header)"
cmd="$1"; shift
mkdir -p "$(dirname "$F")"
LOCK="$F.lock"
lock() {
  local i=0
  until mkdir "$LOCK" 2>/dev/null; do
    if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null || true; fi
    i=$((i+1)); [ "$i" -le 50 ] || die "the lock $LOCK is held"; sleep 0.1
  done
  trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
}
case "$cmd" in add|resolve|remove) lock;; esac
DECISIONS_FILE="$F" DECISIONS_CMD="$cmd" python3 -I - "$@" <<'PY_END' || exit $?
import json, os, sys, datetime, tempfile, re
F = os.environ['DECISIONS_FILE']; cmd = os.environ['DECISIONS_CMD']; args = sys.argv[1:]
def die(m): sys.stderr.write('decisions: ' + m + '\n'); sys.exit(1)
def load():
    if not os.path.exists(F): return []
    try: d = json.load(open(F))
    except Exception: die('%s is not valid JSON; not changed' % F)
    if not isinstance(d, list): die('%s is not a JSON array; not changed' % F)
    return d
def save(d):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(F), prefix='.decisions-')
    with os.fdopen(fd, 'w') as h: json.dump(d, h, indent=2); h.write('\n')
    os.replace(tmp, F)
now = datetime.datetime.now(datetime.timezone.utc)
def parse(t):
    try: return datetime.datetime.fromisoformat(t.replace('Z', '+00:00'))
    except Exception: return None
def opt(name, multi=False):
    out = []; i = 0
    while i < len(args):
        if args[i] == name and i + 1 < len(args): out.append(args[i + 1]); i += 2
        else: i += 1
    return out if multi else (out[-1] if out else None)
if cmd == 'add':
    rid, ticket, q, d = opt('--id'), opt('--ticket') or '', opt('--question'), opt('--default')
    options = opt('--option', True)
    if not rid or not re.match(r'^[A-Za-z0-9._:-]+$', rid): die('--id is needed (letters, digits, . _ : -)')
    if not q: die('--question is needed')
    if len(options) != 2: die('give exactly two --option values')
    if d not in options: die('--default must be one of the two options')
    dl = opt('--deadline') or '+24h'
    m = re.match(r'^\+(\d+)([hm])$', dl)
    if m: dl = (now + datetime.timedelta(**{'hours' if m.group(2) == 'h' else 'minutes': int(m.group(1))})).strftime('%Y-%m-%dT%H:%M:%SZ')
    elif not parse(dl): die('--deadline must be an ISO time or +24h, +30m')
    rec = {'id': rid, 'ticket': ticket, 'question': q, 'options': options, 'default': d, 'deadline': dl, 'reversible': '--irreversible' not in args}
    data = [r for r in load() if r.get('id') != rid] + [rec]
    save(data); print(rid)
elif cmd == 'list':
    for r in load():
        if r.get('resolved') and '--all' not in args: continue
        st = 'resolved:' + str(r['resolved']) if r.get('resolved') else 'open'
        print('%s\t%s\t%s\t%s\tdefault=%s\tdeadline=%s\t%s' % (r.get('id'), r.get('ticket', ''), st, r.get('question', ''), r.get('default'), r.get('deadline'), 'reversible' if r.get('reversible') else 'manual'))
elif cmd == 'due':
    for r in load():
        t = parse(str(r.get('deadline', '')))
        if not r.get('resolved') and r.get('reversible') and t and t <= now: print('%s\t%s' % (r.get('id'), r.get('default')))
elif cmd == 'resolve':
    if len(args) != 2: die('usage: decisions.sh resolve ID OPTION')
    data = load(); hit = [r for r in data if r.get('id') == args[0]]
    if not hit: die('no record %s' % args[0])
    if args[1] not in hit[0].get('options', []): die('%s is not an option of %s' % (args[1], args[0]))
    hit[0]['resolved'] = args[1]; hit[0]['resolvedAt'] = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    save(data); print(args[0])
elif cmd == 'remove':
    if len(args) != 1: die('usage: decisions.sh remove ID')
    data = load(); keep = [r for r in data if r.get('id') != args[0]]
    if len(keep) == len(data): die('no record %s' % args[0])
    save(keep); print(args[0])
else:
    die('unknown command %s' % cmd)
PY_END
