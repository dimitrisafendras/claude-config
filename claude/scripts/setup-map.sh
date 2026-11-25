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
SM_CORE="$core" SM_PROFILE="$profile" SM_OUT="$out" python3 -I - <<'PY_END'
import html, os
e = html.escape
OUT = os.environ['SM_OUT']

flows = [
 ("Start the day",[("07:30","morning-prep loop"),("config sync","pull + install when clean"),("inbox + plan","tickets, ranked"),("/paralel","starts the free tickets"),("08:15","daily-digest")]),
 ("Do the work",[("lane","one session for each ticket"),("agents","sub-branches, a reviewer each"),("ci-watch","fix red CI, up to 3 tries"),("merge","on green, by the merge policy"),("needs you","a decision record, never a wait")]),
 ("After the merge",[("deploy watch","the run of the merge commit"),("verify","staging, with evidence"),("ticket-closer","close the ticket"),("cleanup","worktree and branch, at once")]),
 ("Keep it clean",[("12:00","sweep: repair stale PRs"),("03:00","config-loop: pull, install, audit"),("02:30","nightly-cleanup"),("19:00","prefs-sync"),("Monday","audit and releases digest")]),
 ("Change the setup",[("edit","main checkout, dev branch"),("/reload-plugins","look, repeat"),("one PR","CI must pass"),("merge on green","auto-merge"),("pull + install","install.sh --mods")]),
 ("Run it by hand",[("/autonomy status","loops, last run, kill switch"),("/autonomy run <loop>","one loop, now"),("/autonomy run lane <ticket>","one ticket, now"),("/autonomy off","the kill switch")]),
]
rules = [
 ("kill switch","The file ~/.claude/autonomy.off stops every loop at its next step. /autonomy off and on set it."),
 ("3 tries","A fix is tried at most 3 times for a PR; then the ticket needs you, with a decision record."),
 ("manual gates","A production release, a message to other people, money, secrets and destructive data stay yours."),
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
    def hh(x): return x.zfill(2)
    times = ' and '.join('%s:%s' % (hh(x), mi.zfill(2)) for x in h.split(','))
    return '%s %s' % (times, days)
routines = []
for p in sorted(glob.glob(CORE + '/routines/*.md')):
    if p.endswith('README.md'): continue
    f = front(p)
    routines.append((cron_words(f.get('schedule', '?').split('#')[0].strip().strip('"')), f.get('name', os.path.basename(p)[:-3]), first_sentence(f.get('description', ''), 130)))
routines.sort(key=lambda r: r[0])
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

def item(n, d, k, v='', co=0):
    tag = '<span class="co">company</span>' if co else ''
    ver = f'<em>{v}</em>' if v else ''
    return f'<li class="item{" is-co" if co else ""}" data-k="{e((n+" "+d).lower())}"><span class="nm">{e(n)} {ver}{tag}</span><span class="ds">{e(d)}</span></li>'

skills_html = "\n".join(item(n,d,'s','',c) for n,d,c in skills)
mods_html = "\n".join(item(n,d,'m',v,c) for n,v,d,c in mods)
extras_html = "\n".join(item(n,d,'x') for n,d in extras)
flows_html = "\n".join('<div class="flow"><h3>%s</h3><ol>%s</ol></div>' % (e(t), "".join('<li><b>%s</b><span>%s</span></li>' % (e(a), e(b)) for a,b in s)) for t,s in flows)
routines_html = "\n".join('<tr><td class="mono">%s</td><td class="nm">%s</td><td>%s</td></tr>' % (e(a), e(b), e(c)) for a,b,c in routines)
rules_html = "\n".join('<li><b>%s</b>%s</li>' % (e(a), e(b)) for a,b in rules)

page = '''<title>Setup Map</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
/* Layout: one column under a sticky index. How it fits, the flows, then the parts: skills, mods, routines, safeguards. */
:root{--bg:#f4f6fb;--surface:#ffffff;--ink:#14213d;--muted:#55627f;--line:#d8deec;--accent:#0f7b8a;--warm:#9a6412;--ok:#2f8f5b;
--display:"Space Grotesk",ui-sans-serif,system-ui,sans-serif;--body:"Inter",ui-sans-serif,system-ui,sans-serif;--mono:"JetBrains Mono",ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0e1430;--surface:#151c42;--ink:#e8edfb;--muted:#a3afd0;--line:#2a3568;--accent:#4cc3d4;--warm:#e2b44a;--ok:#5cd08f;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0e1430;--surface:#151c42;--ink:#e8edfb;--muted:#a3afd0;--line:#2a3568;--accent:#4cc3d4;--warm:#e2b44a;--ok:#5cd08f;color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:var(--body);line-height:1.55;padding-block:0 4rem;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.wrap{max-width:1040px;margin:0 auto}
header{padding-block:2.2rem 1.2rem}
h1{font-family:var(--display);font-size:clamp(2rem,5vw,3.1rem);line-height:1.05;margin:0 0 .5rem;letter-spacing:-.02em}
.lede{color:var(--muted);max-width:62ch;margin:0}
nav{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--bg);border-bottom:1px solid var(--line);display:flex;gap:.25rem;flex-wrap:wrap;padding:.5rem 0}
nav a{color:var(--muted);text-decoration:none;font-size:.85rem;padding:.35rem .7rem;border-radius:999px}
nav a:hover,nav a:focus-visible{background:var(--surface);color:var(--ink);outline:2px solid var(--accent)}
section{padding-block:2.4rem 0}
h2{font-family:var(--display);font-size:1.5rem;margin:0 0 .3rem;letter-spacing:-.01em}
h3{font-family:var(--display);font-size:1rem;margin:0 0 .6rem}
.sub{color:var(--muted);margin:0 0 1.2rem;max-width:70ch}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:.6rem;margin-top:1.4rem}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:.7rem .9rem}
.stat b{display:block;font-family:var(--display);font-size:1.7rem;line-height:1.1;font-variant-numeric:tabular-nums}
.stat span{color:var(--muted);font-size:.8rem}
.diagram{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:1rem;overflow-x:auto}
.diagram svg{display:block;min-width:720px;width:100%;height:auto}
.diagram text{font-family:var(--body);fill:var(--ink);font-size:13px}
.diagram .t{font-family:var(--display);font-weight:700;font-size:14px}
.diagram .m{fill:var(--muted);font-size:11.5px;font-family:var(--mono)}
.box{fill:var(--bg);stroke:var(--line);stroke-width:1.5}
.hot{fill:none;stroke:var(--accent);stroke-width:2}
.arr{stroke:var(--muted);stroke-width:1.6;fill:none;marker-end:url(#ah)}
.find{width:100%;max-width:360px;padding:.55rem .8rem;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit;margin-bottom:1rem}
.find:focus-visible{outline:2px solid var(--accent)}
ul.grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:.6rem}
.item{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:.7rem .9rem;display:flex;flex-direction:column;gap:.2rem;min-width:0}
.nm{font-family:var(--mono);font-weight:600;font-size:.88rem;overflow-wrap:anywhere}
.nm em{font-style:normal;font-weight:400;color:var(--muted);margin-left:.4rem}
.co{font-family:var(--body);font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;color:var(--warm);border:1px solid var(--warm);border-radius:999px;padding:0 .45rem;margin-left:.5rem;font-weight:600}
.ds{color:var(--muted);font-size:.87rem}
.item[hidden]{display:none}
.tag{display:block;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--warm);margin:0 0 .5rem;font-weight:600}
.flows{display:grid;gap:1rem}
.flow{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem}
.flow ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.7rem}
.flow li{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:8px;padding:.4rem .7rem;position:relative;min-width:0}
.flow li+li::before{content:"→";position:absolute;left:-.62rem;top:.55rem;color:var(--muted);font-size:.8rem;background:var(--surface);line-height:1}
.flow li b{font-family:var(--mono);font-size:.82rem;color:var(--accent)}
.flow li span{font-size:.78rem;color:var(--muted)}
.tablewrap{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;min-width:560px}
td,th{text-align:left;padding:.6rem .9rem;border-bottom:1px solid var(--line);vertical-align:top;font-size:.9rem}
tr:last-child td{border-bottom:0}
th{font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600}
.mono{font-family:var(--mono);font-size:.82rem;white-space:nowrap}
code{font-family:var(--mono);font-size:.86em}
.rules{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:.6rem;list-style:none;margin:0;padding:0}
.rules li{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:.7rem .9rem;font-size:.9rem}
.rules b{display:block;font-family:var(--mono);font-size:.82rem;color:var(--ok);margin-bottom:.15rem}
footer{margin-top:3rem;color:var(--muted);font-size:.82rem}
</style>
<div class="wrap">
<header>
<h1>Setup Map</h1>
<p class="lede">Everything in the Claude Code config of this computer: N_SKILLS skills, N_MODS mods, N_ROUT routines, N_EXTRA scripts and agents, and the six flows that tie them together. State of STATE_DATE.</p>
<div class="stats">
<div class="stat"><b>N_SKILLS</b><span>skills</span></div>
<div class="stat"><b>N_MODS</b><span>mods</span></div>
<div class="stat"><b>N_ROUT</b><span>routines</span></div>
<div class="stat"><b>N_EXTRA</b><span>scripts and agents</span></div>
<div class="stat"><b>6</b><span>flows</span></div>
<div class="stat"><b>N_RULES</b><span>safeguards</span></div>
</div>
</header>
<nav aria-label="Sections"><a href="#fit">How it fits</a><a href="#kinds">What is what</a><a href="#flows">Flows</a><a href="#skills">Skills</a><a href="#mods">Mods</a><a href="#routines">Routines</a><a href="#rules">Safeguards</a></nav>

<section id="fit">
<h2>How it fits</h2>
<p class="sub">Four kinds of part sit in <code>~/.claude</code>. Claude Code reads them in the app, the CLI and the scheduled runs. Parts marked "company" know one product; all others work in any project.</p>
<div class="diagram">
<svg viewBox="0 0 900 300" role="img" aria-label="Skills, mods, routines and scripts sit in the .claude folder, which Claude Code reads.">
<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor" style="color:var(--muted)"/></marker></defs>
<rect class="box" x="10" y="15" width="240" height="60" rx="10"/><text class="t" x="26" y="40">Skills · N_SKILLS</text><text class="m" x="26" y="60">typed as a slash command</text>
<rect class="box" x="10" y="85" width="240" height="60" rx="10"/><text class="t" x="26" y="110">Mods · N_MODS</text><text class="m" x="26" y="130">panes, themes, hooks</text>
<rect class="box" x="10" y="155" width="240" height="60" rx="10"/><text class="t" x="26" y="180">Routines · N_ROUT</text><text class="m" x="26" y="200">prompts on a schedule</text>
<rect class="box" x="10" y="225" width="240" height="60" rx="10"/><text class="t" x="26" y="250">Scripts + agent · N_EXTRA</text><text class="m" x="26" y="270">memory, merge, status line</text>
<rect class="hot" x="350" y="70" width="200" height="150" rx="12"/><text class="t" x="372" y="105">~/.claude</text><text class="m" x="372" y="128">settings, output style</text><text class="m" x="372" y="148">profile rules, ticket sources</text><text class="m" x="372" y="168">merge-policy rules</text><text class="m" x="372" y="188">mods load in place</text>
<rect class="box" x="650" y="70" width="240" height="150" rx="12"/><text class="t" x="672" y="105">Claude Code</text><text class="m" x="672" y="128">desktop app</text><text class="m" x="672" y="148">terminal CLI</text><text class="m" x="672" y="168">scheduled runs</text><text class="m" x="672" y="188">lane sessions and agents</text>
<path class="arr" d="M250 45 L348 120"/><path class="arr" d="M250 115 L348 135"/><path class="arr" d="M250 185 L348 160"/><path class="arr" d="M250 255 L348 190"/><path class="arr" d="M550 145 L648 145"/>
</svg>
</div>
</section>

<section id="kinds">
<h2>What is what</h2>
<p class="sub">Six kinds of part. They differ in who starts them and in what they can force. A skill gives advice. A mod enforces a rule. A routine runs alone.</p>
<div class="tablewrap"><table><thead><tr><th>Kind</th><th>What it is</th><th>Who starts it</th><th>Can it force something?</th><th>Example</th></tr></thead><tbody>
<tr><td class="mono">Skill</td><td>A text file of steps. Claude reads it and follows it.</td><td>You, with a slash command, or the skill router when your words match.</td><td>No. It is advice. Claude can skip a step.</td><td><code>/merge-when-green</code></td></tr>
<tr><td class="mono">Mod</td><td>Code that runs inside the app. It hooks events: a prompt, a tool call, a new session, the screen.</td><td>The app, at each event. Nobody asks Claude.</td><td>Yes. It can block a tool call, change a prompt, draw a pane, start a turn.</td><td><code>ci-watch</code> blocks polling loops</td></tr>
<tr><td class="mono">Routine</td><td>A prompt that runs on a schedule, with nobody watching. It is a scheduled task.</td><td>The clock, or a manual run with <code>/autonomy run</code>.</td><td>Only what its rules and the kill switch allow. It stops on doubt.</td><td><code>morning-prep</code> at 07:30</td></tr>
<tr><td class="mono">Script</td><td>A shell file that does one exact job with no thinking.</td><td>A skill, a routine or you.</td><td>Yes, in its own job only.</td><td><code>autonomy.sh</code> (kill switch)</td></tr>
<tr><td class="mono">Agent</td><td>A helper session for one part of a task, with its own model and effort.</td><td>A skill or Claude, in the background.</td><td>No. It reports back. Claude checks the result.</td><td>A reviewer of a sub-branch</td></tr>
<tr><td class="mono">Profile</td><td>A private layer on top of the public core. It holds company and product rules.</td><td>The installer. It links the files into <code>~/.claude</code>.</td><td>Sets the rules that all other parts follow.</td><td>Product skills and the merge policy</td></tr>
</tbody></table></div>
<p class="sub" style="margin-top:1rem">A simple rule: use a skill for a procedure, a mod for a rule that must always hold, and a routine for work that must happen without you.</p>
</section>

<section id="flows">
<h2>The flows</h2>
<p class="sub">Each flow is a loop: a routine, an event or a manual run starts it, and a person is asked only at a gate. Each box is a skill, a mod or a routine from the lists below.</p>
<div class="flows">
FLOWS
</div>
</section>

<section id="skills">
<h2>Skills</h2>
<p class="sub">Typed as a slash command, or picked by the skill router from your words.</p>
<input class="find" id="f1" type="search" placeholder="Find a skill or a mod" aria-label="Find a skill or a mod">
<ul class="grid">
SKILLS
</ul>
</section>

<section id="mods">
<h2>Mods</h2>
<p class="sub">Small plugins that change the app: panes, themes, hooks on tool calls. A change to one shows after <code>/reload-plugins</code>.</p>
<ul class="grid">
MODS
</ul>
</section>

<section id="routines">
<h2>Routines</h2>
<p class="sub">Prompts that run on a schedule with nobody watching. Each is a scheduled task.</p>
<div class="tablewrap"><table><thead><tr><th>When</th><th>Routine</th><th>What it does</th></tr></thead><tbody>
ROUTINES
</tbody></table></div>
<h3 style="margin-top:1.6rem">Scripts and agent</h3>
<ul class="grid">
EXTRAS
</ul>
</section>

<section id="rules">
<h2>Safeguards</h2>
<p class="sub">What keeps the config safe to change often.</p>
<ul class="rules">
RULES
</ul>
</section>
<footer>Model claude-opus-5-5 at medium effort · output style ASD-STE100 · 18 plugins enabled by the config · company parts are marked and are the only ones that name a product.</footer>
</div>
<script>
(function(){var f=document.getElementById('f1');if(!f)return;f.addEventListener('input',function(){var q=f.value.trim().toLowerCase();document.querySelectorAll('#skills .item,#mods .item').forEach(function(el){el.hidden=q!==''&&(el.getAttribute('data-k')||'').indexOf(q)<0})})})();
</script>
'''
import datetime
page = page.replace('N_SKILLS', str(N_SKILLS)).replace('N_MODS', str(N_MODS)).replace('N_ROUT', str(N_ROUT)).replace('N_EXTRA', str(N_EXTRA)).replace('N_RULES', str(len(rules))).replace('STATE_DATE', datetime.date.today().isoformat())
page = page.replace('FLOWS', flows_html).replace('SKILLS', skills_html).replace('MODS', mods_html).replace('ROUTINES', routines_html).replace('EXTRAS', extras_html).replace('RULES', rules_html)
open(OUT, 'w').write(page)
PY_END
echo "$out"
