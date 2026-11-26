#!/usr/bin/env bash
# skill-graph.sh: the calls between the skills go one way. claude/layers.conf gives each skill a layer and the
# skills that it calls. This test fails when:
#   - a skill has no layer, or a layer line names no skill of the repo;
#   - a call in the file goes up the layers (a view, layer 9, is below all; a view calls only tools, layer 5);
#   - a chain of calls comes back to its start;
#   - a call in the file is not named in the text of the skill (the file is stale);
#   - the text of a skill tells Claude to start a skill of a layer above it ("invoke" or "run" before its name).
# A name in a "## Next" section or in the description is a hint for the person, not a call.
# SKILL_GRAPH_PROFILE (a profile folder with skills/ and layers.conf) adds the skills of a profile; CI runs the core alone.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
command -v python3 >/dev/null || { echo "skill-graph: skipped (no python3)"; exit 0; }
SG_ROOT="$ROOT" SG_PROFILE="${SKILL_GRAPH_PROFILE:-}" python3 -X utf8 -I - <<'PY_END'
import glob, os, re, sys
ROOT, PROF = os.environ['SG_ROOT'], os.environ['SG_PROFILE']
fail, warn = [], []
layer, calls, known = {}, {}, set()
for conf in [os.path.join(ROOT, 'claude', 'layers.conf')] + ([os.path.join(PROF, 'layers.conf')] if PROF else []):
    if not os.path.isfile(conf): fail.append('no layers file: %s' % conf); continue
    for line in open(conf, encoding='utf-8'):
        w = line.split('#')[0].split()
        if len(w) == 2 and w[0].startswith('!'): known.add((w[0][1:], w[1]))
        elif len(w) >= 2 and w[1].isdigit(): layer[w[0]] = int(w[1]); calls[w[0]] = w[2:]
        elif w: fail.append('%s: a bad line: %s' % (os.path.basename(conf), ' '.join(w)))
def body(text):
    text = re.sub(r'\A---\r?\n.*?\r?\n---\r?\n', '', text, flags=re.S)
    return re.sub(r'(?ms)^## Next\b.*?(?=^## |\Z)', '', text)
text = {}
for root in [os.path.join(ROOT, 'claude', 'skills')] + ([os.path.join(PROF, 'skills')] if PROF else []):
    for d in sorted(glob.glob(os.path.join(root, '*', ''))):
        name = os.path.basename(os.path.normpath(d))
        text[name] = "\n".join(body(open(f, encoding='utf-8', errors='replace').read()) for f in sorted(glob.glob(os.path.join(d, '**', '*.md'), recursive=True)))
def ref(n): return re.compile(r'(?:(?<![\w./-])/|`/?)' + re.escape(n) + r'(?![\w-])(?!\.\w)')
def told(n): return re.compile(r'\b(?:[Ii]nvoke|[Rr]un)\b[^.\n]{0,60}?(?:(?<![\w./-])/|`/?)' + re.escape(n) + r'(?![\w-])(?!\.\w)')
def below(a, b): return layer[b] == 9 or (layer[a] != 9 and layer[b] >= layer[a]) or (layer[a] == 9 and layer[b] == 5)
for n in sorted(text):
    if n not in layer: fail.append('%s has no layer in layers.conf' % n)
for n in sorted(layer):
    if n not in text: fail.append('layers.conf names %s, which is not a skill here' % n)
for a in sorted(set(layer) & set(text)):
    for b in calls[a]:
        if b not in text: continue   # a skill of a profile that is not installed here
        if b not in layer: continue
        if not below(a, b): fail.append('%s (%d) calls %s (%d) in layers.conf: a call up the layers' % (a, layer[a], b, layer[b]))
        if not ref(b).search(text[a]): fail.append('layers.conf says that %s calls %s, but the text of %s does not name it' % (a, b, a))
    for b in sorted(set(layer) & set(text)):
        if b == a or below(a, b) or not told(b).search(text[a]): continue
        msg = 'the text of %s (%d) tells Claude to start %s (%d): a call up the layers' % (a, layer[a], b, layer[b])
        (warn if (a, b) in known else fail).append(msg)
state = {}
def walk(n, path):
    state[n] = 1
    for m in calls.get(n, []):
        if m not in text: continue
        if state.get(m) == 1: fail.append('a circle of calls: ' + ' -> '.join(path[path.index(m):] + [m]))
        elif m not in state: walk(m, path + [m])
    state[n] = 2
for n in sorted(calls):
    if n not in state and n in text: walk(n, [n])
for w in sorted(set(warn)): print('known: ' + w)
if fail:
    for f in sorted(set(fail)): print('FAIL: ' + f)
    sys.exit(1)
print('skill-graph: %d skills, %d calls, all down the layers and no circle' % (len(text), sum(len([b for b in calls.get(a, []) if b in text]) for a in text)))
PY_END
