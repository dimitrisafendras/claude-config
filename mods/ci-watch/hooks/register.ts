import type { EngineInterface, Register, Timer } from 'claude-code'

// ci-watch: keeps a watch list of pull requests in $.store, polls each one
// with `gh pr view` on a $.clock timer, and starts a turn ($.prompt.submit)
// when a PR turns red or conflicts (or is green with auto-merge on).
//
// Option `fix_turns` (plugin.json `userConfig`, default `on`): with `off`, a
// red or conflicted PR gets a toast and a notification and no turn. Use `off`
// when another watcher (the desktop app's Auto-fix) already starts the fix, so
// that two watchers do not act on one PR. The green path does not change.
//
// Interop: the tool `mcp__ci-watch__watch` (input `{ pr, cwd? }`) adds a PR.
// The model can call it, and another mod calls it with
// `$.tool.call({ tool: 'mcp__ci-watch__watch', pr })`.

type $T = EngineInterface

// Set from the `fix_turns` option when the module loads.
let fixTurns = true
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
  'statusCheckRollup,mergeable,mergeStateStatus,state,reviewDecision,url,title,baseRefName'

export type Verdict = 'pending' | 'green' | 'red' | 'conflict' | 'merged' | 'closed'

type Entry = {
  sessionId: string
  repo: string
  number: number
  url: string
  title?: string
  verdict?: Verdict
  signature?: string
  autoMerge?: boolean
  addedAt: number
  checkedAt?: number
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
}

type PrView = {
  statusCheckRollup?: Check[] | null
  mergeable?: string
  mergeStateStatus?: string
  state?: string
  reviewDecision?: string
  url?: string
  title?: string
  baseRefName?: string
}

type Failed = { name: string; runId?: string; url?: string }

// Module state. A hot reload loses it; ensureStarted() rebuilds it lazily.
let sessionId: string | undefined
let timer: Timer | undefined
let intervalMs = BASE_MS
let isTicking = false
let allowPoll = false
let lastError: string | undefined

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

function refOfUrl(url: string): PrRef | undefined {
  const u = URL_RE.exec(url)
  return u?.[1] && u[2] ? { repo: u[1], number: Number(u[2]), url } : undefined
}

const label = (r: { repo: string; number: number }) => `${r.repo}#${r.number}`
const keyOf = (owner: string, r: { repo: string; number: number }) =>
  `${KEY_PREFIX}${owner}/${label(r)}`

const FAIL = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])
const PENDING_STATE = new Set(['PENDING', 'EXPECTED'])

export function verdictOf(pr: PrView): { verdict: Verdict; failed: Failed[]; pending: number } {
  const failed: Failed[] = []
  let pending = 0
  for (const c of pr.statusCheckRollup ?? []) {
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
  const n = /\bgh\s+pr\s+(?:checks|view)\s+#?(\d+)\b/.exec(cmd)
  if (!n?.[1]) return undefined
  const r = /(?:-R|--repo)[\s=]+([\w.-]+\/[\w.-]+)/.exec(cmd)
  return r?.[1] ? { repo: r[1], number: Number(n[1]) } : { number: Number(n[1]) }
}

// ---------- gh ----------

async function expand($: $T, dir: string | undefined): Promise<string | undefined> {
  if (dir === undefined) return undefined
  if (dir === '~' || dir.startsWith('~/')) {
    const home = await $.env.get('HOME')
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
    const v = e.verdict ?? 'pending'
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const order: Verdict[] = ['red', 'conflict', 'pending', 'green']
  const parts = order.filter(v => counts.has(v)).map(v => `${counts.get(v)} ${v}`)
  let text = `ci ${parts.join(' · ')}`
  if (intervalMs > BASE_MS) text += ` · rate-limited, next in ${Math.round(intervalMs / 60_000)}m`
  $.ui.status(text)
}

// ---------- polling ----------

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

/** Polls one PR. Returns false on a rate-limit error. */
async function pollOne($: $T, e: Entry): Promise<boolean> {
  const r = await gh($, ['pr', 'view', String(e.number), '-R', e.repo, '--json', PR_FIELDS])
  if (r.exitCode !== 0) {
    if (isRateLimited(r.stderr)) return false
    lastError = `${label(e)}: ${r.stderr.trim().slice(0, 200)}`
    return true
  }
  const pr = JSON.parse(r.stdout) as PrView
  const { verdict, failed } = verdictOf(pr)
  const signature =
    verdict === 'red'
      ? `red:${failed.map(f => `${f.name}@${f.runId ?? ''}`).sort().join(',')}`
      : verdict
  const isChanged = signature !== e.signature
  const next: Entry = {
    ...e,
    verdict,
    signature,
    title: pr.title ?? e.title,
    url: pr.url ?? e.url,
    checkedAt: await $.clock.now(),
  }
  const name = label(e)

  if (verdict === 'merged' || verdict === 'closed') {
    await $.store.delete(keyOf(e.sessionId, e))
    $.ui.toast(`${name} is ${verdict}; ci-watch stopped watching it`)
    return true
  }
  await save($, next)
  if (!isChanged) return true

  if ((verdict === 'red' || verdict === 'conflict') && !fixTurns) {
    const text = verdict === 'red' ? `${name} is red: ${failed.map(f => f.name).join(', ')}` : `${name} has merge conflicts`
    $.ui.toast(text)
    void $.ui.notify(text, { title: 'ci-watch' }).catch(() => undefined)
  } else if (verdict === 'red') {
    await $.prompt.submit({ text: failedText(e, failed) })
  } else if (verdict === 'conflict') {
    const base = pr.baseRefName ?? 'main'
    await $.prompt.submit({
      text: `ci-watch: ${name} has merge conflicts with ${base}. Fetch origin, rebase onto (or merge) origin/${base}, resolve the conflicts, run the tests, and push.`,
    })
  } else if (verdict === 'green') {
    $.ui.toast(`${name} is green`)
    void $.ui.notify(`${name} is green`, { title: 'ci-watch' }).catch(() => undefined)
    if (e.autoMerge) {
      await $.prompt.submit({
        text: `ci-watch: ${name} is green and mergeable; merge it per the repo rules.`,
      })
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
    const rows = list.map(
      e => `- ${label(e)} ${e.verdict ?? 'not checked yet'}${e.autoMerge ? ' (auto-merge on)' : ''}${e.title ? ` — ${e.title}` : ''}`,
    )
    return [head, ...rows, ...(lastError ? [`last error: ${lastError}`] : [])].join('\n')
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
  return 'Usage: /ci-watch list | add <pr> | remove <pr> | auto-merge <pr> on|off | allow-poll on|off | check'
}

// ---------- register ----------

export const register: Register = (on, options) => {
  fixTurns = options.fix_turns !== 'off'

  on('session.start', async ($, e, next) => {
    try {
      sessionId = await $.session.id()
      await $.command.register({
        name: 'ci-watch',
        description: 'Watch PR CI: list | add <pr> | remove <pr> | auto-merge <pr> on|off | allow-poll on|off | check',
        argumentHint: 'list | add <pr> | remove <pr> | auto-merge <pr> on|off | allow-poll on|off | check',
      })
      await $.tool.register({
        name: 'watch',
        description:
          'Add a GitHub pull request to the ci-watch list. ci-watch polls its CI and ' +
          (fixTurns
            ? 'starts a new turn when it turns red, has conflicts, or (with auto-merge) is green'
            : 'starts a new turn when it is green with auto-merge on; for red CI and conflicts it only sends a notification, and another watcher does the fix') +
          '. Call this instead of sleeping or polling CI. `pr` is a PR URL, owner/repo#N, or a number in the repo at `cwd` (default: the session directory).',
        inputSchema: {
          type: 'object',
          properties: {
            pr: { type: 'string', description: 'PR URL, owner/repo#N, or N' },
            cwd: { type: 'string', description: 'Repo directory used to resolve a bare number' },
            auto_merge: { type: 'boolean', description: 'true: when the PR is green, start a turn that merges it per the repo rules' },
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
      const { entry, isNew } = await addWatch($, ref)
      let note = ''
      if (args.auto_merge === true && entry.autoMerge !== true) {
        await save($, { ...entry, autoMerge: true, signature: entry.verdict === 'green' ? undefined : entry.signature })
        note = ' Auto-merge is on: a green turn merges it per the repo rules.'
      }
      return {
        result: `ci-watch ${isNew ? 'now watches' : 'already watches'} ${label(ref)} and ${effect()}.${note} Do not poll CI.`,
      }
    } catch (err) {
      return { result: `ci-watch: could not add the PR: ${String(err)}` }
    }
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
