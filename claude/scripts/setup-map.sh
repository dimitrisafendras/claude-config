#!/usr/bin/env bash
# setup-map.sh: build the Setup Map, one HTML page of the skills, mods, routines, scripts and flows.
# Usage: setup-map.sh [output.html]   prints the path of the file it wrote.
# The facts come from this repo and the recorded profile, so each run is current. It changes nothing else.
# The routine `setup-map` runs this and publishes the page as an artifact.
# Environment: SETUP_MAP_CORE (the repo), SETUP_MAP_PROFILE (the profile folder; empty means the core alone), SETUP_MAP_OUT (default output).
set -euo pipefail
D="${HOME}/.claude"
self="${BASH_SOURCE[0]}"; while [ -L "$self" ]; do t="$(readlink "$self")"; case "$t" in /*) self="$t";; *) self="$(dirname "$self")/$t";; esac; done
here="$(cd "$(dirname "$self")" && pwd -P)"
core="${SETUP_MAP_CORE:-}"
if [ -z "$core" ]; then
  if [ -d "$here/../../routines" ]; then core="$(cd "$here/../.." && pwd -P)"
  elif [ -f "$D/claude-config.repo" ]; then core="$(head -1 "$D/claude-config.repo" | tr -d '\r')"; fi
fi
[ -n "$core" ] && [ -d "$core/claude/skills" ] || { echo "setup-map: no repo found (set SETUP_MAP_CORE)" >&2; exit 2; }
profile="${SETUP_MAP_PROFILE:-}"
if [ -z "${SETUP_MAP_PROFILE+x}" ] && [ -f "$D/claude-config.profile" ]; then profile="$(head -1 "$D/claude-config.profile" | tr -d '\r')"; fi
[ -d "$profile" ] || profile=""
out="${1:-${SETUP_MAP_OUT:-$D/setup-map.html}}"
mkdir -p "$(dirname "$out")"
command -v python3 >/dev/null || { echo "setup-map: python3 is needed" >&2; exit 2; }
SM_CORE="$core" SM_PROFILE="$profile" SM_OUT="$out" python3 -X utf8 -I - <<'PY_END'
import html, os
e = html.escape
OUT = os.environ['SM_OUT']

flows = [
 ("Start the day",[("07:30","morning-prep loop"),("config sync","pull + install when clean"),("inbox + plan","tickets, ranked"),("/paralel","starts the free tickets"),("08:15","daily-digest")]),
 ("Do the work",[("claim","one owner for each ticket, in all sessions"),("lane","one session for each ticket"),("agents","sub-branches, a reviewer each"),("ci-watch","fix red CI, up to 3 tries"),("merge","on green, by the merge policy"),("needs you","a decision record, never a wait")]),
 ("After the merge",[("deploy watch","the run of the merge commit"),("verify","staging, with evidence"),("ticket-closer","close the ticket"),("cleanup","worktree and branch, at once")]),
 ("Keep it clean",[("12:00","sweep: repair stale PRs"),("03:00","config-loop: pull, install, audit"),("02:30","nightly-cleanup"),("19:00","prefs-sync"),("Monday","audit and releases digest")]),
 ("Change the setup",[("edit","main checkout, dev branch"),("/reload-plugins","look, repeat"),("one PR","CI must pass"),("merge on green","auto-merge"),("pull + install","install.sh --mods")]),
 ("Run it by hand",[("/autonomy status","loops, last run, kill switch"),("/autonomy run <loop>","one loop, now"),("/autonomy run lane <ticket>","one ticket, now"),("/start-work <project>","one board, now: its tickets and its dispatcher"),("/autonomy off","the kill switch")]),
]
rules = [
 ("kill switch","The file ~/.claude/autonomy.off stops every loop at its next step. /autonomy off and on set it."),
 ("3 tries","A fix is tried at most 3 times for a PR; then the ticket needs you, with a decision record."),
 ("manual gates","A production release, a message to other people, money, secrets and destructive data stay yours."),
 ("ticket claims","A ticket has one owner at a time, across all sessions. A claim ends after 4 hours with no heartbeat."),
 ("decision records","A question, two options, a default and a deadline. A reversible one takes its default at the deadline."),
 ("merge-policy","A rule file says which repos allow a merge with no prompt."),
 ("verify-gate","A lane cannot finish while its check command fails."),
 ("memory-governor","New agents and heavy jobs wait while free memory is low."),
 ("daily cap","At most 60 automatic turns a day."),
 ("local first","A mod change is edited in place, reloaded, and sent in one PR after approval."),
 ("theme conflict check","The install check warns when a second theme mod is on."),
]

# ---- the facts come from the repos, so a rebuild is always current ----
import os, json, re, glob
CORE = os.environ['SM_CORE']
PROF = os.environ.get('SM_PROFILE', '')
def first_sentence(t, n=110):
    t = re.sub(r'\s+', ' ', t).strip()
    m = re.match(r'(.{20,%d}?[.:;])(\s|$)' % n, t)
    out = m.group(1) if m else t[:n]
    return out.rstrip(':;') if len(out) < len(t) else out
def front(path):
    txt = open(path, encoding='utf-8').read()
    m = re.match(r'---\n(.*?)\n---', txt, re.S)
    d = {}
    if m:
        for line in m.group(1).splitlines():
            k, _, v = line.partition(':')
            if _ and k.strip() and not k.startswith(' '):
                d[k.strip()] = v.strip().strip('"').split('   #')[0].strip().strip('"')
    return d
skills = []
for root, co in ((CORE + '/claude/skills', 0), (PROF + '/skills', 1)):
    for p in sorted(glob.glob(root + '/*/SKILL.md')):
        f = front(p)
        skills.append((os.path.basename(os.path.dirname(p)), first_sentence(f.get('description', '')), co))
skills.sort(key=lambda x: (x[2], x[0]))
mods = []
for root, co in ((CORE + '/mods', 0), (PROF + '/mods', 1)):
    for p in sorted(glob.glob(root + '/*/.claude-plugin/plugin.json')):
        j = json.load(open(p))
        mods.append((j['name'], j.get('version', ''), first_sentence(j.get('description', '')), co))
mods.sort(key=lambda x: (x[3], x[0]))
def cron_words(c):
    parts = c.split()
    if len(parts) != 5: return c
    mi, h, dom, mon, dow = parts
    days = {'*': 'daily', '1-5': 'Mon–Fri', '1': 'Monday'}.get(dow, 'on days ' + dow)
    times = ' and '.join('%s:%s' % (x.zfill(2), mi.zfill(2)) for x in h.split(','))
    return '%s %s' % (times, days)
def crons_of(raw):
    # One cron line, or a list of them: every run of five cron fields in the value.
    return [' '.join(c.split()) for c in re.findall(r'(?:[\d*,/-]+\s+){4}[\d*,/-]+', raw)]
routines = []   # (first minute of the day, cron lines, name, what it does)
for p in sorted(glob.glob(CORE + '/routines/*.md')):
    if p.endswith('README.md'): continue
    f = front(p)
    crons = crons_of(f.get('schedule', ''))
    mins = [int(x) * 60 + int(c.split()[0]) for c in crons for x in c.split()[1].split(',') if x.isdigit() and c.split()[0].isdigit()]
    routines.append((min(mins) if mins else 9999, crons, f.get('name', os.path.basename(p)[:-3]), first_sentence(f.get('description', ''), 130)))
routines.sort()
extras = []
for p in sorted(glob.glob(CORE + '/claude/scripts/*.sh')):
    line = ''
    for l in open(p, encoding='utf-8'):
        if l.startswith('#') and not l.startswith('#!'):
            line = l.lstrip('# ').strip(); break
    extras.append((os.path.basename(p), line or 'A helper script.'))
for p in sorted(glob.glob(CORE + '/claude/agents/*.md')):
    extras.append((os.path.basename(p)[:-3], first_sentence(front(p).get('description', 'An agent.'))))
N_SKILLS, N_MODS, N_ROUT, N_EXTRA = len(skills), len(mods), len(routines), len(extras)

# The page is a set of terminal panes: each section is a command and its output.
def item(n, d, k, v='', co=0):
    tag = '<span class="co">[company]</span>' if co else ''
    ver = f'<em>{e(v)}</em>' if v else ''
    return f'<li class="item{" is-co" if co else ""}" data-k="{e((n+" "+d).lower())}"><span class="nm">{e(n)}{ver}{tag}</span><span class="ds">{e(d)}</span></li>'

skills_html = "\n".join(item(n,d,'s','',c) for n,d,c in skills)
mods_html = "\n".join(item(n,d,'m',v,c) for n,v,d,c in mods)
extras_html = "\n".join(item(n,d,'x') for n,d in extras)
rules_html = "\n".join('<li class="item"><span class="nm">%s</span><span class="ds">%s</span></li>' % (e(a.replace(' ', '_')), e(b)) for a,b in rules)

# ---- how it fits: the folder as a tree ----
tree_rows = [('skills/', N_SKILLS, 'k-skill', 'text files of steps, typed as a slash command'),
             ('mods/', N_MODS, 'k-mod', 'code inside the app: panes, themes, hooks'),
             ('routines/', N_ROUT, 'k-routine', 'prompts on a schedule, nobody watches'),
             ('*.sh  agents/', N_EXTRA, 'k-script', 'exact jobs: memory, merge, ticket claims')]
tree = ['<span class="dir">~/.claude</span>']
for nm, cnt, k, what in tree_rows:
    tree.append('├── <b class="kc %s">%s</b>%s<span class="num">%3d</span>   <span class="com"># %s</span>' % (k, e(nm), ' ' * (16 - len(nm)), cnt, e(what)))
tree.append('├── settings.json  profile.md  merge-policy.json   <span class="com"># the rules that all parts follow</span>')
tree.append('└── claims/  autonomy.off                          <span class="com"># one owner for a ticket, and the kill switch</span>')
tree.append('')
tree.append('<span class="com"># Claude Code reads this folder in the desktop app, the terminal CLI, the scheduled runs and the lane sessions.</span>')
tree_html = "\n".join(tree)

# ---- the flows: each loop as code. A program counter goes down the steps (--i is the step, --n the number of steps). ----
def flow_code(title, steps):
    slug = re.sub(r'[^a-z0-9]+', '_', title.lower()).strip('_')
    w = max(len('  step("%s");' % a) for a, _ in steps) + 2
    ln = ['<span class="ln"><span class="kw">while</span> (autonomy.<span class="fn">on</span>()) {</span>']
    for i, (a, b) in enumerate(steps):
        raw = '  step("%s");' % a
        ln.append('<span class="ln st" style="--i:%d">  <span class="fn">step</span>(<span class="str">"%s"</span>);%s<span class="com">// %s</span></span>' % (i, e(a), ' ' * (w - len(raw)), e(b)))
    ln.append('<span class="ln">}</span>')
    return '<div class="term flow" style="--n:%d"><div class="cmd"><span class="file">%s.loop</span><span class="hint">%s · %d steps</span></div><div class="scroll"><pre class="code">%s</pre></div></div>' % (len(steps), e(slug), e(title), len(steps), "".join(ln))
flows_html = "\n".join(flow_code(t, s) for t, s in flows)

# ---- the day of the loops: a log of the day, one line for each run. The script of the page adds the state on the real clock. ----
log_rows = []
for first, crons, name, what in routines:
    for c in crons:
        mi, h, dom, mon, dow = c.split()
        days = {'*': 'daily', '1-5': 'Mon–Fri', '1': 'Monday'}.get(dow, 'days ' + dow)
        for x in h.split(','):
            if not (x.isdigit() and mi.isdigit()): continue
            m0 = int(x) * 60 + int(mi)
            log_rows.append((m0, '<li class="log" data-m="%d" data-d="%s" data-n="%s"><span class="lt">%02d:%02d</span><span class="cn">%s</span><span class="st">%s</span><span class="com">%s</span></li>' % (m0, e(dow), e(name), m0 // 60, m0 % 60, e(name), e(days), e(what))))
log_rows.sort(key=lambda r: r[0])
cron_html = "\n".join(r[1] for r in log_rows)

# ---- the call graph: which part names which other part in its own text ----
# A skill, a routine or a mod "calls" a part when its files name that part: /name or `name` for a skill,
# name.sh for a script, `name` or mcp__name__ for a mod. The graph is read from the files, so it stays current.
def read_all(paths):
    out = []
    for q in paths:
        try: out.append(open(q, encoding='utf-8', errors='replace').read())
        except OSError: pass
    return "\n".join(out)
def skill_ref(n): return re.compile(r'(?:(?<![\w./-])/|`/?)' + re.escape(n) + r'(?![\w-])(?!\.\w)')
def mod_ref(n): return re.compile(r'`' + re.escape(n) + r'`|mcp__' + re.escape(n) + r'__')
kind_of, about, co_of = {}, {}, {}
for n, d, c in skills: kind_of[n] = 'skill'; about[n] = d; co_of[n] = c
for n, v, d, c in mods:
    if n not in kind_of: kind_of[n] = 'mod'; about[n] = d; co_of[n] = c
for first, crons, n, d in routines:
    if n not in kind_of: kind_of[n] = 'routine'; about[n] = d
for n, d in extras:
    if n not in kind_of: kind_of[n] = 'script'; about[n] = d
sources = {}
for root in (CORE + '/claude/skills', PROF + '/skills'):
    for d in sorted(glob.glob(root + '/*/')):
        # normpath: on Windows the folder from glob ends with a backslash, and then basename gives an empty name.
        sources[os.path.basename(os.path.normpath(d))] = read_all(glob.glob(os.path.join(d, '**', '*.md'), recursive=True))
for q in glob.glob(CORE + '/routines/*.md'):
    f = front(q); n = f.get('name', os.path.basename(q)[:-3])
    if kind_of.get(n) == 'routine': sources[n] = read_all([q]) + "\n" + " ".join('`%s`' % x.strip() for x in f.get('skills', '').strip('[]').split(',') if x.strip())
edges = set()
for src, text in sources.items():
    if src not in kind_of: continue
    for n, k in kind_of.items():
        if n == src: continue
        hit = (k == 'skill' and skill_ref(n).search(text)) or (k == 'script' and n.endswith('.sh') and n in text) or (k == 'mod' and mod_ref(n).search(text))
        if hit: edges.add((src, n))
linked = {x for ed in edges for x in ed}
g_nodes = [n for k in ('routine', 'skill', 'mod', 'script') for n in sorted(kind_of) if kind_of[n] == k and (k == 'skill' or n in linked)]
ROW, GX, GW = 19, 214, 560
gy = {n: 16 + i * ROW for i, n in enumerate(g_nodes)}
GH = 16 + len(g_nodes) * ROW
gs = ['<svg class="graph" id="graph" viewBox="0 0 %d %d" role="img" aria-label="Which part calls which other part.">' % (GW, GH)]
for a, b in sorted(edges):
    if a not in gy or b not in gy: continue
    y1, y2 = gy[a], gy[b]; d = abs(y2 - y1)
    gs.append('<path class="ed s-%s" data-s="%s" data-t="%s" d="M%d %d A%.0f %.1f 0 0 %d %d %d"/>' % (kind_of[a], e(a), e(b), GX, y1, min(320, 24 + d * 0.42), d / 2.0, 1 if y2 > y1 else 0, GX, y2))
for n in g_nodes:
    gs.append('<g class="nd k-%s" data-id="%s" tabindex="0" role="button" aria-label="%s"><rect class="hitbox" x="0" y="%d" width="%d" height="%d"/><text x="%d" y="%d" text-anchor="end">%s</text><circle cx="%d" cy="%d" r="3.6"/></g>' % (kind_of[n], e(n), e(n), gy[n] - 9, GX + 10, ROW, GX - 12, gy[n] + 4, e(n), GX, gy[n]))
gs.append('</svg>')
graph_html = "\n".join(gs)
graph_data = json.dumps({'x': GX, 'row': ROW, 'w': GW, 'n': {n: [kind_of[n], about.get(n, ''), 1 if co_of.get(n) else 0] for n in g_nodes}, 'e': sorted([a, b] for a, b in edges if a in gy and b in gy)}).replace('</', '<\\/')
N_EDGES = sum(1 for a, b in edges if a in gy and b in gy)

# ---- the footer facts come from the settings of the repo, when they are there ----
foot = []
try:
    st = json.load(open(CORE + '/claude/settings.json', encoding='utf-8'))
    if st.get('model'): foot.append('model=%s' % e(str(st['model'])))
    if st.get('outputStyle'): foot.append('output_style=%s' % e(str(st['outputStyle'])))
    en = st.get('enabledPlugins')
    if isinstance(en, dict): foot.append('plugins_enabled=%d' % sum(1 for v in en.values() if v))
except Exception:
    pass
footer_html = '  '.join(foot)

page = r"""<title>Setup Map</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap">
<style>
/* Layout: a night terminal. Each section is a pane: a command line, then its output. The folder is a tree, the flows
   are code with a program counter, the routines are a log of the day, the parts are listings.
   One color for each kind of part, the same in every pane. */
:root{--bg:#0a0d22;--panel:#0f1430;--raised:#182049;--ink:#eef1ff;--dim:#8f9ac6;--line:#283069;--dot:#1b2150;
--skill:#38d8f0;--mod:#b996ff;--routine:#ffc44d;--script:#45e3a4;--glow:.16;
--display:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;--body:"Geist",ui-sans-serif,system-ui,sans-serif;--mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;color-scheme:dark}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){--bg:#f2f3fb;--panel:#ffffff;--raised:#e9ebf8;--ink:#131a3d;--dim:#535d88;--line:#d3d7ee;--dot:#dfe2f3;--skill:#087a90;--mod:#6638d2;--routine:#8f5f06;--script:#12764e;--glow:.10;color-scheme:light}}
:root[data-theme="light"]{--bg:#f2f3fb;--panel:#ffffff;--raised:#e9ebf8;--ink:#131a3d;--dim:#535d88;--line:#d3d7ee;--dot:#dfe2f3;--skill:#087a90;--mod:#6638d2;--routine:#8f5f06;--script:#12764e;--glow:.10;color-scheme:light}
*{box-sizing:border-box}
body{background-color:var(--bg);background-image:radial-gradient(38rem 16rem at 22% 9rem,color-mix(in srgb,var(--mod) calc(var(--glow)*100%),transparent),transparent 70%),radial-gradient(34rem 15rem at 76% 6rem,color-mix(in srgb,var(--skill) calc(var(--glow)*100%),transparent),transparent 70%),radial-gradient(var(--dot) 1px,transparent 1.2px);background-repeat:no-repeat,no-repeat,repeat;background-size:100% 30rem,100% 30rem,22px 22px;color:var(--ink);font-family:var(--body);font-size:15px;line-height:1.55;padding-block:0 4rem;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:10;background:var(--bg)}
.wrap{max-width:1080px;margin:0 auto}
code{font-family:var(--mono);font-size:.88em;color:var(--ink);background:var(--raised);border-radius:4px;padding:.05em .35em}

header{padding-block:3.2rem 1.6rem}
.eyebrow{font-family:var(--mono);font-size:.84rem;color:var(--dim);margin:0 0 1rem}
.eyebrow b,.cmd>b{color:var(--script);font-weight:600;margin-right:.6ch}
.cur{display:inline-block;width:.6em;height:1.05em;background:var(--ink);vertical-align:-.18em;margin-left:.3ch;animation:blink 1.1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
h1{font-family:var(--display);font-weight:800;font-size:clamp(3.4rem,13vw,8.5rem);line-height:.86;letter-spacing:-.045em;margin:0 0 1.4rem;text-wrap:balance}
.lede{color:var(--dim);max-width:60ch;margin:0;font-size:1.05rem}
.lede b{color:var(--ink);font-weight:600}
.stats{display:flex;flex-wrap:wrap;gap:.4rem 2.2rem;margin-top:2rem;border-top:1px solid var(--line);padding-top:1.2rem}
.stat{display:flex;flex-direction:column;min-width:5.5rem}
.stat b{font-family:var(--display);font-weight:700;font-size:clamp(2rem,5vw,2.9rem);line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.stat span{font-family:var(--mono);font-size:.72rem;letter-spacing:.07em;text-transform:uppercase;color:var(--dim);margin-top:.35rem}
.stat:nth-child(1) b{color:var(--skill)}.stat:nth-child(2) b{color:var(--mod)}.stat:nth-child(3) b{color:var(--routine)}.stat:nth-child(4) b{color:var(--script)}

nav{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-block:1px solid var(--line);display:flex;gap:.15rem;flex-wrap:wrap;padding:.45rem 0;margin-top:1rem}
nav a{font-family:var(--mono);font-size:.78rem;color:var(--dim);text-decoration:none;padding:.35rem .7rem;border-radius:6px}
nav a::before{content:"./";opacity:.55}
nav a:hover{background:var(--raised);color:var(--ink)}
nav a:focus-visible,.find:focus-visible{outline:2px solid var(--skill);outline-offset:1px}

section{padding-block:3.4rem 0;scroll-margin-top:3rem}
.head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:.4rem}
h2{font-family:var(--display);font-weight:700;font-size:clamp(1.7rem,4vw,2.4rem);line-height:1.05;letter-spacing:-.025em;margin:0;text-wrap:balance}
.head .n{font-family:var(--mono);font-size:.78rem;color:var(--dim)}
.head .n b{color:var(--skill);font-weight:600}
.sub{color:var(--dim);margin:0 0 1.2rem;max-width:68ch}

/* A pane: the command line, then the output. Wide output scrolls inside the pane. */
.term{background:var(--panel);border:1px solid var(--line);border-radius:10px;font-family:var(--mono);font-size:.8rem;line-height:1.7;min-width:0}
.cmd{display:flex;align-items:center;gap:.2ch;flex-wrap:wrap;padding:.5rem .9rem;border-bottom:1px solid var(--line);color:var(--ink)}
.cmd .hint{margin-left:auto;color:var(--dim)}
.cmd .file{color:var(--routine)}
.scroll{overflow-x:auto}
pre{margin:0;font:inherit}
.out{padding:.7rem .9rem;white-space:pre}
.com{color:var(--dim)}.kw{color:var(--mod)}.fn{color:var(--skill)}.str{color:var(--script)}.num{color:var(--routine)}.dir{color:var(--ink);font-weight:600}
.k-skill{--k:var(--skill)}.k-mod{--k:var(--mod)}.k-routine{--k:var(--routine)}.k-script{--k:var(--script)}
.kc{color:var(--k);font-weight:600}

/* The flows as code. The line number is a CSS counter. The lit line is the program counter. */
.flows{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,470px),1fr));gap:.6rem}
.code{display:inline-block;min-width:100%;padding:.5rem 0;counter-reset:ln;white-space:pre}
.ln{display:block;padding-right:1rem;border-left:2px solid transparent}
.ln::before{counter-increment:ln;content:counter(ln);display:inline-block;width:2.2rem;margin-right:1rem;text-align:right;color:var(--dim);opacity:.55}
.ln.st{animation:pc calc(var(--n)*.8s) steps(1) infinite;animation-delay:calc(var(--i)*.8s)}
@keyframes pc{0%{background:color-mix(in srgb,var(--skill) 16%,transparent);border-left-color:var(--skill)}calc(100%/var(--n)),100%{background:transparent;border-left-color:transparent}}

/* The log of the day. With no script a line shows its days. The script adds: past, the next run with the time left, later, not today. */
ul.logs{list-style:none;margin:0;padding:.5rem 0}
.log{display:grid;grid-template-columns:6ch 23ch 14ch minmax(0,1fr);gap:0 2ch;padding:.1rem .9rem;border-left:2px solid transparent}
.lt{color:var(--routine);font-variant-numeric:tabular-nums}
.cn{color:var(--ink);font-weight:600;overflow-wrap:anywhere}
.st{color:var(--dim);white-space:nowrap}
.log.past{opacity:.5}
.log.off{opacity:.3}
.log.later .st{color:var(--ink)}
.log.next{background:color-mix(in srgb,var(--skill) 12%,transparent);border-left-color:var(--skill);animation:wait 2.4s ease-in-out infinite}
.log.next .cn,.log.next .st{color:var(--skill)}
.log.next .st{font-weight:600}
@keyframes wait{50%{background:color-mix(in srgb,var(--skill) 5%,transparent)}}
.tail{padding:0 .9rem .6rem;color:var(--dim)}
@media (max-width:700px){.log{grid-template-columns:6ch minmax(0,1fr) auto}.log .com{grid-column:2/-1}}

/* The filters of the graph: a flag for each kind of part. A flag that is off has a line through it. */
.flags{display:flex;flex-wrap:wrap;align-items:baseline;gap:.2rem 1.8ch;padding:.45rem .9rem;border-bottom:1px solid var(--line)}
.flags button{font:inherit;font-weight:600;color:var(--k,var(--ink));background:none;border:0;padding:0;cursor:pointer}
.flags button[aria-pressed="false"]{color:var(--dim);font-weight:400;text-decoration:line-through}
.flags button:focus-visible{outline:2px solid var(--skill);outline-offset:2px}
.flags .com{margin-left:auto}
/* The call graph: the parts down one line, an arc for each call. The chosen part and its calls are lit. */
.deps{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);align-items:start}
.deps .scroll{border-right:1px solid var(--line);padding:.6rem .4rem}
.graph{display:block;width:100%;min-width:430px;height:auto}
.graph .ed{fill:none;stroke-width:1.1;opacity:.28}
.graph .nd{cursor:pointer;outline:none}
.graph .hitbox{fill:transparent}
.graph .nd text{font-family:var(--mono);font-size:11px;fill:var(--dim)}
.graph .nd circle{fill:var(--k)}
.graph .nd:hover text,.graph .nd:focus-visible text{fill:var(--ink)}
.graph.sel .ed{opacity:.05}
.graph.sel .ed.on{opacity:1;stroke-width:1.8;stroke-dasharray:5 4;animation:run .9s linear infinite}
.graph.sel .nd text{opacity:.45}
.graph.sel .nd.on text{opacity:1;fill:var(--ink)}
.graph.sel .nd.me text{opacity:1;fill:var(--k);font-weight:600}
.graph.sel .nd.me circle{r:5.5}
@keyframes run{to{stroke-dashoffset:-18}}
.s-skill{stroke:var(--skill)}.s-mod{stroke:var(--mod)}.s-routine{stroke:var(--routine)}.s-script{stroke:var(--script)}
.man{position:sticky;top:calc(env(safe-area-inset-top,0px) + 3.2rem);padding:.9rem 1rem 1.1rem;display:flex;flex-direction:column;gap:.1rem;min-width:0;background:var(--panel);border-radius:0 10px 10px 0}
.man h4{font:inherit;font-weight:600;color:var(--dim);margin:.7rem 0 .1rem;letter-spacing:.06em}
.man h4:first-child{margin-top:0}
.man p{margin:0 0 0 2ch;color:var(--ink);overflow-wrap:anywhere}
.man p .kc{font-size:1.05em}
.man .list{margin:0 0 0 2ch;display:flex;flex-wrap:wrap;gap:.1rem 1.6ch}
.man button{font:inherit;font-weight:600;color:var(--k);background:none;border:0;padding:0;cursor:pointer;text-align:left}
.man button:hover,.man button:focus-visible{text-decoration:underline;outline:none}
.man .nil{color:var(--dim)}
@media (max-width:760px){.deps{grid-template-columns:minmax(0,1fr)}.deps .scroll{border-right:0;order:2}.man{order:1;border-bottom:1px solid var(--line);border-radius:0;z-index:2}}

/* The listings: a name, then what it does as a comment. */
.find{flex:1 1 12ch;min-width:10ch;max-width:30ch;background:transparent;border:0;border-bottom:1px dashed var(--dim);color:var(--ink);font:inherit;padding:0 .3ch;margin:0 .6ch}
.find::placeholder{color:var(--dim)}
ul.rows{list-style:none;margin:0;padding:.4rem 0}
.item{display:grid;grid-template-columns:25ch minmax(0,1fr);gap:0 2ch;padding:.12rem .9rem}
.item:hover{background:var(--raised)}
.nm{color:var(--k);font-weight:600;overflow-wrap:anywhere}
.k-skill .nm::before{content:"/";opacity:.6}
.nm em{font-style:normal;font-weight:400;color:var(--dim)}
.nm em::before{content:"@"}
.co{color:var(--routine);font-weight:400;margin-left:1ch}
.ds{color:var(--dim)}
.ds::before{content:"# ";opacity:.6}
.none{color:var(--dim);margin:0;padding:.4rem .9rem}
@media (max-width:620px){.item{grid-template-columns:minmax(0,1fr);padding-block:.35rem}}
/* A listing comes in line by line when it scrolls into view. With no script, each line is there from the start. */
.grid.in .item,.grid.in .log{animation:rise .4s cubic-bezier(.2,.7,.2,1) backwards;animation-delay:calc(var(--i)*28ms)}
@keyframes rise{from{opacity:0;transform:translateX(-10px)}}

.tablewrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:640px;font-family:var(--body);font-size:.88rem;line-height:1.5}
td,th{text-align:left;padding:.6rem .9rem;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
th{font-family:var(--mono);font-size:.74rem;color:var(--dim);font-weight:500}
td{color:var(--dim)}
td.kind{font-family:var(--mono);font-weight:600;font-size:.84rem;color:var(--k,var(--ink));white-space:nowrap}
.rule{margin:1.2rem 0 0;font-family:var(--display);font-weight:500;font-size:clamp(1.15rem,2.6vw,1.5rem);line-height:1.3;letter-spacing:-.01em;max-width:32ch;text-wrap:balance}
.rule b:nth-of-type(1){color:var(--skill)}.rule b:nth-of-type(2){color:var(--mod)}.rule b:nth-of-type(3){color:var(--routine)}
footer{margin-top:3.4rem;color:var(--dim);font-family:var(--mono);font-size:.76rem}
@media (prefers-reduced-motion:reduce){.cur,.ln.st,.log.next,.grid.in .item,.grid.in .log,.graph.sel .ed.on{animation:none}}
</style>
<div class="wrap">
<header>
<p class="eyebrow"><b>$</b>setup-map --state @@DATE@@<i class="cur"></i></p>
<h1>Setup Map</h1>
<p class="lede">Everything in the Claude Code config of this computer, and the <b>@@N_FLOWS@@ flows</b> that tie the parts together. Each section is a command and its output. The same color marks a kind of part in every section.</p>
<div class="stats">
<div class="stat"><b>@@N_SKILLS@@</b><span>skills</span></div>
<div class="stat"><b>@@N_MODS@@</b><span>mods</span></div>
<div class="stat"><b>@@N_ROUT@@</b><span>routines</span></div>
<div class="stat"><b>@@N_EXTRA@@</b><span>scripts and agents</span></div>
<div class="stat"><b>@@N_FLOWS@@</b><span>flows</span></div>
<div class="stat"><b>@@N_RULES@@</b><span>safeguards</span></div>
</div>
</header>
<nav aria-label="Sections"><a href="#fit">tree</a><a href="#kinds">kinds</a><a href="#flows">flows</a><a href="#routines">log</a><a href="#graph-s">graph</a><a href="#skills">skills</a><a href="#mods">mods</a><a href="#scripts">scripts</a><a href="#rules">guards</a></nav>

<section id="fit">
<div class="head"><h2>How it fits</h2></div>
<p class="sub">Four kinds of part sit in one folder. Parts marked <code>[company]</code> know one product. All others work in any project.</p>
<div class="term"><div class="cmd"><b>$</b>tree -L 1 ~/.claude</div><div class="scroll"><pre class="out">@@TREE@@</pre></div></div>
</section>

<section id="kinds">
<div class="head"><h2>What is what</h2></div>
<p class="sub">Six kinds of part. They differ in who starts them and in what they can force.</p>
<div class="term"><div class="cmd"><b>$</b>cat KINDS.md</div><div class="tablewrap"><table><thead><tr><th>kind</th><th>what it is</th><th>who starts it</th><th>can it force something?</th><th>example</th></tr></thead><tbody>
<tr><td class="kind k-skill">Skill</td><td>A text file of steps. Claude reads it and follows it.</td><td>You, with a slash command, or the skill router when your words match.</td><td>No. It is advice. Claude can skip a step.</td><td><code>/merge-when-green</code></td></tr>
<tr><td class="kind k-mod">Mod</td><td>Code that runs inside the app. It hooks events: a prompt, a tool call, a new session, the screen.</td><td>The app, at each event. Nobody asks Claude.</td><td>Yes. It can block a tool call, change a prompt, draw a pane, start a turn.</td><td><code>ci-watch</code> blocks polling loops</td></tr>
<tr><td class="kind k-routine">Routine</td><td>A prompt that runs on a schedule, with nobody watching. It is a scheduled task.</td><td>The clock, or a manual run with <code>/autonomy run</code>.</td><td>Only what its rules and the kill switch allow. It stops on doubt.</td><td><code>morning-prep</code> at 07:30</td></tr>
<tr><td class="kind k-script">Script</td><td>A shell file that does one exact job with no thinking.</td><td>A skill, a routine or you.</td><td>Yes, in its own job only.</td><td><code>claims.sh</code> (one owner for a ticket)</td></tr>
<tr><td class="kind">Agent</td><td>A helper session for one part of a task, with its own model and effort.</td><td>A skill or Claude, in the background.</td><td>No. It reports back. Claude checks the result.</td><td>A reviewer of a sub-branch</td></tr>
<tr><td class="kind">Profile</td><td>A private layer on top of the public core. It holds company and product rules.</td><td>The installer. It links the files into <code>~/.claude</code>.</td><td>Sets the rules that all other parts follow.</td><td>Product skills and the merge policy</td></tr>
</tbody></table></div></div>
<p class="rule">Use a <b>skill</b> for a procedure, a <b>mod</b> for a rule that must always hold, and a <b>routine</b> for work that must happen without you.</p>
</section>

<section id="flows">
<div class="head"><h2>The flows</h2><span class="n">@@N_FLOWS@@ loops</span></div>
<p class="sub">Each flow is a loop. It runs while the kill switch is off, and a person is asked only at a gate. The lit line is the step that the loop is at.</p>
<div class="flows">
@@FLOWS@@
</div>
</section>

<section id="routines">
<div class="head"><h2>The day of the loops</h2><span class="n" id="nextrun">@@N_ROUT@@ routines</span></div>
<p class="sub">Each scheduled run of the day, in local time. A time that is past is dim. The log does not know if that run was successful: it reads only the schedule.</p>
<div class="term"><div class="cmd"><b>$</b>tail -f ~/.claude/loops.log<span class="hint" id="clock"></span></div>
<ul class="logs grid">
@@CRON@@
</ul>
<div class="tail"><i class="cur"></i></div></div>
</section>

<section id="graph-s">
<div class="head"><h2>How the parts connect</h2><span class="n">@@N_EDGES@@ calls</span></div>
<p class="sub">A part calls another part when its own files name it. An arc is one call, in the color of the part that makes it. Select a part to see what it does, what it calls and what calls it. To remove parts, type a part of their name after <code>grep -v</code> (some words with a space between them remove more), or set a flag to off.</p>
<div class="term"><label class="cmd" for="f2"><b>$</b>deps --graph | grep -v<input class="find" id="f2" type="search" placeholder="text" aria-label="Hide the parts whose name has this text"></label>
<div class="flags" id="flags" role="group" aria-label="Kinds of part in the graph">
<button type="button" class="k-routine" data-f="routine" aria-pressed="true">--routines</button><button type="button" class="k-skill" data-f="skill" aria-pressed="true">--skills</button><button type="button" class="k-mod" data-f="mod" aria-pressed="true">--mods</button><button type="button" class="k-script" data-f="script" aria-pressed="true">--scripts</button><button type="button" data-f="company" aria-pressed="true">--company</button>
<span class="com" id="gcount"></span></div>
<div class="deps">
<div class="scroll">
@@GRAPH@@
</div>
<div class="man" id="man" aria-live="polite"><h4>NAME</h4><p class="nil">Select a part in the graph.</p></div>
</div></div>
<script type="application/json" id="gdata">@@GDATA@@</script>
</section>

<section id="skills">
<div class="head"><h2>Skills</h2><span class="n">@@N_SKILLS@@ skills</span></div>
<p class="sub">Typed as a slash command, or picked by the skill router from your words. The search also reads the mods and the scripts.</p>
<div class="term"><label class="cmd" for="f1"><b>$</b>ls ~/.claude/skills | grep -i<input class="find" id="f1" type="search" placeholder="text" aria-label="Find a skill, a mod or a script"></label>
<p class="none" id="none" hidden># no line has that text</p>
<ul class="rows grid k-skill">
@@SKILLS@@
</ul></div>
</section>

<section id="mods">
<div class="head"><h2>Mods</h2><span class="n">@@N_MODS@@ mods</span></div>
<p class="sub">Small plugins that change the app: panes, themes, hooks on tool calls. A change to one shows after <code>/reload-plugins</code>.</p>
<div class="term"><div class="cmd"><b>$</b>claude plugin list</div>
<ul class="rows grid k-mod">
@@MODS@@
</ul></div>
</section>

<section id="scripts">
<div class="head"><h2>Scripts and agents</h2><span class="n">@@N_EXTRA@@ helpers</span></div>
<p class="sub">Shell files that do one exact job, and the helper agents. Skills and routines call them.</p>
<div class="term"><div class="cmd"><b>$</b>ls ~/.claude/*.sh ~/.claude/agents</div>
<ul class="rows grid k-script">
@@EXTRAS@@
</ul></div>
</section>

<section id="rules">
<div class="head"><h2>Safeguards</h2><span class="n">@@N_RULES@@ rules</span></div>
<p class="sub">What keeps the config safe to change often.</p>
<div class="term"><div class="cmd"><b>$</b>cat ~/.claude/guards</div>
<ul class="rows k-script">
@@RULES@@
</ul></div>
</section>
<footer># @@FOOTER@@</footer>
</div>
<script>
(function(){
  var f=document.getElementById('f1'),none=document.getElementById('none');
  if(f)f.addEventListener('input',function(){
    var q=f.value.trim().toLowerCase(),n=0;
    document.querySelectorAll('ul.grid .item').forEach(function(el){var off=q!==''&&(el.getAttribute('data-k')||'').indexOf(q)<0;el.hidden=off;if(!off)n++});
    if(none)none.hidden=n>0;
  });
  // The log on the real clock: each line is past, next (with the time left), later, or not today.
  var runs=[].slice.call(document.querySelectorAll('.log')),nr=document.getElementById('nextrun'),clock=document.getElementById('clock');
  function runsOn(f,day){if(f==='*')return true;if(f==='1-5')return day>=1&&day<=5;if(/^[0-7]$/.test(f))return(+f%7)===day;return true}
  function left(min){var h=Math.floor(min/60),m=min%60;return 'in '+(h?h+'h ':'')+m+'m'}
  function two(n){return('0'+n).slice(-2)}
  function tick(){
    var d=new Date(),m=d.getHours()*60+d.getMinutes(),day=d.getDay(),best=null,off=0;
    for(;off<8&&!best;off++)runs.forEach(function(r){var rm=+r.getAttribute('data-m');
      if(runsOn(r.getAttribute('data-d'),(day+off)%7)&&(off>0||rm>m)&&(!best||rm<+best.getAttribute('data-m')))best=r});
    off--;
    runs.forEach(function(r){
      var rm=+r.getAttribute('data-m'),st=r.querySelector('.st'),today=runsOn(r.getAttribute('data-d'),day),state;
      if(r===best)state='next';else if(!today)state='off';else if(rm<=m)state='past';else state='later';
      r.className='log '+state;
      st.textContent=state==='off'?'not today':state==='past'?'past':state==='later'?'later':(off===0?left(rm-m):off===1?'tomorrow':'in '+off+' days');
    });
    if(clock)clock.textContent='now '+two(d.getHours())+':'+two(d.getMinutes());
    if(best&&nr){var bm=+best.getAttribute('data-m');nr.textContent='next: ';var b=document.createElement('b');b.textContent=best.getAttribute('data-n');nr.appendChild(b);
      nr.appendChild(document.createTextNode(' at '+two(Math.floor(bm/60))+':'+two(bm%60)+(off===0?'':off===1?' tomorrow':' in '+off+' days')))}
  }
  tick();setInterval(tick,30000);
  // The call graph: one part is chosen. Its arcs and the parts at the other end of them are lit, and the man page says what it does.
  var G=null,svg=document.getElementById('graph'),man=document.getElementById('man');
  try{G=JSON.parse(document.getElementById('gdata').textContent)}catch(x){}
  function add(tag,cls,text,to){var el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;to.appendChild(el);return el}
  function names(title,list){
    add('h4','',title,man);
    if(!list.length){add('p','nil','none',man);return}
    var box=add('div','list',null,man);
    list.forEach(function(id){var b=add('button','k-'+G.n[id][0],id,box);b.type='button';b.addEventListener('click',function(){pick(id)})});
  }
  var vis={},cur=null,off={},f2=document.getElementById('f2'),flags=document.getElementById('flags'),gcount=document.getElementById('gcount'),nds=[],eds=[],y0={};
  function pick(id){
    if(!G||!svg||!G.n[id]||!vis[id])return;
    cur=id;var out=[],inn=[];
    G.e.forEach(function(ed){if(!vis[ed[0]]||!vis[ed[1]])return;if(ed[0]===id)out.push(ed[1]);if(ed[1]===id)inn.push(ed[0])});
    svg.classList.add('sel');
    eds.forEach(function(p){p.classList.toggle('on',p.getAttribute('data-s')===id||p.getAttribute('data-t')===id)});
    nds.forEach(function(n){var k=n.getAttribute('data-id');n.classList.toggle('me',k===id);n.classList.toggle('on',k===id||out.indexOf(k)>=0||inn.indexOf(k)>=0)});
    man.textContent='';
    add('h4','','NAME',man);var p=add('p','',null,man);add('b','kc k-'+G.n[id][0],id,p);add('span','com','  ('+G.n[id][0]+')',p);
    add('h4','','WHAT IT DOES',man);add('p','',G.n[id][1]||'No description.',man);
    names('CALLS',out);names('CALLED BY',inn);
  }
  // The part with the most calls among the parts that stay: a skill first, else any part.
  function busiest(){
    var most={},top=null,any=null;
    G.e.forEach(function(ed){if(vis[ed[0]]&&vis[ed[1]])most[ed[0]]=(most[ed[0]]||0)+1});
    Object.keys(most).forEach(function(k){if(!any||most[k]>most[any])any=k;if(G.n[k][0]==='skill'&&(!top||most[k]>most[top]))top=k});
    return top||any||Object.keys(vis)[0]||null;
  }
  // Hide the parts that the filters remove, move the others up, and draw each arc again between the new places.
  function layout(){
    var terms=(f2?f2.value:'').toLowerCase().split(/[\s,]+/).filter(Boolean),y=16,calls=0,parts=0;
    vis={};
    nds.forEach(function(n){
      var id=n.getAttribute('data-id'),d=G.n[id],hide=!!off[d[0]]||(d[2]&&off.company)||terms.some(function(t){return id.toLowerCase().indexOf(t)>=0});
      n.style.display=hide?'none':'';
      if(!hide){vis[id]=y;n.setAttribute('transform','translate(0 '+(y-y0[id])+')');y+=G.row;parts++}
    });
    eds.forEach(function(p){
      var a=vis[p.getAttribute('data-s')],b=vis[p.getAttribute('data-t')];
      if(!a||!b){p.style.display='none';return}
      var dd=Math.abs(b-a);calls++;p.style.display='';
      p.setAttribute('d','M'+G.x+' '+a+' A'+Math.min(320,24+dd*.42).toFixed(0)+' '+(dd/2).toFixed(1)+' 0 0 '+(b>a?1:0)+' '+G.x+' '+b);
    });
    svg.setAttribute('viewBox','0 0 '+G.w+' '+Math.max(y,40));
    if(gcount)gcount.textContent='# '+parts+' parts, '+calls+' calls';
    if(cur&&vis[cur])pick(cur);else{var t=busiest();if(t)pick(t);else{svg.classList.remove('sel');man.textContent='';add('h4','','NAME',man);add('p','nil','No part is left. Remove a filter.',man)}}
    try{localStorage.setItem('setup-map-graph',JSON.stringify({off:off,text:f2?f2.value:''}))}catch(x){}
  }
  if(G&&svg){
    nds=[].slice.call(svg.querySelectorAll('.nd'));eds=[].slice.call(svg.querySelectorAll('.ed'));
    nds.forEach(function(n){var id=n.getAttribute('data-id');y0[id]=+n.querySelector('circle').getAttribute('cy');
      n.addEventListener('click',function(){pick(id)});n.addEventListener('mouseenter',function(){pick(id)});
      n.addEventListener('keydown',function(ev){if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();pick(id)}})});
    try{var saved=JSON.parse(localStorage.getItem('setup-map-graph')||'null');if(saved){off=saved.off||{};if(f2&&typeof saved.text==='string')f2.value=saved.text}}catch(x){off={}}
    if(flags)[].forEach.call(flags.querySelectorAll('button'),function(b){var k=b.getAttribute('data-f');
      b.setAttribute('aria-pressed',off[k]?'false':'true');
      b.addEventListener('click',function(){off[k]=!off[k];b.setAttribute('aria-pressed',off[k]?'false':'true');layout()})});
    if(f2)f2.addEventListener('input',layout);
    layout();
  }
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');io.unobserve(en.target)}})},{rootMargin:'0px 0px -8% 0px'});
    document.querySelectorAll('ul.grid').forEach(function(g){[].forEach.call(g.children,function(el,i){el.style.setProperty('--i',i)});io.observe(g)});
  }
})();
</script>
"""
import datetime
for k, v in (('N_SKILLS', N_SKILLS), ('N_MODS', N_MODS), ('N_ROUT', N_ROUT), ('N_EXTRA', N_EXTRA), ('N_RULES', len(rules)), ('N_FLOWS', len(flows)),
             ('DATE', datetime.date.today().isoformat()), ('TREE', tree_html), ('GRAPH', graph_html), ('GDATA', graph_data), ('N_EDGES', N_EDGES), ('FLOWS', flows_html), ('CRON', cron_html),
             ('SKILLS', skills_html), ('MODS', mods_html), ('EXTRAS', extras_html), ('RULES', rules_html), ('FOOTER', footer_html)):
    page = page.replace('@@%s@@' % k, str(v))
open(OUT, 'w', encoding='utf-8').write(page)
PY_END
echo "$out"
