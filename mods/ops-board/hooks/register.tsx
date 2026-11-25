import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OpsAgent, OpsBoard, OpsCi, OpsPr, OpsTask, OpsVerdict } from '../types'

const PANE = 'ops-board'
const TITLE = 'Ops board'
const PR_EVERY_MS = 2 * 60 * 1000
const AGENTS_EVERY_MS = 20 * 1000
const RECENT_MS = 7 * 24 * 60 * 60 * 1000
const RECHECK_MS = 30 * 60 * 1000
const MAX_VIEWS = 10
const KEEP_ENDED_MS = 30 * 60 * 1000
const BACKOFF_MIN_MS = 4 * 60 * 1000
const BACKOFF_MAX_MS = 30 * 60 * 1000

const RATE_LIMIT = /rate limit|secondary rate|abuse detection|submitted too quickly/i
const ENDED = new Set(['completed', 'failed', 'killed'])
const FAILED = new Set(['failed', 'killed'])
const BAD_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])
const VERDICT_ORDER: OpsVerdict[] = ['red', 'conflict', 'changes-requested', 'pending', 'green', 'unknown', 'old']

const EMPTY: OpsBoard = {
  agents: [],
  spawned: {},
  tasks: [],
  tasksAt: 0,
  prs: [],
  prsAt: 0,
  prError: '',
  ghCalls: 0,
  backoffUntil: 0,
  backoffMs: 0,
  isRefreshing: false,
  ci: {},
}

const board = atom({ plugin: 'ops-board', key: 'board' } as const, EMPTY, { shape: 'board-1' })

type $T = EngineInterface

// Module caches: lost on reload, rebuilt on the next refresh.
let isPrRunning = false
let lastStatus = ''

function agentState(status: string): 'running' | 'done' | 'failed' {
  if (FAILED.has(status)) return 'failed'
  if (status === 'completed') return 'done'
  return 'running'
}

function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

function clip(text: string, width: number): string {
  if (width <= 1) return text.slice(0, 1)
  return text.length > width ? text.slice(0, width - 1) + '…' : text
}

type Check = { __typename?: string; status?: string; conclusion?: string; state?: string; name?: string; context?: string }
type View = { statusCheckRollup?: Check[]; mergeable?: string; reviewDecision?: string }

export function verdictOf(view: View): { verdict: OpsVerdict; detail?: string } {
  if (view.mergeable === 'CONFLICTING') return { verdict: 'conflict', detail: 'merge conflict' }
  if (view.reviewDecision === 'CHANGES_REQUESTED') return { verdict: 'changes-requested', detail: 'changes requested' }
  const checks = view.statusCheckRollup ?? []
  const failed: string[] = []
  let pending = 0
  for (const c of checks) {
    const name = c.name ?? c.context ?? '?'
    if (c.__typename === 'StatusContext' || (c.state !== undefined && c.status === undefined)) {
      const st = (c.state ?? '').toUpperCase()
      if (st === 'FAILURE' || st === 'ERROR') failed.push(name)
      else if (st !== 'SUCCESS') pending += 1
      continue
    }
    if ((c.status ?? '').toUpperCase() !== 'COMPLETED') {
      pending += 1
      continue
    }
    if (BAD_CONCLUSIONS.has((c.conclusion ?? '').toUpperCase())) failed.push(name)
  }
  if (failed.length > 0) return { verdict: 'red', detail: `failed: ${failed.slice(0, 3).join(', ')}` }
  if (pending > 0) return { verdict: 'pending', detail: `${pending} pending` }
  return { verdict: 'green', detail: checks.length === 0 ? 'no checks' : `${checks.length} checks` }
}

async function refreshAgents($: $T): Promise<void> {
  try {
    const list = await $.agent.list()
    const now = await $.clock.now()
    await update($, board, b => {
      const prev = new Map(b.agents.map(a => [a.id, a]))
      const ids = new Set(list.map(a => a.id))
      const agents: OpsAgent[] = list.map(a => {
        const p = prev.get(a.id)
        const sp = b.spawned[a.id]
        const one: OpsAgent = {
          id: a.id,
          label: a.name ?? (a.description !== '' ? a.description : a.type),
          type: a.type,
          model: sp?.model ?? p?.model ?? '?',
          status: a.status,
          firstSeen: sp?.startedAt ?? p?.firstSeen ?? now,
        }
        if (ENDED.has(a.status)) one.endedAt = p?.endedAt ?? now
        return one
      })
      // An ended agent the engine dropped stays listed for a while.
      for (const p of b.agents) {
        if (!ids.has(p.id) && p.endedAt !== undefined && now - p.endedAt < KEEP_ENDED_MS) agents.push(p)
      }
      return { ...b, agents }
    })
  } catch {
    // The list is read again on the next tick.
  }
}

async function ghJson($: $T, argv: string[]): Promise<{ ok: true; value: unknown } | { ok: false; error: string; isRateLimit: boolean }> {
  try {
    const r = await $.process.run(['gh', ...argv], { timeoutMs: 30000 })
    if (r.exitCode !== 0) {
      const error = (r.stderr || r.stdout).trim().split('\n')[0] ?? 'gh failed'
      return { ok: false, error, isRateLimit: RATE_LIMIT.test(r.stderr + r.stdout) }
    }
    return { ok: true, value: JSON.parse(r.stdout) }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { ok: false, error, isRateLimit: RATE_LIMIT.test(error) }
  }
}

type SearchRow = { number: number; title: string; url: string; updatedAt: string; repository: { nameWithOwner: string } }

async function backOff($: $T, error: string): Promise<void> {
  const now = await $.clock.now()
  await update($, board, b => {
    const backoffMs = Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, b.backoffMs * 2))
    return { ...b, backoffMs, backoffUntil: now + backoffMs, prError: `gh rate limit: ${error}` }
  })
}

async function refreshPrs($: $T, force: boolean): Promise<void> {
  if (isPrRunning) return
  isPrRunning = true
  try {
    const now = await $.clock.now()
    const start = await read($, board)
    if (!force && now < start.backoffUntil) return
    await update($, board, b => ({ ...b, isRefreshing: true }))
    const search = await ghJson($, [
      'search', 'prs', '--author', '@me', '--state', 'open',
      '--json', 'number,title,repository,url,updatedAt', '--limit', '50',
    ])
    if (!search.ok) {
      if (search.isRateLimit) await backOff($, search.error)
      else await update($, board, b => ({ ...b, prError: search.error }))
      return
    }
    const rows = (Array.isArray(search.value) ? (search.value as SearchRow[]) : [])
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    const ci: Record<string, OpsCi> = { ...start.ci }
    const prs: OpsPr[] = []
    let calls = 0
    let isLimited = false
    let limitError = ''
    for (const row of rows) {
      const repo = row.repository.nameWithOwner
      const key = `${repo}#${row.number}`
      const base = { repo, number: row.number, title: row.title, url: row.url, updatedAt: row.updatedAt }
      const cached = ci[key]
      const isRecent = now - Date.parse(row.updatedAt) < RECENT_MS
      const isFresh =
        cached !== undefined &&
        cached.updatedAt === row.updatedAt &&
        cached.verdict !== 'pending' &&
        now - cached.checkedAt < RECHECK_MS
      if (!isRecent) {
        prs.push({ ...base, verdict: 'old', detail: 'not checked: no update in 7 days' })
        continue
      }
      if (isFresh) {
        prs.push({ ...base, verdict: cached.verdict, ...(cached.detail ? { detail: cached.detail } : {}) })
        continue
      }
      if (isLimited || calls >= MAX_VIEWS) {
        prs.push({ ...base, verdict: cached?.verdict ?? 'unknown', detail: 'check waits for next refresh' })
        continue
      }
      calls += 1
      const view = await ghJson($, [
        'pr', 'view', String(row.number), '-R', repo, '--json', 'statusCheckRollup,mergeable,reviewDecision',
      ])
      if (!view.ok) {
        if (view.isRateLimit) {
          isLimited = true
          limitError = view.error
        }
        prs.push({ ...base, verdict: cached?.verdict ?? 'unknown', detail: view.error })
        continue
      }
      const v = verdictOf(view.value as View)
      ci[key] = { updatedAt: row.updatedAt, verdict: v.verdict, checkedAt: now, ...(v.detail ? { detail: v.detail } : {}) }
      prs.push({ ...base, ...v })
    }
    // Forget cache rows of PRs that are no longer open.
    const open = new Set(prs.map(p => `${p.repo}#${p.number}`))
    for (const key of Object.keys(ci)) if (!open.has(key)) delete ci[key]
    await update($, board, b => ({
      ...b,
      prs,
      ci,
      prsAt: now,
      ghCalls: calls + 1,
      prError: '',
      backoffMs: isLimited ? b.backoffMs : 0,
      backoffUntil: isLimited ? b.backoffUntil : 0,
    }))
    if (isLimited) await backOff($, limitError)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await update($, board, b => ({ ...b, prError: error })).catch(() => undefined)
  } finally {
    isPrRunning = false
    await update($, board, b => ({ ...b, isRefreshing: false })).catch(() => undefined)
    await pushStatus($)
  }
}

function counts(b: OpsBoard) {
  const byVerdict = new Map<OpsVerdict, number>()
  for (const pr of b.prs) byVerdict.set(pr.verdict, (byVerdict.get(pr.verdict) ?? 0) + 1)
  const running = b.agents.filter(a => agentState(a.status) === 'running').length
  const failed = b.agents.filter(a => agentState(a.status) === 'failed').length
  return { byVerdict, running, failed }
}

export function statusLine(b: OpsBoard): string {
  const { byVerdict, running, failed } = counts(b)
  const agents = `agents ${running}${failed > 0 ? ` (${failed} failed)` : ''}`
  if (b.prsAt === 0) return `${agents} · PR …`
  const parts = VERDICT_ORDER.filter(v => v !== 'old' && (byVerdict.get(v) ?? 0) > 0).map(
    v => `${byVerdict.get(v)} ${v === 'changes-requested' ? 'changes' : v}`,
  )
  return `${agents} · PR ${parts.length > 0 ? parts.join(' ') : 'none'}`
}

async function pushStatus($: $T): Promise<void> {
  try {
    const line = statusLine(await read($, board))
    if (line !== lastStatus) {
      lastStatus = line
      $.ui.status(line)
    }
  } catch {
    // Kept as it was.
  }
}

function sortedAgents(agents: OpsAgent[]): OpsAgent[] {
  const rank = { running: 0, failed: 1, done: 2 } as const
  return [...agents].sort((a, b) => rank[agentState(a.status)] - rank[agentState(b.status)] || b.firstSeen - a.firstSeen)
}

function needsYou(b: OpsBoard): { prs: OpsPr[]; agents: OpsAgent[] } {
  return {
    prs: b.prs.filter(p => p.verdict === 'conflict' || p.verdict === 'changes-requested'),
    agents: b.agents.filter(a => agentState(a.status) === 'failed'),
  }
}

function agentAge(a: OpsAgent, now: number): string {
  return a.endedAt !== undefined ? `ran ${age(a.endedAt - a.firstSeen)}, ended ${age(now - a.endedAt)} ago` : age(now - a.firstSeen)
}

export function summary(b: OpsBoard, now: number): string {
  const lines: string[] = []
  const { running } = counts(b)
  const agents = sortedAgents(b.agents)
  lines.push(`**Agents**: ${running} running, ${agents.length - running} ended`)
  for (const a of agents.filter(x => agentState(x.status) === 'running')) {
    lines.push(`- ${a.label} (${a.type}, ${a.model}) ${a.status}, ${agentAge(a, now)}`)
  }
  if (b.tasks.length > 0) {
    lines.push(`**Background tasks** (at last turn end, ${age(now - b.tasksAt)} ago): ${b.tasks.length}`)
    for (const t of b.tasks) lines.push(`- ${t.type} ${t.status}: ${clip(t.description, 80)}`)
  }
  if (b.prsAt === 0) {
    lines.push(`**PRs**: not loaded yet${b.prError ? ` (${b.prError})` : ''}`)
  } else {
    lines.push(`**PRs** (${b.prs.length} open, read ${age(now - b.prsAt)} ago${b.prError ? `; ${b.prError}` : ''})`)
    for (const v of VERDICT_ORDER) {
      const group = b.prs.filter(p => p.verdict === v)
      if (group.length === 0) continue
      lines.push(`- ${v}: ${group.map(p => `[${p.repo.split('/')[1]}#${p.number}](${p.url})`).join(', ')}`)
    }
  }
  const need = needsYou(b)
  if (need.prs.length + need.agents.length === 0) {
    lines.push('**Needs you**: nothing')
  } else {
    lines.push('**Needs you**')
    for (const p of need.prs) lines.push(`- ${p.verdict}: [${p.repo}#${p.number}](${p.url}) ${p.title}`)
    for (const a of need.agents) lines.push(`- agent ${a.status}: ${a.label} (${a.type})`)
  }
  return lines.join('\n')
}

const VERDICT_COLOR: Record<OpsVerdict, 'error' | 'warning' | 'success' | 'inactive' | 'text'> = {
  red: 'error',
  conflict: 'error',
  'changes-requested': 'warning',
  pending: 'warning',
  green: 'success',
  unknown: 'inactive',
  old: 'inactive',
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // /status and /doctor are Claude Code's own names: $.command.register refuses them.
    await $.command
      .register({ name: 'ops-status', description: 'Ops board summary: agents, background tasks, your PRs, what needs you' })
      .catch(() => undefined)
    await $.command.register({ name: 'ops', description: 'Open the Ops board pane' }).catch(() => undefined)
    try {
      $.clock.every(AGENTS_EVERY_MS, () => {
        void refreshAgents($).then(() => pushStatus($))
      })
      $.clock.every(PR_EVERY_MS, () => {
        void refreshPrs($, false)
      })
      $.clock.after(1500, () => {
        void refreshAgents($).then(() => refreshPrs($, false))
      })
    } catch {
      // The board stays empty; /ops-status says so.
    }
    return next(e)
  })

  on('command.run', { command: 'ops-status' }, async $ => {
    try {
      await refreshAgents($)
      if ((await read($, board)).prsAt === 0) await refreshPrs($, false)
      await pushStatus($)
      return { text: summary(await read($, board), await $.clock.now()) }
    } catch (err) {
      return { text: `ops-board: could not read the status (${err instanceof Error ? err.message : String(err)}).` }
    }
  })

  on('command.run', { command: 'ops' }, async $ => {
    try {
      const opened = await $.ui.open({ id: PANE, title: TITLE })
      void refreshAgents($)
      return { text: opened.isPlaced ? 'Ops board opened.' : `Ops board waits to be placed: ${opened.reason}` }
    } catch (err) {
      return { text: `ops-board: could not open the pane (${err instanceof Error ? err.message : String(err)}).` }
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    try {
      if (ran.deny === undefined && ran.agentId !== undefined) {
        const id = ran.agentId
        const now = await $.clock.now()
        await update($, board, b => ({ ...b, spawned: { ...b.spawned, [id]: { model: ran.model, startedAt: now } } }))
        void refreshAgents($)
      }
    } catch {
      // The agent is still listed, without its model.
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('classic.Stop', async ($, e, next) => {
    try {
      const tasks: OpsTask[] = (e.background_tasks ?? []).map(t => ({
        id: t.id,
        type: t.type,
        status: t.status,
        description: t.command ?? t.description,
      }))
      const now = await $.clock.now()
      await update($, board, b => ({ ...b, tasks, tasksAt: now }))
    } catch {
      // The last snapshot stands.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const b = await read($, board)
    const now = await $.clock.now()
    const width = Math.max(20, e.props.bodyColumns)
    const agents = sortedAgents(b.agents)
    const need = needsYou(b)
    const copy = (url: string, surface: typeof e.surface) => {
      void $.ui.copy({ text: url, surface }).then(r => $.ui.toast(r.isCopied ? `Copied ${url}` : `Not copied: ${r.reason}`))
    }
    const prHead =
      b.prsAt === 0
        ? 'not loaded'
        : `${b.prs.length} open · read ${age(now - b.prsAt)} ago · ${b.ghCalls} gh calls`
    const backoff = now < b.backoffUntil ? ` · backoff ${age(b.backoffUntil - now)}` : ''

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>{clip(`${statusLine(b)}${b.isRefreshing ? ' · refreshing' : ''} `, width - 12)}</Text>
          <Button
            key="refresh"
            label="Refresh"
            onPress={() => {
              void refreshAgents($).then(() => refreshPrs($, true))
            }}
          />
        </Box>

        <Text bold>Needs you</Text>
        {need.prs.length + need.agents.length === 0 && <Text dimColor>nothing</Text>}
        {need.prs.map(p => (
          <Button key={`need:${p.repo}#${p.number}`} plain onPress={press => copy(p.url, press.surface)}>
            <Text color={VERDICT_COLOR[p.verdict]}>{p.verdict}</Text> {clip(`${p.repo.split('/')[1]}#${p.number} ${p.title}`, width - p.verdict.length - 2)}
          </Button>
        ))}
        {need.agents.map(a => (
          <Text color="error">
            {clip(`agent ${a.status}: ${a.label} (${a.type})`, width)}
          </Text>
        ))}

        <Text bold>Agents</Text>
        {agents.length === 0 && <Text dimColor>none</Text>}
        {agents.map(a => (
          <Text dimColor={agentState(a.status) === 'done'} color={agentState(a.status) === 'failed' ? 'error' : undefined}>
            {clip(`${agentState(a.status).padEnd(7)} ${a.label} · ${a.type} · ${a.model} · ${agentAge(a, now)}`, width)}
          </Text>
        ))}

        <Text bold>Background tasks</Text>
        {b.tasksAt === 0 && <Text dimColor>none seen yet (read at each turn end)</Text>}
        {b.tasksAt !== 0 && b.tasks.length === 0 && <Text dimColor>none at last turn end ({age(now - b.tasksAt)} ago)</Text>}
        {b.tasks.map(t => (
          <Text >{clip(`${t.status.padEnd(8)} ${t.type} · ${t.description}`, width)}</Text>
        ))}

        <Text bold>My PRs</Text>
        <Text dimColor>{clip(`${prHead}${backoff}`, width)}</Text>
        {b.prError !== '' && <Text color="warning">{clip(b.prError, width)}</Text>}
        {b.prs.map(p => (
          <Box key={`prrow:${p.repo}#${p.number}`} flexDirection="row">
            <Button key={`pr:${p.repo}#${p.number}`} plain onPress={press => copy(p.url, press.surface)}>
              <Text color={VERDICT_COLOR[p.verdict]}>{p.verdict.padEnd(8)}</Text> {clip(`${p.repo.split('/')[1]}#${p.number} ${p.title}`, width - 16)}
            </Button>
            <Text> </Text>
            <Link href={p.url} label="open" />
          </Box>
        ))}
        <Text dimColor>Press a PR row to copy its link.</Text>
      </Box>
    )
  })
}
