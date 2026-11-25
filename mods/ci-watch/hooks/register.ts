import type { EngineInterface, Register, Timer } from 'claude-code'
import { autoMergeDecision, validateRules, type MergePr, type Method, type PolicyLoad } from './merge-rules.js'

// ci-watch: keeps a watch list of pull requests in $.store, polls each one
// with `gh pr view` on a $.clock timer, and starts a turn ($.prompt.submit)
// when a PR turns red or conflicts (or is green with auto-merge on).
//
// Option `fix_turns` (plugin.json `userConfig`, default `on`): with `off`, a
// red or conflicted PR gets a toast and a notification and no turn. Use `off`
// when another watcher (the desktop app's Auto-fix) already starts the fix, so
// that two watchers do not act on one PR. The green path does not change.
//
// Option `loop` (default `on`): the lane loop with no person in it.
// - Fix tries: each automatic fix turn (red CI, conflict, failed deploy) counts
//   in the store, at most 3 for each PR. The turn text says "fix try N of 3".
//   A fourth failure starts one last turn: stop, write a decision record, mark
//   the ticket needs-you.
// - Merge: a green PR with auto-merge on gets a merge turn under merge-policy.
//   A refused `gh pr merge` gets a note: final, write a decision record.
// - Deploy watch: a merged PR stays on the list. ci-watch polls
//   `gh run list --commit <sha>` for a deploy workflow run. Success starts a
//   verify turn (the `deploy` skill on staging), failure a fix try on a
//   follow-up PR. No deploy run in 20 minutes: straight to close and clean.
// - Close and clean: when the verify turn ends, one turn closes the ticket and
//   removes the lane worktree and branch (the `cleanup` skill rules).
// - Limits: at most 60 automatic turns a day (local midnight resets the
//   count). At the cap ci-watch stops and stores one decision record.
// With `off`, ci-watch acts as before the loop (0.2.x).
//
// Option `autoMerge` (default true): ci-watch merges the user's own PRs by itself when CI
// turns green, so nobody types "merge N when green". On green it runs the pure check
// `autoMergeDecision` (merge-rules.ts): kill switch off, the PR is by you (`gh api user`) and
// not a draft, CI green and mergeStateStatus CLEAN, no requested changes, no production
// release, and the merge-policy rule file (~/.claude/merge-policy.json) allows the merge for
// the repo. All hold: a turn runs the `merge-when-green` steps (squash when the rule allows
// it, delete the branch); merge-policy still checks the real `gh pr merge` call. One fails:
// no merge, and a toast and the status line say why (a PR with auto-merge asked for on it
// gets a turn that says why too). With false, only a PR with auto-merge asked for
// (`/ci-watch auto-merge <pr> on`, the tool's `auto_merge`) is a candidate, under the same
// check. `/ci-watch auto-merge <pr> off` keeps one PR out.
//
// Kill switch: when ~/.claude/autonomy.off exists, ci-watch starts no turn and
// says nothing, with either value of `loop`. The event waits: when the file
// goes, the next poll acts on it.
//
// Interop: the tool `mcp__ci-watch__watch` (input `{ pr, cwd?, auto_merge?,
// follows? }`) adds a PR. The model can call it, and another mod calls it with
// `$.tool.call({ tool: 'mcp__ci-watch__watch', pr })`.

type $T = EngineInterface

// Set from the `fix_turns` and `loop` options when the module loads.
let fixTurns = true
let loopOn = true
let autoMergeOn = true
/** What the model is told the watch does, for the option's value. */
const effect = () =>
  fixTurns
    ? 'starts a turn when CI changes'
    : 'reports red CI and conflicts with a notification (it starts no fix turn; another watcher does the fix)'

const TOOL = 'mcp__ci-watch__watch'
const BASE_MS = 90_000
const MAX_MS = 600_000
const PRUNE_MS = 14 * 24 * 3600 * 1000
const KEY_PREFIX = 'watch/'
const PR_FIELDS =
  'statusCheckRollup,mergeable,mergeStateStatus,state,reviewDecision,url,title,baseRefName,mergeCommit,isDraft,author,headRefName,labels'
const POLICY_FILE = '.claude/merge-policy.json'
const RUN_FIELDS = 'databaseId,status,conclusion,workflowName,name,url'
export const MAX_TRIES = 3
export const DAY_CAP = 60
const DEPLOY_GRACE_MS = 20 * 60_000
const DECIDE_MS = 24 * 3600 * 1000
const OFF_FILE = '.claude/autonomy.off'
const DAY_KEY = 'loop/day'
const DECISIONS_KEY = 'loop/decisions'
const DEPLOY_RE = /deploy|staging/i

export type Verdict = 'pending' | 'green' | 'red' | 'conflict' | 'merged' | 'closed'

type Entry = {
  sessionId: string
  repo: string
  number: number
  url: string
  title?: string
  verdict?: Verdict
  signature?: string
  /** true: auto-merge asked for on this PR. false: kept out of the option autoMerge. Absent: the option decides. */
  autoMerge?: boolean
  /** Why ci-watch held back the merge at the last green, for the status line and the list. */
  hold?: string
  /** True after ci-watch started the merge turn. */
  merging?: boolean
  addedAt: number
  checkedAt?: number
  /** Automatic fix turns started for this PR (red CI, conflict, failed deploy), at most MAX_TRIES. */
  tries?: number
  /** True after the last turn (stop, decision record): no more fix turns. */
  gaveUp?: boolean
  /** True after merge-policy or a repo rule refused the merge. */
  mergeRefused?: boolean
  /**
   * The loop stage. Absent or `ci`: CI is watched. `deploy`: merged, the deploy run of `sha` is watched.
   * `verify`: the verify turn started. `close`: the verify turn ended; the close-and-clean turn is next.
   * `handed`: a follow-up PR takes the deploy fix.
   */
  phase?: 'ci' | 'deploy' | 'verify' | 'close' | 'handed'
  sha?: string
  mergedAt?: number
  baseRefName?: string
  /** The id of the verify turn, from `turn.start`. */
  verifyTurn?: string
}

/** A decision record of the shared contract: one JSON object. */
export type DecisionRecord = {
  id: string
  ticket: string | null
  question: string
  options: [string, string]
  default: string
  deadline: string
  reversible: boolean
}

type Run = {
  databaseId?: number
  status?: string
  conclusion?: string
  workflowName?: string
  name?: string
  url?: string
}

type PrRef = { repo: string; number: number; url?: string }

type Check = {
  __typename?: string
  name?: string
  context?: string
  workflowName?: string
  status?: string
  conclusion?: string
  state?: string
  detailsUrl?: string
  targetUrl?: string
  startedAt?: string
}

type PrView = MergePr & {
  statusCheckRollup?: Check[] | null
  mergeable?: string
  mergeStateStatus?: string
  state?: string
  reviewDecision?: string
  url?: string
  title?: string
  baseRefName?: string
  mergeCommit?: { oid?: string } | null
}

type Failed = { name: string; runId?: string; url?: string }

// Module state. A hot reload loses it; ensureStarted() rebuilds it lazily.
let sessionId: string | undefined
let timer: Timer | undefined
let intervalMs = BASE_MS
let isTicking = false
let allowPoll = false
let lastError: string | undefined
let myLogin: string | undefined

// ---------- parsing ----------

const URL_RE = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/
const SHORT_RE = /^([\w.-]+\/[\w.-]+)#(\d+)$/
const NUM_RE = /^#?(\d+)$/

export function parsePrSpec(spec: string): PrRef | { number: number } | undefined {
  const s = spec.trim()
  const u = URL_RE.exec(s)
  if (u?.[1] && u[2]) return { repo: u[1], number: Number(u[2]), url: `https://github.com/${u[1]}/pull/${u[2]}` }
  const r = SHORT_RE.exec(s)
  if (r?.[1] && r[2]) return { repo: r[1], number: Number(r[2]) }
  const n = NUM_RE.exec(s)
  if (n?.[1]) return { number: Number(n[1]) }
  return undefined
}

const isRef = (p: PrRef | { number: number } | undefined): p is PrRef => p !== undefined && 'repo' in p

function refOfUrl(url: string): PrRef | undefined {
  const u = URL_RE.exec(url)
  return u?.[1] && u[2] ? { repo: u[1], number: Number(u[2]), url } : undefined
}

const label = (r: { repo: string; number: number }) => `${r.repo}#${r.number}`
const keyOf = (owner: string, r: { repo: string; number: number }) =>
  `${KEY_PREFIX}${owner}/${label(r)}`

const FAIL = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])
const PENDING_STATE = new Set(['PENDING', 'EXPECTED'])

/**
 * True when a cancelled run was replaced: a run of the same check that did not start before it is in progress or
 * has a result other than CANCELLED. A workflow with a concurrency rule cancels its older run on each new event,
 * and the pull request then lists the two runs. Only the newer run says if the check passed.
 */
function isSuperseded(c: Check, all: Check[]): boolean {
  if (c.conclusion !== 'CANCELLED') return false

  return all.some(
    o =>
      o !== c &&
      o.name === c.name &&
      o.workflowName === c.workflowName &&
      o.conclusion !== 'CANCELLED' &&
      (o.startedAt === undefined || c.startedAt === undefined || o.startedAt >= c.startedAt),
  )
}

export function verdictOf(pr: PrView): { verdict: Verdict; failed: Failed[]; pending: number } {
  const failed: Failed[] = []
  let pending = 0
  const checks = pr.statusCheckRollup ?? []
  for (const c of checks) {
    if (isSuperseded(c, checks)) continue
    const name = c.name ?? c.context ?? 'check'
    const url = c.detailsUrl ?? c.targetUrl
    const runId = url ? /\/actions\/runs\/(\d+)/.exec(url)?.[1] : undefined
    if (c.__typename === 'StatusContext' || (c.state !== undefined && c.status === undefined)) {
      if (c.state && FAIL.has(c.state)) failed.push({ name, runId, url })
      else if (c.state && PENDING_STATE.has(c.state)) pending++
      continue
    }
    if (c.status !== undefined && c.status !== 'COMPLETED') pending++
    else if (c.conclusion && FAIL.has(c.conclusion)) failed.push({ name, runId, url })
  }
  const state = pr.state
  if (state === 'MERGED') return { verdict: 'merged', failed, pending }
  if (state === 'CLOSED') return { verdict: 'closed', failed, pending }
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY')
    return { verdict: 'conflict', failed, pending }
  if (failed.length > 0) return { verdict: 'red', failed, pending }
  if (pending > 0) return { verdict: 'pending', failed, pending }
  return { verdict: 'green', failed, pending }
}

const TICKET_RE = /\b([A-Z][A-Z0-9]{1,9}-[0-9][0-9A-Za-z]*)\b/

/** The ticket id in a PR title (for example `[SN-12] Fix it` or `CU-86abc Fix it`), else null. */
export function ticketOf(title: string | undefined): string | null {
  return (title && TICKET_RE.exec(title)?.[1]) || null
}

const RUN_OK = new Set(['success', 'skipped', 'neutral'])

/**
 * The deploy state of a commit from its `gh run list` runs (newest first): the newest run of each workflow whose
 * name has "deploy" or "staging". `none` when there is no such run.
 */
export function deployOf(runs: readonly Run[]): { state: 'none' | 'pending' | 'success' | 'failure'; run?: Run } {
  const seen = new Set<string>()
  const deploys: Run[] = []
  for (const r of runs) {
    const wf = r.workflowName ?? r.name ?? ''
    if (!DEPLOY_RE.test(wf) || seen.has(wf)) continue
    seen.add(wf)
    deploys.push(r)
  }
  if (deploys.length === 0) return { state: 'none' }
  const pending = deploys.find(r => (r.status ?? '').toLowerCase() !== 'completed')
  if (pending) return { state: 'pending', run: pending }
  const failed = deploys.find(r => !RUN_OK.has((r.conclusion ?? '').toLowerCase()))
  if (failed) return { state: 'failure', run: failed }
  return { state: 'success', run: deploys[0] }
}

const pad = (n: number) => String(n).padStart(2, '0')
/** The local date of a time, `YYYY-MM-DD`: the key of the daily cap. */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** The next local midnight after a time, as an ISO string. */
export function nextMidnight(ms: number): string {
  const d = new Date(ms)
  d.setHours(24, 0, 0, 0)
  return d.toISOString()
}

// A CI wait loop: sleep with a gh status call, or a gh command that blocks.
export function isPollCommand(cmd: string): boolean {
  if (/\bgh\s+pr\s+checks\b[^\n;&|]*--watch\b/.test(cmd)) return true
  if (/\bgh\s+run\s+watch\b/.test(cmd)) return true
  if (/merge-when-green\.sh\b/.test(cmd)) return true
  return /\bsleep\b/.test(cmd) && /\bgh\s+(pr\s+(checks|view)|run)\b/.test(cmd)
}

// `cd <dir> && ...` or `git -C <dir> ...`: the directory the command ran in.
function dirOf(cmd: string): string | undefined {
  const cd = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*&&/.exec(cmd)
  if (cd) return cd[1] ?? cd[2] ?? cd[3]
  const c = /\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(cmd)
  if (c) return c[1] ?? c[2] ?? c[3]
  return undefined
}

// A PR named in a gh command: a URL, or a number with -R/--repo.
function prInCommand(cmd: string): PrRef | { number: number } | undefined {
  const u = URL_RE.exec(cmd)
  if (u?.[1] && u[2]) return { repo: u[1], number: Number(u[2]) }
  const n = /\bgh\s+pr\s+(?:checks|view|merge)\s+#?(\d+)\b/.exec(cmd)
  if (!n?.[1]) return undefined
  const r = /(?:-R|--repo)[\s=]+([\w.-]+\/[\w.-]+)/.exec(cmd)
  return r?.[1] ? { repo: r[1], number: Number(n[1]) } : { number: Number(n[1]) }
}

// ---------- gh ----------

/** The user's home folder: HOME, else USERPROFILE (Windows apps have no HOME), with `\` as `/`. */
async function homeDir($: $T): Promise<string | undefined> {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  return home ? home.replace(/\\/g, '/') : undefined
}

async function expand($: $T, dir: string | undefined): Promise<string | undefined> {
  if (dir === undefined) return undefined
  if (dir === '~' || dir.startsWith('~/')) {
    const home = await homeDir($)
    if (home) return home + dir.slice(1)
  }
  return dir
}

async function gh($: $T, args: string[], cwd?: string) {
  return $.process.run(['gh', ...args], { cwd, timeoutMs: 30_000 })
}

async function prOfBranch($: $T, cwd?: string): Promise<PrRef | undefined> {
  const r = await gh($, ['pr', 'view', '--json', 'number,url,headRefName,headRepository'], cwd)
  if (r.exitCode !== 0) return undefined
  const j = JSON.parse(r.stdout) as { url?: string }
  return j.url ? refOfUrl(j.url) : undefined
}

async function resolveRef($: $T, spec: string, cwd?: string): Promise<PrRef | string> {
  const p = parsePrSpec(spec)
  if (!p) return `ci-watch: cannot read "${spec}". Use a PR URL, owner/repo#N or N.`
  if ('repo' in p) return p
  const r = await gh($, ['pr', 'view', String(p.number), '--json', 'number,url'], cwd)
  if (r.exitCode !== 0) return `ci-watch: gh pr view ${p.number} failed: ${r.stderr.trim()}`
  const j = JSON.parse(r.stdout) as { url?: string }
  const ref = j.url ? refOfUrl(j.url) : undefined
  return ref ?? `ci-watch: gh pr view ${p.number} gave no PR URL.`
}

// ---------- store ----------

async function sessionOf($: $T): Promise<string> {
  if (sessionId === undefined) sessionId = await $.session.id()
  return sessionId
}

async function entries($: $T): Promise<Entry[]> {
  const s = await sessionOf($)
  const prefix = `${KEY_PREFIX}${s}/`
  const out: Entry[] = []
  for (const k of await $.store.keys()) {
    if (!k.startsWith(prefix)) continue
    const v = (await $.store.get(k)) as Entry | undefined
    if (v && typeof v.number === 'number') out.push(v)
  }
  return out
}

async function save($: $T, e: Entry) {
  await $.store.set(keyOf(e.sessionId, e), e)
}

async function entryOf($: $T, ref: { repo: string; number: number }): Promise<Entry | undefined> {
  return (await $.store.get(keyOf(await sessionOf($), ref))) as Entry | undefined
}

async function recordDecision($: $T, d: DecisionRecord) {
  const old = await $.store.get(DECISIONS_KEY)
  const list = Array.isArray(old) ? (old as DecisionRecord[]) : []
  await $.store.set(DECISIONS_KEY, [...list.filter(x => x.id !== d.id), d].slice(-20))
}

async function addWatch($: $T, ref: PrRef): Promise<{ entry: Entry; isNew: boolean }> {
  const s = await sessionOf($)
  const k = keyOf(s, ref)
  const old = (await $.store.get(k)) as Entry | undefined
  if (old) return { entry: old, isNew: false }
  const entry: Entry = {
    sessionId: s,
    repo: ref.repo,
    number: ref.number,
    url: ref.url ?? `https://github.com/${ref.repo}/pull/${ref.number}`,
    addedAt: await $.clock.now(),
  }
  await save($, entry)
  await showStatus($)
  return { entry, isNew: true }
}

async function prune($: $T) {
  const now = await $.clock.now()
  for (const k of await $.store.keys()) {
    if (!k.startsWith(KEY_PREFIX)) continue
    const v = (await $.store.get(k)) as Entry | undefined
    if (!v || now - (v.checkedAt ?? v.addedAt ?? 0) > PRUNE_MS) await $.store.delete(k)
  }
}

// ---------- status ----------

async function showStatus($: $T) {
  const list = await entries($)
  if (list.length === 0) {
    $.ui.status(undefined)
    return
  }
  const counts = new Map<string, number>()
  for (const e of list) {
    const v = e.phase === 'deploy' ? 'deploying' : e.phase === 'verify' || e.phase === 'close' ? 'verifying' : e.phase === 'handed' ? '' : (e.verdict ?? 'pending')
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  if (counts.size === 0) {
    $.ui.status(undefined)
    return
  }
  const order = ['red', 'conflict', 'pending', 'green', 'deploying', 'verifying']
  const parts = order.filter(v => counts.has(v)).map(v => `${counts.get(v)} ${v}`)
  let text = `ci ${parts.join(' · ')}`
  const merges = list
    .filter(e => e.verdict === 'green' && !e.phase && (e.merging || e.hold))
    .slice(0, 2)
    .map(e => (e.merging ? `${label(e)} merging` : `${label(e)} held: ${(e.hold ?? '').slice(0, 60)}`))
  if (merges.length) text += ` · ${merges.join(' · ')}`
  if (intervalMs > BASE_MS) text += ` · rate-limited, next in ${Math.round(intervalMs / 60_000)}m`
  $.ui.status(text)
}

// ---------- timer ----------

function schedule($: $T) {
  timer?.cancel()
  timer = $.clock.every(intervalMs, () => {
    void tick($).catch(err => {
      lastError = String(err)
    })
  })
}

async function ensureStarted($: $T) {
  await sessionOf($)
  if (timer === undefined) {
    const p = (await $.store.get(`allowPoll/${sessionId}`)) as boolean | undefined
    allowPoll = p === true
    schedule($)
  }
}

const isRateLimited = (stderr: string) => /rate limit|\b403\b|\b429\b/i.test(stderr)

async function backOff($: $T) {
  const next = Math.min(intervalMs * 2, MAX_MS)
  if (next !== intervalMs) {
    intervalMs = next
    schedule($)
  }
}

function failedText(e: Entry, failed: Failed[]): string {
  const names = failed.map(f => f.name).join(', ') || 'unknown'
  const runIds = [...new Set(failed.map(f => f.runId).filter((x): x is string => !!x))]
  const urls = [...new Set(failed.map(f => f.url).filter((x): x is string => !!x))]
  const fetch = runIds.length
    ? runIds.map(id => `\`gh run view ${id} --log-failed -R ${e.repo}\``).join(' and ')
    : '`gh pr checks ' + e.number + ' -R ' + e.repo + '`'
  let text = `ci-watch: ${label(e)} is red. Failed checks: ${names}. Fetch the failed log with ${fetch}, fix it, push.`
  if (urls.length) text += ` Runs: ${urls.slice(0, 5).join(' ')}`
  return text
}

// ---------- loop: gate, texts ----------

/** True when the kill switch file ~/.claude/autonomy.off exists. Fails closed: an error or no home is "off". */
async function isOff($: $T): Promise<boolean> {
  const home = await homeDir($)
  if (!home) return true
  try {
    return await $.fs.exists(`${home.replace(/\/+$/, '')}/${OFF_FILE}`)
  } catch (err) {
    lastError = `kill switch check failed: ${String(err)}`
    return true
  }
}

type Day = { day: string; count: number; capped?: boolean }

async function today($: $T): Promise<Day> {
  const day = dayOf(await $.clock.now())
  const old = (await $.store.get(DAY_KEY)) as Day | undefined
  return old?.day === day ? old : { day, count: 0 }
}

/** Takes one automatic turn of the daily cap. At the cap: false, and one decision record for the day. */
async function takeTurn($: $T): Promise<boolean> {
  if (!loopOn) return true
  const cur = await today($)
  if (cur.count < DAY_CAP) {
    await $.store.set(DAY_KEY, { ...cur, count: cur.count + 1 })
    return true
  }
  if (!cur.capped) {
    await $.store.set(DAY_KEY, { ...cur, capped: true })
    const now = await $.clock.now()
    await recordDecision($, {
      id: `ci-watch-cap-${cur.day}`,
      ticket: null,
      question: `daily cap reached: ci-watch started ${DAY_CAP} automatic turns today and starts no more. Go on today?`,
      options: ['wait until local midnight', 'reset the count now with /ci-watch reset-cap'],
      default: 'wait until local midnight',
      deadline: nextMidnight(now),
      reversible: true,
    })
    const text = `ci-watch: daily cap reached (${DAY_CAP} automatic turns). No more turns until midnight; /ci-watch list shows the decision record.`
    $.ui.toast(text)
    void $.ui.notify(text, { title: 'ci-watch' }).catch(() => undefined)
  }
  return false
}

/** Starts one automatic turn, after the kill switch and the daily cap. False when it started none. */
async function startTurn($: $T, text: string): Promise<boolean> {
  if (await isOff($)) return false
  if (!(await takeTurn($))) return false
  await $.prompt.submit({ text })
  return true
}

function record(e: Pick<Entry, 'repo' | 'number' | 'title'>, kind: string, question: string, options: [string, string], now: number, reversible = true): string {
  const d: DecisionRecord = {
    id: `ci-watch-${e.repo.replace(/[^\w.-]/g, '-')}-${e.number}-${kind}`,
    ticket: ticketOf(e.title),
    question,
    options,
    default: options[0],
    deadline: new Date(now + DECIDE_MS).toISOString(),
    reversible,
  }
  return JSON.stringify(d)
}

const nextNote = (text: string) => ` Write \`next\` on the ticket row: "${text.slice(0, 90)}".`
const needsYou = (e: Pick<Entry, 'repo' | 'number' | 'title'>, rec: string, next: string) =>
  ` Write this decision record (one JSON object) in the ticket and in your report: ${rec} Mark the ticket needs-you.${nextNote(next)}`

function fixText(e: Entry, base: string, n: number): string {
  return `${base} This is fix try ${n} of ${MAX_TRIES} for ${label(e)}.${nextNote(`CI watch: fix try ${n} of ${MAX_TRIES}`)}`
}

function stopText(e: Entry, why: string, now: number): string {
  const rec = record(e, 'fix-tries', `${label(e)} is still ${why} after ${MAX_TRIES} automatic fix tries. How to go on?`, ['a person fixes it', 'close the PR'], now)
  return (
    `ci-watch: ${label(e)} is ${why} again after ${MAX_TRIES} automatic fix tries. Stop fixing it: make no more fix commits.` +
    needsYou(e, rec, `waits for a decision: ${why} after ${MAX_TRIES} fix tries`)
  )
}

/** The merge turn: every auto-merge rule held, so the model runs the merge-when-green steps now. */
export function mergeText(e: Pick<Entry, 'repo' | 'number' | 'title'>, method: Method, now: number, loop: boolean): string {
  const head =
    `ci-watch: ${label(e)} is green and clean, and every auto-merge rule holds` +
    ` (your PR, not a draft, mergeStateStatus CLEAN, no requested changes, no production release, merge-policy allows --${method} for ${e.repo}).` +
    ` Run the \`merge-when-green\` skill steps for it now, with no question to the user:` +
    ` 1. Read the PR once with \`gh pr view ${e.number} -R ${e.repo} --json isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup\`; if it is no longer green and clean, stop and say why.` +
    ` 2. Read the repo's CLAUDE.md and AGENTS.md for a merge rule that needs a person; if there is one, stop and name it.` +
    ` 3. Run exactly \`gh pr merge ${e.number} -R ${e.repo} --${method} --delete-branch\`. merge-policy checks that call.` +
    ` If merge-policy or a repo rule refuses the merge, the refusal is final: say so, do not retry and do not work around it.`
  if (!loop) return head
  const rec = record(e, 'merge-refused', `merge-policy or a repo rule refused the merge of ${label(e)}. How to go on?`, ['a person merges it', 'leave it open'], now)
  return head + needsYou(e, rec, 'waits for a decision: merge refused') + ` If the merge passes, write \`next\`: "deploy check: ci-watch watches the deploy".`
}

/** The turn for a PR with auto-merge asked for on it, when a rule holds the merge back. */
export function holdText(e: Pick<Entry, 'repo' | 'number' | 'title'>, reasons: readonly string[], now: number, loop: boolean): string {
  const head =
    `ci-watch: ${label(e)} is green, but ci-watch does not merge it: ${reasons.join('; ')}.` +
    ' Do not merge it and do not work around the rule. Say why in one line.'
  if (!loop) return head
  const rec = record(e, 'merge-held', `ci-watch held back the merge of ${label(e)}: ${reasons[0] ?? 'a rule failed'}. How to go on?`, ['a person merges it', 'leave it open'], now)
  return head + needsYou(e, rec, `waits for a decision: merge held (${reasons[0] ?? ''})`)
}

function verifyText(e: Entry, run: Run): string {
  const wf = run.workflowName ?? run.name ?? 'deploy'
  const ticket = ticketOf(e.title)
  return (
    `ci-watch: verify ${label(e)} on staging. The deploy run "${wf}" of ${(e.sha ?? '').slice(0, 7)} passed${run.url ? `: ${run.url}` : ''}.` +
    ` Run the \`deploy\` skill steps for this PR on staging (staging only: a release tag stays a decision record), test its test plan,` +
    ` and attach the evidence (screenshots, logs, URLs) to ${ticket ? `the ticket ${ticket}` : 'the ticket of this PR'}.` +
    ` Say in your answer if the verify passed or failed.${nextNote(`staging verify of ${label(e)}`)}`
  )
}

function deployFixText(e: Entry, run: Run, n: number): string {
  const wf = run.workflowName ?? run.name ?? 'deploy'
  const log = run.databaseId ? ` Fetch the failed log with \`gh run view ${run.databaseId} --log-failed -R ${e.repo}\`.` : ''
  return (
    `ci-watch: the deploy of ${label(e)} failed: run "${wf}"${run.url ? ` ${run.url}` : ''}. This is fix try ${n} of ${MAX_TRIES}.${log}` +
    ` Fix it on a new branch from the latest origin/${e.baseRefName ?? 'main'}, open a follow-up PR, and call mcp__ci-watch__watch` +
    ` with that PR, auto_merge true and follows "${label(e)}".${nextNote(`deploy fix: try ${n} of ${MAX_TRIES}`)}`
  )
}

function closeText(e: Entry, how: 'verified' | 'no-deploy', now: number): string {
  const ticket = ticketOf(e.title)
  const rec = record(e, 'verify-failed', `the staging verify of ${label(e)} failed. How to go on?`, ['a person checks it', 'revert the PR'], now)
  const head =
    how === 'verified'
      ? `ci-watch: close and clean up after ${label(e)}. The verify turn ended.` +
        ` 1. If the staging verify passed, close ${ticket ? `the ticket ${ticket}` : 'the ticket of this PR'} (the ticket-closer mod asks first) and clear \`next\` on its row.` +
        ` If the verify failed, do not close it.${needsYou(e, rec, 'waits for a decision: staging verify failed')}`
      : `ci-watch: close and clean up after ${label(e)}. No deploy workflow ran for ${(e.sha ?? '').slice(0, 7)} in ${DEPLOY_GRACE_MS / 60_000} minutes, so there is no staging verify.` +
        ` 1. Close ${ticket ? `the ticket ${ticket}` : 'the ticket of this PR'} as done (the ticket-closer mod asks first) and clear \`next\` on its row.`
  return (
    head +
    ` 2. Run the \`cleanup\` skill rules for this lane: remove its worktree and branch only when they are clean and pushed; keep them otherwise and say why.` +
    ' A production release, a message to other people and a destructive action stay manual: only a decision record.'
  )
}

// ---------- auto-merge inputs ----------

/** The user's GitHub login, from `gh api user` once per module load. Undefined when gh fails. */
async function whoAmI($: $T): Promise<string | undefined> {
  if (myLogin) return myLogin
  const r = await gh($, ['api', 'user', '--jq', '.login'])
  const login = r.exitCode === 0 ? r.stdout.trim() : ''
  if (/^[A-Za-z0-9-]{1,39}$/.test(login)) myLogin = login
  else lastError = `gh api user failed: ${r.stderr.trim().slice(0, 200)}`
  return myLogin
}

/** Reads the merge-policy rule file on each decision, so an edit applies at once. Fails closed. */
async function loadPolicy($: $T): Promise<PolicyLoad> {
  const home = await homeDir($)
  if (!home) return { kind: 'missing' }
  const path = `${home.replace(/\/+$/, '')}/${POLICY_FILE}`
  try {
    if (!(await $.fs.exists(path))) return { kind: 'missing' }
  } catch {
    return { kind: 'missing' }
  }
  try {
    const checked = validateRules(JSON.parse(await $.fs.read(path)))
    return 'rules' in checked ? { kind: 'ok', rules: checked.rules } : { kind: 'bad', error: checked.error }
  } catch (err) {
    return { kind: 'bad', error: err instanceof SyntaxError ? 'not valid JSON' : 'cannot read the file' }
  }
}

/** True when ci-watch weighs an auto-merge for this PR at green. */
const isCandidate = (e: Entry) => !e.mergeRefused && (e.autoMerge === true || (autoMergeOn && e.autoMerge !== false))

/** The green step: merge turn, hold turn, or only a toast. False when a turn was held (kill switch, cap). */
async function greenStep($: $T, e: Entry, pr: PrView, now: number): Promise<boolean> {
  const name = label(e)
  if (!isCandidate(e)) {
    $.ui.toast(`${name} is green`)
    void $.ui.notify(`${name} is green`, { title: 'ci-watch' }).catch(() => undefined)
    return true
  }
  const killSwitch = await isOff($)
  const me = await whoAmI($)
  const d = autoMergeDecision({ repo: e.repo, pr, killSwitch, me, policy: await loadPolicy($) })
  if (d.merge) {
    if (!(await startTurn($, mergeText(e, d.method, now, loopOn)))) return false
    await save($, { ...e, merging: true, hold: undefined })
    const text = `${name} is green: ci-watch merges it (--${d.method})`
    $.ui.toast(text)
    void $.ui.notify(text, { title: 'ci-watch' }).catch(() => undefined)
    return true
  }
  const why = d.reasons.join('; ')
  // The kill switch and an unknown login pass: the event waits for the next poll, and nothing is said.
  if (killSwitch || !me) {
    await save($, { ...e, hold: d.reasons[0] })
    return false
  }
  await save($, { ...e, hold: why })
  const text = `${name} is green; ci-watch does not merge it: ${why}`
  $.ui.toast(text.slice(0, 200))
  void $.ui.notify(text, { title: 'ci-watch' }).catch(() => undefined)
  if (e.autoMerge === true) return startTurn($, holdText(e, d.reasons, now, loopOn))
  return true
}

// ---------- polling ----------

/** A fix turn of the loop: counts the try, or after MAX_TRIES starts the last turn. False when the gate held it. */
async function fixTurn($: $T, e: Entry, base: string, why: string): Promise<boolean> {
  if (e.gaveUp) {
    $.ui.toast(`${label(e)} is ${why}; ci-watch stopped fixing it after ${MAX_TRIES} tries`)
    return true
  }
  const n = (e.tries ?? 0) + 1
  const now = await $.clock.now()
  const text = n <= MAX_TRIES ? fixText(e, base, n) : stopText(e, why, now)
  if (!(await startTurn($, text))) return false
  await save($, { ...e, tries: Math.min(n, MAX_TRIES), gaveUp: n > MAX_TRIES })
  return true
}

/** Polls the deploy run of a merged PR. Returns false on a rate-limit error. */
async function pollDeploy($: $T, e: Entry): Promise<boolean> {
  const r = await gh($, ['run', 'list', '--commit', e.sha ?? '', '-R', e.repo, '--json', RUN_FIELDS, '--limit', '20'])
  if (r.exitCode !== 0) {
    if (isRateLimited(r.stderr)) return false
    lastError = `${label(e)} deploy: ${r.stderr.trim().slice(0, 200)}`
    return true
  }
  const { state, run } = deployOf(JSON.parse(r.stdout) as Run[])
  const now = await $.clock.now()
  const k = keyOf(e.sessionId, e)
  await save($, { ...e, checkedAt: now })
  if (state === 'pending') return true
  if (state === 'none') {
    if (now - (e.mergedAt ?? now) < DEPLOY_GRACE_MS) return true
    if (await startTurn($, closeText(e, 'no-deploy', now))) await $.store.delete(k)
    return true
  }
  if (!run) return true
  if (state === 'success') {
    if (await startTurn($, verifyText(e, run))) await save($, { ...e, checkedAt: now, phase: 'verify' })
    return true
  }
  const n = (e.tries ?? 0) + 1
  if (n <= MAX_TRIES) {
    if (await startTurn($, deployFixText(e, run, n))) await save($, { ...e, checkedAt: now, phase: 'handed', tries: n })
    return true
  }
  const rec = record(e, 'deploy-failed', `the deploy of ${label(e)} still fails after ${MAX_TRIES} fix tries. How to go on?`, ['a person fixes it', 'revert the PR'], now)
  const text =
    `ci-watch: the deploy of ${label(e)} failed again after ${MAX_TRIES} automatic fix tries${run.url ? ` (${run.url})` : ''}. Stop fixing it.` +
    needsYou(e, rec, `waits for a decision: deploy failed after ${MAX_TRIES} fix tries`)
  if (await startTurn($, text)) await $.store.delete(k)
  return true
}

/** Polls one PR. Returns false on a rate-limit error. */
async function pollOne($: $T, e: Entry): Promise<boolean> {
  if (e.phase === 'deploy') return pollDeploy($, e)
  if (e.phase === 'close') {
    if (await startTurn($, closeText(e, 'verified', await $.clock.now()))) await $.store.delete(keyOf(e.sessionId, e))
    return true
  }
  if (e.phase === 'verify' || e.phase === 'handed') return true
  const r = await gh($, ['pr', 'view', String(e.number), '-R', e.repo, '--json', PR_FIELDS])
  if (r.exitCode !== 0) {
    if (isRateLimited(r.stderr)) return false
    lastError = `${label(e)}: ${r.stderr.trim().slice(0, 200)}`
    return true
  }
  const pr = JSON.parse(r.stdout) as PrView
  const { verdict, failed } = verdictOf(pr)
  // For an auto-merge candidate a green PR acts again when what the merge rules read changes.
  const signature =
    verdict === 'red'
      ? `red:${failed.map(f => `${f.name}@${f.runId ?? ''}`).sort().join(',')}`
      : verdict === 'green' && isCandidate(e)
        ? `green:${pr.mergeStateStatus ?? ''}:${pr.reviewDecision ?? ''}:${pr.isDraft === true ? 'draft' : ''}`
        : verdict
  const isChanged = signature !== e.signature
  const now = await $.clock.now()
  const next: Entry = {
    ...e,
    verdict,
    signature,
    title: pr.title ?? e.title,
    url: pr.url ?? e.url,
    baseRefName: pr.baseRefName ?? e.baseRefName,
    checkedAt: now,
    ...(verdict === 'green' ? {} : { hold: undefined, merging: undefined }),
  }
  const name = label(e)

  if (verdict === 'merged' && loopOn && pr.mergeCommit?.oid) {
    await save($, { ...next, phase: 'deploy', sha: pr.mergeCommit.oid, mergedAt: now })
    $.ui.toast(`${name} is merged; ci-watch watches its deploy`)
    return true
  }
  if (verdict === 'merged' || verdict === 'closed') {
    await $.store.delete(keyOf(e.sessionId, e))
    $.ui.toast(`${name} is ${verdict}; ci-watch stopped watching it`)
    return true
  }
  await save($, next)
  if (!isChanged) return true

  // A turn the gate held (kill switch, daily cap) keeps the old signature, so the next poll acts on the event.
  const held = () => save($, { ...next, signature: e.signature })
  if ((verdict === 'red' || verdict === 'conflict') && !fixTurns) {
    const text = verdict === 'red' ? `${name} is red: ${failed.map(f => f.name).join(', ')}` : `${name} has merge conflicts`
    $.ui.toast(text)
    void $.ui.notify(text, { title: 'ci-watch' }).catch(() => undefined)
  } else if (verdict === 'red' || verdict === 'conflict') {
    const base = pr.baseRefName ?? 'main'
    const text =
      verdict === 'red'
        ? failedText(e, failed)
        : `ci-watch: ${name} has merge conflicts with ${base}. Fetch origin, rebase onto (or merge) origin/${base}, resolve the conflicts, run the tests, and push.`
    const isStarted = loopOn ? await fixTurn($, next, text, verdict === 'red' ? 'red' : 'in conflict') : await startTurn($, text)
    if (!isStarted) await held()
  } else if (verdict === 'green') {
    if (!(await greenStep($, next, pr, now))) {
      const cur = (await entryOf($, next)) ?? next
      await save($, { ...cur, signature: e.signature })
    }
  }
  return true
}

async function tick($: $T) {
  if (isTicking) return
  isTicking = true
  try {
    let isLimited = false
    for (const e of await entries($)) {
      if (!(await pollOne($, e))) {
        isLimited = true
        break
      }
    }
    if (isLimited) await backOff($)
    else if (intervalMs !== BASE_MS) {
      intervalMs = BASE_MS
      schedule($)
    }
    await showStatus($)
  } finally {
    isTicking = false
  }
}

// ---------- command ----------

async function runCommand($: $T, args: string): Promise<string> {
  const [sub = 'list', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const cwd = await $.session.cwd()
  if (sub === 'list') {
    const list = await entries($)
    const head = `ci-watch: ${list.length} PR(s) watched, every ${Math.round(intervalMs / 1000)} s; allow-poll ${allowPoll ? 'on' : 'off'}.`
    const day = await today($)
    const loopLine = loopOn
      ? `loop on: ${day.count} of ${DAY_CAP} automatic turns today${(await isOff($)) ? '; kill switch on (~/.claude/autonomy.off): no turns' : ''}.`
      : 'loop off.'
    const mergeLine = autoMergeOn
      ? 'auto-merge on: ci-watch merges your own green, clean PRs under merge-policy (option autoMerge).'
      : 'auto-merge off: only PRs with auto-merge on (option autoMerge).'
    const rows = list.map(e => {
      const stage = e.phase === 'deploy' ? 'merged, deploy watched' : e.phase === 'verify' ? 'merged, verify turn' : e.phase === 'close' ? 'verified, close turn next' : e.phase === 'handed' ? 'merged, fix in a follow-up PR' : (e.verdict ?? 'not checked yet')
      const notes = [
        ...(e.tries ? [`fix try ${e.tries} of ${MAX_TRIES}`] : []),
        ...(e.gaveUp ? ['stopped: needs-you'] : []),
        ...(e.mergeRefused ? ['merge refused'] : []),
        ...(e.autoMerge ? ['auto-merge on'] : []),
        ...(e.autoMerge === false ? ['auto-merge off'] : []),
        ...(e.merging ? ['merging'] : []),
        ...(e.hold && !e.merging ? [`merge held: ${e.hold}`] : []),
      ]
      return `- ${label(e)} ${stage}${notes.length ? ` (${notes.join(', ')})` : ''}${e.title ? ` — ${e.title}` : ''}`
    })
    const old = await $.store.get(DECISIONS_KEY)
    const decisions = Array.isArray(old) ? (old as DecisionRecord[]).filter(d => d.id === `ci-watch-cap-${day.day}`) : []
    return [
      head,
      loopLine,
      mergeLine,
      ...rows,
      ...decisions.map(d => `decision: ${JSON.stringify(d)}`),
      ...(lastError ? [`last error: ${lastError}`] : []),
    ].join('\n')
  }
  if (sub === 'reset-cap') {
    const day = await today($)
    await $.store.set(DAY_KEY, { day: day.day, count: 0 })
    return `ci-watch: the count of automatic turns for ${day.day} is 0 again (cap ${DAY_CAP}).`
  }
  if (sub === 'add' || sub === 'remove' || sub === 'auto-merge') {
    const spec = rest[0]
    if (!spec) return `Usage: /ci-watch ${sub} <pr-url | owner/repo#N | N>${sub === 'auto-merge' ? ' on|off' : ''}`
    const ref = await resolveRef($, spec, cwd)
    if (typeof ref === 'string') return ref
    if (sub === 'add') {
      const { isNew } = await addWatch($, ref)
      return isNew ? `ci-watch: now watching ${label(ref)}.` : `ci-watch: already watching ${label(ref)}.`
    }
    const k = keyOf(await sessionOf($), ref)
    const old = (await $.store.get(k)) as Entry | undefined
    if (sub === 'remove') {
      if (!old) return `ci-watch: ${label(ref)} is not watched.`
      await $.store.delete(k)
      await showStatus($)
      return `ci-watch: stopped watching ${label(ref)}.`
    }
    const on = rest[1]
    if (on !== 'on' && on !== 'off') return 'Usage: /ci-watch auto-merge <pr> on|off'
    const entry = old ?? (await addWatch($, ref)).entry
    // A green PR with auto-merge newly on gets its prompt at the next tick.
    await save($, { ...entry, autoMerge: on === 'on', signature: on === 'on' && entry.verdict === 'green' ? undefined : entry.signature })
    return `ci-watch: auto-merge ${on} for ${label(ref)}.`
  }
  if (sub === 'allow-poll') {
    const on = rest[0]
    if (on !== 'on' && on !== 'off') return 'Usage: /ci-watch allow-poll on|off'
    allowPoll = on === 'on'
    await $.store.set(`allowPoll/${await sessionOf($)}`, allowPoll)
    return `ci-watch: allow-poll ${on}. ${allowPoll ? 'CI wait loops run as asked.' : 'CI wait loops are refused while ci-watch can watch the PR.'}`
  }
  if (sub === 'check') {
    // A command.run hook may not submit a prompt (it would wait on itself),
    // so the poll runs on a timer just after the command answers.
    $.clock.after(1, () => {
      void tick($).catch(err => {
        lastError = String(err)
      })
    })
    return 'ci-watch: checking every watched PR now; the status line shows the result.'
  }
  return 'Usage: /ci-watch list | add <pr> | remove <pr> | auto-merge <pr> on|off | allow-poll on|off | check | reset-cap'
}

// ---------- register ----------

export const register: Register = (on, options) => {
  fixTurns = options.fix_turns !== 'off'
  loopOn = options.loop !== 'off'
  autoMergeOn = options.autoMerge !== false && options.autoMerge !== 'false'

  on('session.start', async ($, e, next) => {
    try {
      sessionId = await $.session.id()
      await $.command.register({
        name: 'ci-watch',
        description: 'Watch PR CI: list | add <pr> | remove <pr> | auto-merge <pr> on|off | allow-poll on|off | check | reset-cap',
        argumentHint: 'list | add <pr> | remove <pr> | auto-merge <pr> on|off | allow-poll on|off | check | reset-cap',
      })
      await $.tool.register({
        name: 'watch',
        description:
          'Add a GitHub pull request to the ci-watch list. ci-watch polls its CI and ' +
          (fixTurns
            ? 'starts a new turn when it turns red, has conflicts, or (with auto-merge) is green'
            : 'starts a new turn when it is green with auto-merge on; for red CI and conflicts it only sends a notification, and another watcher does the fix') +
          (loopOn ? '; after a merge it watches the deploy run and starts the verify, close and cleanup turns' : '') +
          '. Call this instead of sleeping or polling CI. `pr` is a PR URL, owner/repo#N, or a number in the repo at `cwd` (default: the session directory).',
        inputSchema: {
          type: 'object',
          properties: {
            pr: { type: 'string', description: 'PR URL, owner/repo#N, or N' },
            cwd: { type: 'string', description: 'Repo directory used to resolve a bare number' },
            auto_merge: {
              type: 'boolean',
              description:
                'true: at green, ci-watch merges it when every auto-merge rule holds (your PR, not a draft, CLEAN, no requested changes, no production release, merge-policy allows it), else a turn says why. false: never auto-merge this PR',
            },
            follows: {
              type: 'string',
              description: 'The merged PR (owner/repo#N) whose failed deploy this PR fixes: this PR takes over its fix-try count',
            },
          },
          required: ['pr'],
        },
      })
      await prune($)
      await ensureStarted($)
      await showStatus($)
    } catch (err) {
      lastError = String(err)
    }
    return next(e)
  })

  // The watch tool needs no prompt: it only adds a PR to the list.
  on('tool.check', { tool: TOOL }, () => ({ decision: 'allow' as const }))

  // No matcher here: the tool name is compared as a string, so the hook types
  // the same whether or not the MCP type list names this tool yet.
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== TOOL) return next(e)
    const args = e as unknown as Record<string, unknown>
    try {
      await ensureStarted($)
      const pr = typeof args.pr === 'string' ? args.pr : String(args.pr ?? '')
      const cwd = typeof args.cwd === 'string' ? args.cwd : await $.session.cwd()
      const ref = await resolveRef($, pr, cwd)
      if (typeof ref === 'string') return { result: ref }
      let { entry, isNew } = await addWatch($, ref)
      let note = ''
      const follows = typeof args.follows === 'string' ? parsePrSpec(args.follows) : undefined
      if (isRef(follows)) {
        const old = await entryOf($, follows)
        if (old?.phase === 'handed') {
          entry = { ...entry, tries: Math.max(entry.tries ?? 0, old.tries ?? 0) }
          await save($, entry)
          await $.store.delete(keyOf(old.sessionId, old))
          note += ` It takes over the fix tries of ${label(old)}: ${entry.tries} of ${MAX_TRIES} used.`
        }
      }
      if (args.auto_merge === true && entry.autoMerge !== true) {
        await save($, { ...entry, autoMerge: true, signature: entry.verdict === 'green' ? undefined : entry.signature })
        note += ' Auto-merge is on: at green ci-watch merges it when the auto-merge rules hold, else a turn says why.'
      } else if (args.auto_merge === false && entry.autoMerge !== false) {
        await save($, { ...entry, autoMerge: false })
        note += ' Auto-merge is off for this PR.'
      }
      return {
        result: `ci-watch ${isNew ? 'now watches' : 'already watches'} ${label(ref)} and ${effect()}.${note} Do not poll CI.`,
      }
    } catch (err) {
      return { result: `ci-watch: could not add the PR: ${String(err)}` }
    }
  }).catch(($, e, next) => next(e))

  // The verify turn: its start names the PR, its end starts the close-and-clean turn.
  on('turn.start', async ($, e, next) => {
    try {
      const m = loopOn && e.agentId === undefined ? /^ci-watch: verify ([\w.-]+\/[\w.-]+)#(\d+) on staging\./.exec(e.text) : null
      if (m?.[1] && m[2]) {
        const old = await entryOf($, { repo: m[1], number: Number(m[2]) })
        if (old?.phase === 'verify' && old.verifyTurn === undefined) await save($, { ...old, verifyTurn: e.turnId })
      }
    } catch (err) {
      lastError = String(err)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    try {
      if (loopOn && e.agentId === undefined) {
        const done = (await entries($)).find(x => x.phase === 'verify' && x.verifyTurn === e.turnId)
        if (done && e.reason === 'answer') {
          // A hook may not wait on a new turn: the close turn starts at a poll just after this turn ends.
          await save($, { ...done, phase: 'close' })
          $.clock.after(1, () => {
            void tick($).catch(err => {
              lastError = String(err)
            })
          })
        } else if (done) {
          await $.store.delete(keyOf(done.sessionId, done))
          $.ui.toast(`${label(done)}: the verify turn did not end with an answer; ci-watch stopped the loop`)
          await showStatus($)
        }
      }
    } catch (err) {
      lastError = String(err)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'ci-watch' }, async ($, e) => {
    try {
      await ensureStarted($)
      return { text: await runCommand($, e.args) }
    } catch (err) {
      return { text: `ci-watch failed: ${String(err)}` }
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const cmd = e.command
    let dir: string | undefined
    try {
      await ensureStarted($)
      dir = await expand($, dirOf(cmd))
      if (!allowPoll && isPollCommand(cmd)) {
        const named = prInCommand(cmd)
        let ref: PrRef | undefined
        if (named && 'repo' in named) ref = named
        else if (named) {
          const r = await resolveRef($, String(named.number), dir)
          ref = typeof r === 'string' ? undefined : r
        } else ref = await prOfBranch($, dir)
        if (ref) {
          await addWatch($, ref)
          return {
            deny: `ci-watch watches ${label(ref)} and ${effect()}. Do not poll; continue with other work or end the turn.`,
          }
        }
      }
    } catch (err) {
      lastError = String(err)
    }

    const ran = await next(e)
    try {
      // A refusal: the call was denied (merge-policy, a deny rule), or gh failed on a repo rule. Other gh errors are not.
      const isRuleError = ran.isError === true && /policy|protected|not allowed|is required|refus|denied/i.test(ran.text ?? '')
      const refused = loopOn && /\bgh\s+pr\s+merge\b/.test(cmd) && (ran.deny !== undefined || isRuleError)
      const named = refused ? prInCommand(cmd) : undefined
      const ref = isRef(named) ? named : refused ? await prOfBranch($, dir) : undefined
      const old = ref ? await entryOf($, ref) : undefined
      if (old) {
        await save($, { ...old, mergeRefused: true })
        const rec = record(old, 'merge-refused', `merge-policy or a repo rule refused the merge of ${label(old)}. How to go on?`, ['a person merges it', 'leave it open'], await $.clock.now())
        const note =
          `ci-watch: the merge of ${label(old)} was refused${ran.deny ? ` (${ran.deny})` : ''}. The refusal is final: do not retry and do not work around it.` +
          needsYou(old, rec, 'waits for a decision: merge refused')
        // A denied call carries no context: the note goes with the reason.
        if (ran.deny !== undefined) return { deny: `${ran.deny}\n${note}` }
        return { ...ran, context: [...(ran.context ?? []), note] }
      }
    } catch (err) {
      lastError = String(err)
    }
    try {
      const isPush = /\bgit\b[^\n;&|]*\bpush\b/.test(cmd) || /\bgh\s+pr\s+create\b/.test(cmd)
      if (isPush && ran.deny === undefined && ran.isError !== true) {
        const fromOutput = ran.text ? URL_RE.exec(ran.text) : null
        const ref =
          /\bgh\s+pr\s+create\b/.test(cmd) && fromOutput?.[1] && fromOutput[2]
            ? { repo: fromOutput[1], number: Number(fromOutput[2]) }
            : await prOfBranch($, dir)
        if (ref) {
          const { isNew } = await addWatch($, ref)
          const note = `ci-watch ${isNew ? 'now watches' : 'still watches'} ${label(ref)} and ${effect()}. Do not poll CI.`
          return { ...ran, context: [...(ran.context ?? []), note] }
        }
      }
    } catch (err) {
      lastError = String(err)
    }
    return ran
  }).catch(($, e, next) => next(e))
}
