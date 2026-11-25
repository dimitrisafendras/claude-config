import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Board, Call, Said, Flow, FlowNode, Involvement, Peer, PeerAgent, Step, Ticket, View, Worker } from '../types'

const PANE = 'flow-view'
const MAIN = 'main'
const EMPTY: Flow = { steps: [], nodes: [], calls: [], tools: {}, turns: 0, started: [] }
const DAY = 24 * 60 * 60 * 1000
const QUIET = 60 * 1000
const DEMO_KEEP = 5 * 60 * 1000
const MAX_STEPS = 20
const MAX_CALLS = 200
const MAX_ROWS = 60
const MAX_STARTED = 12
const MAX_PEERS = 12
const MAX_LIST = 14
const MAX_AGENTS = 24

const flow = atom({ plugin: 'flow-view', key: 'flow' } as const, EMPTY, {
  shape: 'flow-2',
})
const view = atom(
  { plugin: 'flow-view', key: 'view' } as const,
  { tab: 'tickets', filter: 'all', session: '', ticket: '', live: false } as View,
  { shape: 'view-6' },
)
const typed = atom({ plugin: 'flow-view', key: 'typed' } as const, [] as Said[], { shape: 'typed-1' })
const board = atom(
  { plugin: 'flow-view', key: 'board' } as const,
  { id: '', phase: '', needsYou: [], rows: [], workers: [], updatedAt: 0 } as Board,
  { shape: 'board-1' },
)
const peers = atom({ plugin: 'flow-view', key: 'peers' } as const, [] as Peer[], {
  shape: 'peers-2',
})

// ---------- state changes (pure) ----------

function ensure(f: Flow, id: string, at: number): Flow {
  if (f.nodes.some(n => n.id === id)) return f
  const node: FlowNode = {
    id,
    label: id === MAIN ? 'Main loop' : `Agent ${id.slice(0, 6)}`,
    kind: id === MAIN ? 'main' : 'agent',
    status: id === MAIN ? 'idle' : 'running',
    startedAt: at,
    calls: 0,
    errors: 0,
  }

  return { ...f, nodes: [...f.nodes, node] }
}

function patch(f: Flow, id: string, fn: (n: FlowNode) => FlowNode): Flow {
  return { ...f, nodes: f.nodes.map(n => (n.id === id ? fn(n) : n)) }
}

function isStatus(s: unknown): s is Step['status'] {
  return s === 'pending' || s === 'in_progress' || s === 'completed'
}

export function toSteps(list: unknown[]): Step[] {
  const steps: Step[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const one = item as Record<string, unknown>
    if (typeof one.content !== 'string') continue
    steps.push({
      content: one.content,
      status: isStatus(one.status) ? one.status : 'pending',
    })
  }

  return steps.slice(0, MAX_STEPS)
}

export function plan(steps: Step[], tool: string, args: Record<string, unknown>): Step[] {
  if (tool === 'TodoWrite' && Array.isArray(args.todos)) return toSteps(args.todos)
  if (tool.endsWith('__wrap_up')) {
    return steps.map(s => ({ ...s, status: 'completed' as const }))
  }
  if (!tool.endsWith('__update_plan')) return steps
  if (Array.isArray(args.items)) return toSteps(args.items)
  let out = steps.map(s => ({ ...s }))
  if (Array.isArray(args.done)) {
    for (const n of args.done) {
      const s = typeof n === 'number' ? out[n - 1] : undefined
      if (s) s.status = 'completed'
    }
  }
  if (args.advance === true) {
    out = out.map(s =>
      s.status === 'in_progress' ? { ...s, status: 'completed' as const } : s,
    )
    const following = out.find(s => s.status === 'pending')
    if (following) following.status = 'in_progress'
  }
  if (typeof args.start === 'number') {
    const s = out[args.start - 1]
    if (s) s.status = 'in_progress'
  }

  return out
}

// A step keeps the time it started and the time it ended, as a CI job does.
export function stamp(before: Step[], after: Step[], at: number): Step[] {
  return after.map((s, i) => {
    const old = before[i]?.content === s.content ? before[i] : before.find(b => b.content === s.content)
    const startedAt = s.startedAt ?? old?.startedAt ?? (s.status === 'pending' ? undefined : at)
    const endedAt = s.status === 'completed' ? (s.endedAt ?? old?.endedAt ?? at) : undefined

    return clean({ ...s, startedAt, endedAt })
  })
}

function begin(f: Flow, call: Call, raw: string, args: Record<string, unknown>): Flow {
  const g = patch(ensure(f, call.agent, call.startedAt), call.agent, n => ({
    ...n,
    calls: n.calls + 1,
    lastTool: call.tool,
  }))

  return {
    ...g,
    steps: call.agent === MAIN ? stamp(g.steps, plan(g.steps, raw, args), call.startedAt) : g.steps,
    started:
      raw.endsWith('__start_session') && typeof args.title === 'string'
        ? [...g.started, clip(args.title, 60)].slice(-MAX_STARTED)
        : g.started,
    calls: [...g.calls, call].slice(-MAX_CALLS),
    tools: capTools({ ...g.tools, [call.tool]: (g.tools[call.tool] ?? 0) + 1 }),
  }
}

const MAX_TOOLS = 40

/** The count of each tool, cut to the tools that were used most. */
export function capTools(tools: Record<string, number>): Record<string, number> {
  const list = Object.entries(tools)
  if (list.length <= MAX_TOOLS) return tools

  return Object.fromEntries(list.sort((a, b) => b[1] - a[1]).slice(0, MAX_TOOLS))
}

function finish(f: Flow, id: string, at: number, isError: boolean): Flow {
  const call = f.calls.find(c => c.id === id)
  const g = {
    ...f,
    calls: f.calls.map(c => (c.id === id ? { ...c, endedAt: at, isError } : c)),
  }

  return call && isError
    ? patch(g, call.agent, n => ({ ...n, errors: n.errors + 1 }))
    : g
}

// ---------- the agent tree and the shared view of all sessions ----------

export function tree(nodes: FlowNode[]): { node: FlowNode; depth: number }[] {
  const agents = nodes.filter(n => n.id !== MAIN)
  const ids = new Set(agents.map(n => n.id))
  const out: { node: FlowNode; depth: number }[] = []
  const walk = (parent: string | undefined, depth: number) => {
    for (const n of agents) {
      const up = n.parent !== undefined && ids.has(n.parent) ? n.parent : undefined
      if (up !== parent || depth > 6) continue
      out.push({ node: n, depth })
      walk(n.id, depth + 1)
    }
  }
  walk(undefined, 0)

  return out
}

export function toPeer(f: Flow, id: string, cwd: string, at: number): Peer {
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
  const current = f.steps.find(s => s.status === 'in_progress')
  const peer: Peer = {
    id,
    title: f.title ?? folder,
    folder,
    status: f.nodes.find(n => n.id === MAIN)?.status ?? 'idle',
    startedAt: f.since ?? at,
    updatedAt: at,
    stepsDone: f.steps.filter(s => s.status === 'completed').length,
    stepsTotal: f.steps.length,
    steps: f.steps.map(s => ({ ...s, content: clip(s.content, 80) })),
    agents: tree(f.nodes)
      .slice(-MAX_AGENTS)
      .map(({ node, depth }) => ({
        label: clip(node.label, 40),
        kind: node.kind,
        status: node.status,
        depth,
      })),
    calls: f.nodes.reduce((sum, n) => sum + n.calls, 0),
    started: f.started,
  }
  if (current) peer.step = clip(current.content, 60)

  return peer
}

/** Running sessions first, then this one, then the newest. */
export function sortPeers(list: Peer[], me: string): Peer[] {
  const rank = (p: Peer) => (p.status === 'running' ? 0 : p.id === me ? 1 : 2)

  return [...list].sort((a, b) => rank(a) - rank(b) || b.startedAt - a.startedAt)
}

/** How many agents of a session failed. */
export function failedAgents(p: Peer): number {
  return p.agents.filter(a => a.status === 'failed').length
}

export function isPeer(v: unknown): v is Peer {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>

  return (
    typeof p.id === 'string' &&
    typeof p.title === 'string' &&
    typeof p.folder === 'string' &&
    typeof p.status === 'string' &&
    p.status in HUE &&
    typeof p.startedAt === 'number' &&
    typeof p.updatedAt === 'number' &&
    typeof p.stepsDone === 'number' &&
    typeof p.stepsTotal === 'number' &&
    typeof p.calls === 'number' &&
    Array.isArray(p.agents) &&
    Array.isArray(p.steps) &&
    Array.isArray(p.started)
  )
}

// The module's own variables start again at a reload: they only limit the rate.
let lastPublish = 0
let seen = ''

/** A store that fails must not break a turn: the pane is a view only. */
async function publish($: EngineInterface): Promise<void> {
  try {
    const at = await $.clock.now()
    lastPublish = at
    const f = await read($, flow)
    const id = await $.session.id()
    await $.store.set(`s:${id}`, toPeer(f, id, await $.session.cwd(), at))
  } catch {
    // The next turn publishes again.
  }
}

let isRefreshing = false

async function refresh($: EngineInterface): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true
  try {
    await refreshNow($)
  } catch {
    // The timer calls this again in three seconds.
  } finally {
    isRefreshing = false
  }
}

async function safeGet($: EngineInterface, key: string): Promise<unknown> {
  try {
    return await $.store.get(key)
  } catch {
    return undefined
  }
}

async function refreshNow($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const mine = await read($, flow)
  const isLive = mine.nodes.some(n => n.status === 'running')
  if (isLive && now - lastPublish > 15000) await publish($)
  const list: Peer[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith('s:')) continue
    const v = await safeGet($, key)
    if (!isPeer(v)) continue
    // A demo that a reload left behind is removed after five minutes.
    if (now - v.updatedAt > (key.startsWith('s:demo-') ? DEMO_KEEP : DAY)) {
      await $.store.delete(key)
      continue
    }
    // A session that stopped without a last word is shown as idle.
    const quiet = v.status === 'running' && now - v.updatedAt > QUIET
    list.push(
      quiet
        ? {
            ...v,
            status: 'idle',
            agents: v.agents.map(a =>
              a.status === 'running' ? { ...a, status: 'idle' as const } : a,
            ),
          }
        : v,
    )
  }
  list.sort((a, b) => b.startedAt - a.startedAt)
  // The newest day of /start-work. A day older than three days is removed.
  let day: Board | undefined
  for (const key of await $.store.keys()) {
    if (!key.startsWith('day:')) continue
    const v = await safeGet($, key)
    // The demo day goes with the demo sessions; a real day is kept three days.
    if (!isBoard(v) || now - v.updatedAt > (key === 'day:demo' ? DEMO_KEEP : 3 * DAY)) {
      await $.store.delete(key)
      continue
    }
    if (!day || v.updatedAt > day.updatedAt) day = v
  }
  const shown: Board = day ?? { id: '', phase: '', needsYou: [], rows: [], workers: [], updatedAt: 0 }
  const sig = JSON.stringify([list.map(p => ({ ...p, updatedAt: 0 })), { ...shown, updatedAt: 0 }])
  if (sig === seen) return
  seen = sig
  await update($, peers, () => list)
  await update($, board, () => shown)
}

// State is JSON data: this removes the fields that are undefined.
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// The agents of another session, as nodes that the run graph can draw.
function peerNodes(p: Peer): FlowNode[] {
  const out: FlowNode[] = [
    { id: MAIN, label: 'Session', kind: 'main', status: p.status, startedAt: p.startedAt, calls: p.calls, errors: 0 },
  ]
  const stack: string[] = []
  p.agents.forEach((a, i) => {
    const id = `p${i}`
    stack.length = a.depth
    const parent = a.depth > 0 ? stack[a.depth - 1] : undefined
    stack[a.depth] = id
    out.push(clean({ id, label: a.label, kind: a.kind, status: a.status, startedAt: 0, calls: 0, errors: 0, parent }))
  })

  return out
}

// ---------- the demo: sample sessions that move, to try the pane ----------

type DemoAgent = [label: string, kind: string, depth: number, start: number, length: number, fails: boolean]
// One day of /start-work: a coordinator, a lane session for each lane of
// the demo plan (DEMO_ROWS), and a cleanup session. The times agree with
// the stages of the demo tickets.
const DEMO: { title: string; folder: string; from: number; pace: number; steps: string[]; agents: DemoAgent[]; started: string[] }[] = [
  {
    title: 'Demo: start work (coordinator)',
    folder: 'projects',
    from: 0,
    pace: 4,
    steps: ['Housekeeping', 'Collect the inbox', 'Rank the plan', 'Start the lanes', 'Close the day'],
    agents: [
      ['Cleanup dry run', 'general-purpose', 0, 0, 3, false],
      ['Lane: web-app · web', 'session', 0, 4, 11, false],
      ['Lane: api · backend', 'session', 0, 8, 12, false],
    ],
    started: ['Demo: lane web-app · web', 'Demo: lane api · backend'],
  },
  {
    title: 'Demo: lane web-app · web',
    folder: 'web-app',
    from: 4,
    pace: 3,
    steps: ['#1 Fix the refresh call', '#1 Add the tests', '#2 Fix the unit tests', 'Review the branches', 'Open the PRs and get CI green'],
    agents: [
      ['Fix the refresh call', 'general-purpose', 0, 4, 4, false],
      ['Add the tests', 'general-purpose', 0, 5, 4, false],
      ['Fix the unit tests', 'general-purpose', 0, 4, 4, false],
      ['Review the branch', 'pr-reviewer', 0, 8, 2, false],
      ['Check the tests', 'Explore', 1, 8, 2, false],
    ],
    started: [],
  },
  {
    title: 'Demo: lane api · backend',
    folder: 'api',
    from: 8,
    pace: 3,
    steps: ['#3 CSV writer', '#3 Export endpoint', '#3 Review the branch', '#4 Rate limit the search'],
    agents: [
      ['CSV writer', 'general-purpose', 0, 8, 6, false],
      ['Export endpoint', 'general-purpose', 0, 9, 7, false],
      ['Review the branch', 'pr-reviewer', 0, 16, 2, false],
      ['Rate limit rule', 'general-purpose', 0, 13, 6, true],
    ],
    started: [],
  },
  {
    title: 'Demo: cleanup',
    folder: 'projects',
    from: 0,
    pace: 1,
    steps: ['Dry run', 'Remove merged worktrees', 'Archive idle sessions'],
    agents: [['List the worktrees', 'Explore', 0, 0, 2, false]],
    started: [],
  },
]
const DEMO_END = 22
const DEMO_MS = 2000

export function demoPeers(tick: number, start: number): Peer[] {
  return DEMO.map((d, i) => {
    const steps: Step[] = d.steps.map((content, k) => {
      const from = d.from + k * d.pace
      const to = d.from + (k + 1) * d.pace
      const status = tick >= to ? 'completed' : tick >= from ? 'in_progress' : 'pending'

      return clean({
        content,
        status,
        startedAt: status === 'pending' ? undefined : start + from * DEMO_MS,
        endedAt: status === 'completed' ? start + to * DEMO_MS : undefined,
      } as Step)
    })
    const agents: PeerAgent[] = d.agents.map(([label, kind, depth, from, length, fails]) => ({
      label,
      kind,
      depth,
      status: tick < from ? 'idle' : tick < from + length ? 'running' : fails ? 'failed' : 'completed',
    }))
    const isDone = steps.every(s => s.status === 'completed')
    const current = steps.find(s => s.status === 'in_progress')
    const peer: Peer = {
      id: `demo-${i}`,
      title: d.title,
      folder: d.folder,
      status: tick < d.from ? 'idle' : !isDone ? 'running' : agents.some(a => a.status === 'failed') ? 'failed' : 'completed',
      startedAt: start - i,
      updatedAt: start + tick * DEMO_MS,
      stepsDone: steps.filter(s => s.status === 'completed').length,
      stepsTotal: steps.length,
      steps,
      agents,
      calls: Math.max(0, Math.min(tick - d.from, d.steps.length * d.pace)) * (3 + i),
      started: tick >= 4 ? d.started : [],
    }
    if (current) peer.step = current.content

    return peer
  })
}

let demoTimer: Timer | undefined

async function toggleDemo($: EngineInterface): Promise<string> {
  const old = (await $.store.keys()).filter(k => k.startsWith('s:demo-'))
  if (demoTimer !== undefined || old.length > 0) {
    demoTimer?.cancel()
    demoTimer = undefined
    for (const key of old) await $.store.delete(key)
    await $.store.delete('day:demo')
    await refresh($)

    return 'Demo stopped. The sample sessions are removed.'
  }
  const start = await $.clock.now()
  let tick = 0
  const write = async () => {
    for (const p of demoPeers(tick, start)) await $.store.set(`s:${p.id}`, p)
    await $.store.set('day:demo', demoBoard(tick, start))
    await refresh($)
  }
  await write()
  await update($, view, w => ({ ...w, tab: 'tickets' as const, filter: 'all' as const, session: '', ticket: 'r01' }))
  demoTimer = $.clock.every(DEMO_MS, async () => {
    tick += 1
    await write()
    if (tick >= DEMO_END) {
      demoTimer?.cancel()
      demoTimer = undefined
    }
  })

  return 'Demo started: a sample day of /start-work runs for 45 seconds, with six tickets, one coordinator session, two lane sessions and one cleanup session. Run /flow demo again, or /flow clear, to remove them.'
}

// ---------- text helpers ----------

export function short(tool: string): string {
  const parts = tool.split('__')

  return parts.length > 2 ? parts.slice(2).join('__') : tool
}

export function clip(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  if (n < 2) return flat.slice(0, Math.max(0, n))

  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat
}

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ---------- time of the person (pure) ----------

const NO_PART: Involvement = { mine: 0, mineMs: 0, waitMs: 0, busyMs: 0 }
/** The least and the most that one message of the person counts as their time. */
export const MIN_ATTENTION_MS = 30_000
export const MAX_ATTENTION_MS = 300_000
/** Prompts that a person typed: in the app, or from another device. */
const TYPED = new Set(['composer', 'bridge'])

/** True when a person wrote this prompt. A notice, a mod or another session starts the other turns. */
export function isTyped(e: { text: string; command?: unknown; isMeta?: true; origin?: { kind: string } }): boolean {
  if (e.command !== undefined || e.isMeta === true) return false
  if (e.origin !== undefined && !TYPED.has(e.origin.kind)) return false
  const text = e.text.trim()

  return text !== '' && !text.startsWith('<')
}

/**
 * One message of the person at `at`. The work waited for them from the end of the last turn. Their own time is
 * that wait, but not less than 30 seconds (to read and to write) and not more than 5 minutes (a longer wait is
 * time away, not time on this work).
 */
export function said(m: Involvement | undefined, at: number): Involvement {
  const p = m ?? NO_PART
  const wait = p.idleSince === undefined ? 0 : Math.max(0, at - p.idleSince)

  return {
    ...p,
    mine: p.mine + 1,
    waitMs: p.waitMs + wait,
    mineMs: p.mineMs + Math.min(MAX_ATTENTION_MS, Math.max(MIN_ATTENTION_MS, wait)),
    // One wait is counted one time: a second message before the turn starts adds only the least time.
    idleSince: p.idleSince === undefined ? undefined : at,
  }
}

/** The main turn started (`endedAt` undefined) or ended after `ranMs`. */
export function turned(m: Involvement | undefined, endedAt?: number, ranMs = 0): Involvement {
  const { idleSince: _, ...p } = m ?? NO_PART

  return endedAt === undefined ? p : { ...p, busyMs: p.busyMs + Math.max(0, ranMs), idleSince: endedAt }
}

export type TimeFacts = { totalMs: number; busyMs: number; mineMs: number; waitMs: number; mine: number; auto: number; share: number }

/** The numbers of the Time section. `share` is the part of the total time that was the person's, from 0 to 100. */
export function timeFacts(f: Pick<Flow, 'since' | 'turns' | 'me' | 'nodes'>, now: number): TimeFacts | undefined {
  if (f.since === undefined) return undefined
  const p = f.me ?? NO_PART
  const main = f.nodes.find(n => n.id === MAIN)
  const live = main !== undefined && main.status === 'running' ? Math.max(0, now - main.startedAt) : 0
  const totalMs = Math.max(0, now - f.since)
  const mineMs = Math.min(p.mineMs, totalMs)

  return {
    totalMs,
    busyMs: Math.min(totalMs, p.busyMs + live),
    mineMs,
    waitMs: Math.min(p.waitMs, totalMs),
    mine: p.mine,
    auto: Math.max(0, f.turns - p.mine),
    share: totalMs > 0 ? Math.round((mineMs / totalMs) * 100) : 0,
  }
}

/** The Time section in two lines of text. */
export function timeLines(t: TimeFacts): [string, string] {
  return [
    `Total ${span(t.totalMs)} · Claude worked ${span(t.busyMs)} · ${plural(t.auto, 'turn')} started with no message of yours`,
    `You: ${plural(t.mine, 'message')} · about ${span(t.mineMs)} of your time (${t.share}%) · the work waited ${span(t.waitMs)} for you`,
  ]
}

export function span(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return `${Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0))}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`

  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** How long ago, in one short unit. */
export function ago(ms: number): string {
  if (!Number.isFinite(ms) || ms < 45_000) return 'just now'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`

  return `${Math.round(h / 24)}d ago`
}

/** `1 agent`, `2 agents`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function took(n: { startedAt: number; endedAt?: number }): string {
  return n.endedAt === undefined ? 'runs' : span(n.endedAt - n.startedAt)
}

const MARK = {
  idle: '○',
  running: '◉',
  completed: '●',
  failed: '✗',
  stopped: '■',
  pending: '○',
  in_progress: '◉',
} as const

const HUE = {
  idle: '#5b6470',
  running: '#22d3ee',
  completed: '#2bd98a',
  failed: '#ff4d5e',
  stopped: '#fbbf24',
} as const

// ---------- the animated drawing ----------
// The drawing has no ground of its own: dark cards with a border that glows
// and neon icons, on the ground of the pane.

const W = 460
const INK = '#e6e8eb'
const DIM = '#8b949e'
const CARD = '#25282c'
const EDGE = '#3a3f45'
/** A status icon as a pipeline shows it: a check, a cross, a ring that turns. */
function icon(status: FlowNode['status'], cx: number, cy: number, tint?: string): string {
  const hue = tint ?? HUE[status]
  if (status === 'completed') {
    return (
      `<circle cx="${cx}" cy="${cy}" r="7" fill="${hue}" filter="url(#glow)"/>` +
      `<path d="M${cx - 3.5} ${cy} l2.5 2.5 l4.5 -5" fill="none" stroke="#0d2a1c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    )
  }
  if (status === 'failed') {
    return (
      `<circle cx="${cx}" cy="${cy}" r="7" fill="${hue}" filter="url(#glow)"/>` +
      `<path d="M${cx - 2.8} ${cy - 2.8} l5.6 5.6 M${cx + 2.8} ${cy - 2.8} l-5.6 5.6" stroke="#2c0b10" stroke-width="2" stroke-linecap="round"/>`
    )
  }
  if (status === 'running') {
    return (
      `<circle cx="${cx}" cy="${cy}" r="6" fill="none" stroke="${hue}" stroke-opacity="0.25" stroke-width="2"/>` +
      `<path d="M${cx} ${cy - 6} a6 6 0 0 1 6 6" fill="none" stroke="${hue}" stroke-width="2.2" stroke-linecap="round" filter="url(#glow)">` +
      `<animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="1s" repeatCount="indefinite"/></path>` +
      `<circle cx="${cx}" cy="${cy}" r="2.2" fill="${hue}"/>`
    )
  }
  if (status === 'stopped') {
    return (
      `<circle cx="${cx}" cy="${cy}" r="6" fill="none" stroke="${hue}" stroke-width="1.6"/>` +
      `<rect x="${cx - 2.5}" y="${cy - 2.5}" width="5" height="5" rx="1" fill="${hue}"/>`
    )
  }

  return `<circle cx="${cx}" cy="${cy}" r="6" fill="none" stroke="${hue}" stroke-width="1.6"/>`
}

/** A neon icon for the kind of a node: a robot, a lens, lines, code or a star. */
function glyph(kind: string, cx: number, cy: number): string {
  const k = kind.toLowerCase()
  const open = (hue: string) =>
    `<g fill="none" stroke="${hue}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)">`
  if (k === 'main') {
    return (
      open('#22d3ee') +
      `<rect x="${cx - 7}" y="${cy - 4}" width="14" height="11" rx="4"/>` +
      `<path d="M${cx} ${cy - 4} v-3"/><circle cx="${cx}" cy="${cy - 8.5}" r="1.2"/>` +
      `<path d="M${cx - 3} ${cy + 1} v1.5 M${cx + 3} ${cy + 1} v1.5"/></g>`
    )
  }
  if (k === 'ticket') {
    return open('#fbbf24') + `<path d="M${cx - 7} ${cy - 5} h14 v3 a2 2 0 0 0 0 4 v3 h-14 v-3 a2 2 0 0 0 0 -4 z M${cx + 2} ${cy - 5} v10"/></g>`
  }
  if (k === 'pr') {
    return (
      open('#2bd98a') +
      `<circle cx="${cx - 4}" cy="${cy - 5}" r="2"/><circle cx="${cx - 4}" cy="${cy + 5}" r="2"/><circle cx="${cx + 4}" cy="${cy + 5}" r="2"/>` +
      `<path d="M${cx - 4} ${cy - 3} v6 M${cx + 4} ${cy + 3} v-4 q0 -3 -3 -3 h-1"/></g>`
    )
  }
  if (k === 'session') {
    return open('#22d3ee') + `<rect x="${cx - 7}" y="${cy - 6}" width="14" height="11" rx="2.5"/><path d="M${cx - 3} ${cy + 8} h6 M${cx - 4} ${cy - 2} l2.5 2 l-2.5 2"/></g>`
  }
  if (k.includes('explore') || k.includes('search')) {
    return open('#38bdf8') + `<circle cx="${cx - 1.5}" cy="${cy - 1.5}" r="5"/><path d="M${cx + 2.5} ${cy + 2.5} l4 4"/></g>`
  }
  if (k.includes('review')) {
    return open('#c084fc') + `<path d="M${cx - 6} ${cy - 5} h12 M${cx - 6} ${cy} h12 M${cx - 6} ${cy + 5} h8"/></g>`
  }
  if (k.includes('plan') || k.includes('architect')) {
    return (
      open('#fb923c') +
      `<path d="M${cx - 3} ${cy - 7} q-3 0 -3 3 v2 q0 2 -2 2 q2 0 2 2 v2 q0 3 3 3 M${cx + 3} ${cy - 7} q3 0 3 3 v2 q0 2 2 2 q-2 0 -2 2 v2 q0 3 -3 3"/></g>`
    )
  }
  if (k.includes('test') || k.includes('verify')) {
    return open('#2bd98a') + `<path d="M${cx - 6} ${cy} l4 4 l8 -9"/></g>`
  }
  if (k.includes('general') || k.includes('code') || k === 'fork') {
    return open('#38bdf8') + `<path d="M${cx - 4} ${cy - 5} l-4 5 l4 5 M${cx + 4} ${cy - 5} l4 5 l-4 5 M${cx + 1.5} ${cy - 6} l-3 12"/></g>`
  }

  return (
    open('#60a5fa') +
    `<path d="M${cx} ${cy - 7} q1 6 7 7 q-6 1 -7 7 q-1 -6 -7 -7 q6 -1 7 -7 z"/></g>`
  )
}

function heading(y: number, text: string, note: string): string {
  const w = text.length * 7.4 + 22

  return (
    `<g filter="url(#shadow)"><rect x="10" y="${y - 13}" width="${w}" height="20" rx="10" fill="#2b2f34"/></g>` +
    `<text x="${10 + w / 2}" y="${y + 1}" class="h" text-anchor="middle">${esc(text)}</text>` +
    `<text x="${W - 12}" y="${y + 1}" class="s" text-anchor="end">${esc(clip(note, 44))}</text>`
  )
}

function drawSteps(steps: Step[], top: number): { svg: string; bottom: number } {
  const done = steps.filter(s => s.status === 'completed').length
  const spent = steps.reduce((sum, s) => (s.startedAt !== undefined && s.endedAt !== undefined ? sum + (s.endedAt - s.startedAt) : sum), 0)
  let svg = heading(top + 14, 'STEPS', steps.length ? `${done} of ${steps.length} done${spent > 0 ? ` · ${span(spent)}` : ''}` : '')
  if (steps.length > 0) {
    svg +=
      `<rect x="12" y="${top + 26}" width="${W - 24}" height="3" rx="1.5" fill="${EDGE}"/>` +
      `<rect x="12" y="${top + 26}" width="${Math.round(((W - 24) * done) / steps.length)}" height="3" rx="1.5" fill="${HUE.completed}"/>`
  }
  let y = top + 44
  if (steps.length === 0) {
    svg += `<text x="14" y="${y}" class="s">No plan yet. A task list shows here.</text>`

    return { svg, bottom: y + 12 }
  }
  steps.forEach((s, i) => {
    if (i < steps.length - 1) {
      const lit = s.status === 'completed' ? HUE.completed : EDGE
      svg += `<line x1="22" y1="${y + 5}" x2="22" y2="${y + 15}" stroke="${lit}" stroke-width="2" stroke-linecap="round"/>`
    }
    svg += icon(s.status === 'in_progress' ? 'running' : s.status === 'completed' ? 'completed' : 'idle', 22, y - 4)
    const cls = s.status === 'in_progress' ? 'b' : s.status === 'completed' ? 't' : 's'
    const time =
      s.status === 'in_progress'
        ? 'in progress'
        : s.startedAt !== undefined && s.endedAt !== undefined
          ? span(s.endedAt - s.startedAt)
          : s.status === 'pending'
            ? 'queued'
            : ''
    svg +=
      `<text x="40" y="${y}" class="${cls}"${s.status === 'in_progress' ? ' fill="#22d3ee"' : ''}><title>${esc(s.content)}</title>${esc(clip(s.content, 52))}</text>` +
      `<text x="${W - 12}" y="${y}" class="s" text-anchor="end">${time}</text>`
    y += 26
  })

  return { svg, bottom: y - 8 }
}

export function tip(n: FlowNode): string {
  const lines = [
    `${n.label} (${n.kind})`,
    `Status: ${n.status}, ${took(n)}`,
    `Tool calls: ${n.calls}, errors: ${n.errors}`,
  ]
  if (n.lastTool) lines.push(`Last tool: ${n.lastTool}`)
  if (n.model) lines.push(`Model: ${n.model}`)
  if (n.prompt) lines.push(`Task: ${clip(n.prompt, 300)}`)

  return esc(lines.join('\n'))
}

function port(x: number, y: number, hue: string): string {
  return `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" rx="1.5" fill="${hue}" filter="url(#glow)"/>`
}

/** The color of a node: its status, but amber when it ended well with failed calls. */
export function nodeHue(n: FlowNode): string {
  return n.status === 'completed' && n.errors > 0 ? HUE.stopped : HUE[n.status]
}

/** A node of the run graph: a dark card with a border that glows in its status color. */
export function card(n: FlowNode, x: number, y: number, w: number, h: number, isPicked: boolean): string {
  const hue = nodeHue(n)
  const isLive = n.status === 'running'
  const errors = n.errors > 0 ? plural(n.errors, 'error') : ''
  const facts =
    n.kind === 'main'
      ? [plural(n.calls, 'tool call'), errors].filter(Boolean).join(' · ')
      : [
          n.kind,
          n.endedAt === undefined ? (isLive ? 'in progress' : n.status) : span(n.endedAt - n.startedAt),
          n.model,
          errors,
          isLive ? n.lastTool : undefined,
        ]
          .filter(Boolean)
          .join(' · ')
  const chars = Math.max(6, Math.floor((w - 62) / 6.2))
  const name = n.label.replace(/\s+/g, ' ').trim()

  return (
    `<g class="n"><title>${tip(n)}</title>` +
    `<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="13" fill="${CARD}"/></g>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="13" fill="none" stroke="${hue}" stroke-width="${isPicked ? 2.6 : 1.8}" filter="url(#glow)">` +
    (isLive ? `<animate attributeName="stroke-opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite"/>` : '') +
    `</rect>` +
    glyph(n.kind, x + 22, y + h / 2) +
    `<text x="${x + 42}" y="${y + h / 2 - 3}" class="b"${n.kind === 'main' ? ' fill="#22d3ee"' : ''}>${esc(clip(name, chars))}</text>` +
    `<text x="${x + 42}" y="${y + h / 2 + 11}" class="s">${esc(clip(facts, chars + 2))}</text>` +
    `<circle cx="${x + w - 16}" cy="${y + h / 2}" r="10" fill="#1c1e21"/>` +
    icon(n.status, x + w - 16, y + h / 2) +
    `</g>`
  )
}

function wire(d: string, hue: string, isLive: boolean, isDashed: boolean): string {
  if (isLive) {
    return (
      `<path d="${d}" fill="none" stroke="${hue}" stroke-width="2" stroke-dasharray="6 5" filter="url(#glow)">` +
      `<animate attributeName="stroke-dashoffset" from="22" to="0" dur="0.7s" repeatCount="indefinite"/></path>` +
      `<circle r="3.2" fill="#fff" filter="url(#glow)"><animateMotion dur="1.5s" repeatCount="indefinite" path="${d}"/></circle>`
    )
  }

  return `<path d="${d}" fill="none" stroke="${hue}" stroke-width="2" ${isDashed ? 'stroke-dasharray="4 5"' : ''} stroke-linecap="round" opacity="0.85"/>`
}

// The run graph, from the top down: the session or ticket at the top, each
// agent on a row below it, each subagent on an indented row below its
// agent. A row is as wide as the drawing, so a narrow pane shows full names.
function drawGraph(nodes: FlowNode[], picked: string, top: number, title = 'RUN GRAPH'): { svg: string; bottom: number } {
  const full = tree(nodes)
  const all = full.slice(-MAX_LIST)
  const live = all.filter(a => a.node.status === 'running').length
  const hidden = full.length - all.length
  let svg = heading(top + 14, title, all.length ? `${live} of ${all.length} run${hidden > 0 ? ` · +${hidden} earlier` : ''}` : '')
  const root: FlowNode = nodes.find(n => n.id === MAIN) ?? {
    id: MAIN,
    label: 'Main loop',
    kind: 'main',
    status: 'idle',
    startedAt: 0,
    calls: 0,
    errors: 0,
  }
  const H = 44
  const GAP = 12
  const STEP = 26
  const x0 = 12
  let y = top + 40
  let wires = ''
  let cards = card(root, x0, y, W - 24, H, picked === MAIN)
  // Where the line down from each node starts: below its icon.
  const stem = new Map<string, { x: number; y: number }>([[MAIN, { x: x0 + 22, y: y + H }]])
  y += H + GAP
  for (const { node, depth } of all) {
    const x = x0 + STEP * (Math.min(depth, 4) + 1)
    const cy = y + H / 2
    const hue = nodeHue(node)
    const from = stem.get(depth === 0 ? MAIN : (node.parent ?? MAIN)) ?? { x: x - STEP + 22, y: y - GAP }
    const d = `M${from.x} ${from.y} V${cy - 10} Q${from.x} ${cy} ${from.x + 10} ${cy} H${x}`
    wires += wire(d, hue, node.status === 'running', depth > 0) + port(x, cy, hue)
    cards += card(node, x, y, W - 12 - x, H, node.id === picked)
    stem.set(node.id, { x: x + 22, y: y + H })
    y += H + GAP
  }
  if (all.length === 0) {
    svg += `<text x="${x0 + STEP}" y="${y + 6}" class="s">No agents yet. They show here as they start.</text>`
    y += 18
  } else {
    wires = port(x0 + 22, top + 40 + H, HUE[root.status]) + wires
  }

  return { svg: svg + wires + cards, bottom: y - GAP + 10 }
}

/** One session, opened: its steps and its run graph. */
export function drawRun(p: Peer): Drawing {
  const a = drawSteps(p.steps, 4)
  const b = drawGraph(peerNodes(p), '', a.bottom + 12)

  return frame(a.svg + b.svg, b.bottom + 10)
}

type Drawing = { source: string; body: string; tall: number; units: number }

// The drawing is an image with a view box. At SCALE its text has the size
// of the text of the app. A surface can stretch an image to the width of
// the pane, so the render hook also gives each drawing its width.
const SCALE = 1.1

function frame(body: string, tall: number, units = W): Drawing {
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(units * SCALE)}" height="${Math.round(tall * SCALE)}" viewBox="0 0 ${units} ${tall}" font-family="ui-rounded, 'SF Pro Rounded', ui-sans-serif, system-ui, sans-serif">` +
    `<defs>` +
    `<filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<filter id="shadow" x="-30%" y="-30%" width="160%" height="190%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity="0.6"/></filter>` +
    `</defs>` +
    `<style>` +
    `text{font-size:11.5px;fill:${INK}}.h{font-size:9.5px;font-weight:800;letter-spacing:1.3px;fill:${INK}}` +
    `.b{font-weight:700}.s{fill:${DIM};font-size:10.5px}` +
    `</style>` +
    body +
    `</svg>`

  return { source, body, tall, units }
}

// ---------- the tickets: the plan of /start-work, read from its writes ----------
// The coordinator writes the day, its rows and its sessions to the Work
// Monitor with the ArtifactData tool. This mod reads those writes as they
// go by, and keeps a copy in its store for the panes of all sessions.

const BLANK: Board = { id: '', phase: '', needsYou: [], rows: [], workers: [], updatedAt: 0 }
const PHASES = ['housekeeping', 'inbox', 'plan', 'running', 'done']
const STAGES = ['queued', 'running', 'review', 'merged', 'verified']
const ROW_TEXT = ['title', 'url', 'source', 'repo', 'surface', 'size', 'model', 'state', 'branch', 'pr', 'ci', 'session', 'note'] as const
const WORKER_TEXT = ['name', 'kind', 'title', 'surface', 'model', 'state', 'branch'] as const

function hasId(v: unknown): boolean {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).id === 'string'
}

export function isBoard(v: unknown): v is Board {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Record<string, unknown>

  return (
    typeof b.id === 'string' &&
    typeof b.phase === 'string' &&
    typeof b.updatedAt === 'number' &&
    Array.isArray(b.needsYou) &&
    Array.isArray(b.rows) &&
    Array.isArray(b.workers) &&
    b.rows.every(hasId) &&
    b.workers.every(hasId)
  )
}

export function merge<T extends { id: string }>(list: T[], id: string, op: string, data: Record<string, unknown>, text: readonly string[], numbers: readonly string[]): T[] {
  if (op === 'delete') return list.filter(x => x.id !== id)
  const old = op === 'update' ? list.find(x => x.id === id) : undefined
  const out: Record<string, unknown> = { ...(old ?? {}), id }
  for (const key of text) {
    const v = data[key]
    if (typeof v === 'string') out[key] = clip(v, 160)
    else if (typeof v === 'number') out[key] = String(v)
  }
  for (const key of numbers) {
    const v = data[key]
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
  }

  return [...list.filter(x => x.id !== id), out as T]
}

type Write = { op: string; collection: string; doc_id: string; data: Record<string, unknown> }

async function toWrites($: EngineInterface, args: Record<string, unknown>): Promise<Write[]> {
  const raw: unknown[] =
    args.action === 'batch' && Array.isArray(args.writes)
      ? args.writes
      : args.action === 'set' || args.action === 'update' || args.action === 'delete'
        ? [{ op: args.action, collection: args.collection, doc_id: args.doc_id, data: args.data, file_path: args.file_path }]
        : []
  const out: Write[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const w = item as Record<string, unknown>
    if (typeof w.op !== 'string' || typeof w.collection !== 'string' || typeof w.doc_id !== 'string') continue
    if (w.doc_id.length > 80 || w.doc_id === '') continue
    let data: unknown = w.data
    if (data === undefined && typeof w.file_path === 'string') {
      try {
        data = JSON.parse(String(await $.fs.read(w.file_path)))
      } catch {
        data = undefined
      }
    }
    out.push({
      op: w.op,
      collection: w.collection,
      doc_id: w.doc_id,
      data: typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {},
    })
  }

  return out
}

function apply(b: Board, w: Write, at: number): Board {
  const parts = w.collection.split('/')
  if (parts.length === 1) {
    const d = w.data
    const base = w.op === 'set' ? { ...BLANK, id: b.id, rows: b.rows, workers: b.workers } : b

    return clean({
      ...base,
      phase: typeof d.phase === 'string' ? clip(d.phase, 24) : base.phase,
      headline: typeof d.headline === 'string' ? clip(d.headline, 200) : base.headline,
      needsYou: Array.isArray(d.needsYou)
        ? d.needsYou.filter((x): x is string => typeof x === 'string').map(x => clip(x, 160)).slice(0, 12)
        : base.needsYou,
      updatedAt: at,
    })
  }
  if (parts[2] === 'rows') {
    const old = b.rows.find(t => t.id === w.doc_id)
    const rows = merge<Ticket>(b.rows, w.doc_id, w.op, w.data, ROW_TEXT, ['n', 'sev', 'prNumber']).map(t => (t.id === w.doc_id ? timed(old, t, at) : t))

    return { ...b, rows: rows.slice(-MAX_ROWS), updatedAt: at }
  }
  if (parts[2] === 'sessions') {
    return { ...b, workers: merge<Worker>(b.workers, w.doc_id, w.op, w.data, WORKER_TEXT, []).slice(-MAX_ROWS), updatedAt: at }
  }

  return b
}

async function capture($: EngineInterface, args: Record<string, unknown>): Promise<void> {
  const writes = (await toWrites($, args)).filter(w => w.collection === 'days' || w.collection.startsWith('days/'))
  if (writes.length === 0) return
  const at = await $.clock.now()
  const boards = new Map<string, Board>()
  for (const w of writes) {
    const day = w.collection === 'days' ? w.doc_id : (w.collection.split('/')[1] ?? '')
    if (!day) continue
    let b = boards.get(day)
    if (!b) {
      const kept = await $.store.get(`day:${day}`)
      b = isBoard(kept) ? kept : { ...BLANK, id: day }
    }
    boards.set(day, apply(b, w, at))
  }
  for (const [day, b] of boards) await $.store.set(`day:${day}`, b)
  await refresh($)
}

/** One thing that the session did and that changes a ticket: a merged pull request or a status move on the ticket board. */
export type Fact = { pr: number; state: string } | { ticket: string; state: string }

const BOARD_STATES: Record<string, string> = {
  'in progress': 'running',
  blocked: 'blocked',
  'in review': 'review',
  'on staging': 'merged',
  done: 'merged',
  'in production': 'verified',
  closed: 'verified',
}

/** The facts in one finished tool call. The board must not wait for the coordinator to write them. */
export function facts(tool: string, args: Record<string, unknown>): Fact[] {
  const out: Fact[] = []
  if (tool === 'Bash' && typeof args.command === 'string') {
    for (const m of args.command.matchAll(/\bgh[ \t]+pr[ \t]+merge[ \t]+(?:https?:\/\/\S+\/pull\/)?(\d{1,7})\b/g)) {
      out.push({ pr: Number(m[1]), state: 'merged' })
    }
  }
  if (/update_task$/.test(tool) && typeof args.task_id === 'string' && typeof args.status === 'string') {
    const state = BOARD_STATES[args.status.trim().toLowerCase()]
    if (state !== undefined && /^[A-Za-z0-9-]{3,40}$/.test(args.task_id)) out.push({ ticket: args.task_id, state })
  }

  return out
}

const RANK = ['queued', 'running', 'review', 'merged', 'verified']

/** The board with one fact applied. A row never goes back from a later stage because of a fact, and "blocked" does not replace a merged row. */
export function applyFact(b: Board, f: Fact, at: number): Board {
  let hit = false
  const rows = b.rows.map(t => {
    const isMine = 'pr' in f ? t.prNumber === f.pr : (t.url ?? '').toLowerCase().endsWith('/' + f.ticket.toLowerCase()) || t.title.toUpperCase().startsWith(f.ticket.toUpperCase() + ' ')
    if (!isMine || t.state === f.state) return t
    const from = RANK.indexOf(t.state)
    const to = RANK.indexOf(f.state)
    if (to === -1 ? from >= RANK.indexOf('merged') : from > to) return t
    hit = true

    return timed(t, { ...t, state: f.state }, at)
  })

  return hit ? { ...b, rows, updatedAt: at } : b
}

async function observe($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<void> {
  const found = facts(tool, args)
  if (found.length === 0) return
  const at = await $.clock.now()
  let changed = false
  for (const key of await $.store.keys()) {
    if (!key.startsWith('day:') || key === 'day:demo') continue
    const kept = await safeGet($, key)
    if (!isBoard(kept)) continue
    const next = found.reduce((b, f) => applyFact(b, f, at), kept)
    if (next === kept) continue
    await $.store.set(key, next)
    changed = true
  }
  if (changed) await refresh($)
}

/** Gives the person's time for one message to the open tickets of the plan that changed last. */
async function shareWithTickets($: EngineInterface, ms: number, at: number): Promise<void> {
  let latest: { key: string; b: Board } | undefined
  for (const key of await $.store.keys()) {
    if (!key.startsWith('day:') || key === 'day:demo') continue
    const kept = await safeGet($, key)
    if (isBoard(kept) && (latest === undefined || kept.updatedAt > latest.b.updatedAt)) latest = { key, b: kept }
  }
  if (latest === undefined) return
  const next = shareTime(latest.b, ms, at)
  if (next === latest.b) return
  await $.store.set(latest.key, next)
  await refresh($)
}

export function tone(state: string): { status: FlowNode['status']; hue: string } {
  if (state === 'running') return { status: 'running', hue: HUE.running }
  if (state === 'review') return { status: 'idle', hue: '#c084fc' }
  if (state === 'merged' || state === 'verified' || state === 'done' || state === 'green') return { status: 'completed', hue: HUE.completed }
  if (state === 'failed' || state === 'red') return { status: 'failed', hue: HUE.failed }
  if (state === 'blocked' || state === 'needs-you' || state === 'cancelled') return { status: 'stopped', hue: HUE.stopped }
  if (state === 'closed' || state === 'skipped') return { status: 'completed', hue: HUE.idle }
  if (state === 'draft') return { status: 'idle', hue: '#c084fc' }
  if (state === 'pending') return { status: 'running', hue: HUE.running }

  return { status: 'idle', hue: HUE.idle }
}

/** A ticket as nodes for the run graph: the ticket, its sessions with their agents, its PR. */
function ticketNodes(t: Ticket, workers: Worker[]): FlowNode[] {
  const node = (id: string, label: string, kind: string, state: string, parent?: string): FlowNode =>
    clean({ id, label, kind, status: tone(state).status, startedAt: 0, calls: 0, errors: 0, parent })
  const out: FlowNode[] = [node(MAIN, `${t.n !== undefined ? `Ticket #${t.n}` : 'Ticket'} · ${clip(t.title, 40)}`, 'ticket', t.state)]
  const mine = workers.filter(
    w => w.kind !== 'coordinator' && (w.id === t.session || w.name === t.session || (t.branch !== undefined && w.branch === t.branch && w.kind !== 'agent')),
  )
  const agents = workers.filter(w => w.kind === 'agent' && t.branch !== undefined && w.branch !== undefined && w.branch.startsWith(t.branch))
  mine.forEach((w, i) => out.push(node(`w${i}`, w.title ?? w.name ?? w.id, w.kind || 'session', w.state)))
  const first = mine.length > 0 ? 'w0' : undefined
  agents.forEach((w, i) => out.push(node(`a${i}`, w.title ?? w.name ?? w.id, first ? 'agent' : 'general', w.state, first)))
  if (t.pr !== undefined || t.prNumber !== undefined) {
    out.push(node('pr', `${t.prNumber !== undefined ? `PR #${t.prNumber}` : 'PR'} · CI ${t.ci ?? 'none'}`, 'pr', t.ci ?? 'none'))
  }

  return out
}

const ORDER = ['needs', 'running', 'review', 'queued', 'done'] as const

/** What needs you first, then what runs, then review, then the rest; each group by number. */
export function sortTickets(list: Ticket[]): Ticket[] {
  const rank = (t: Ticket) => ORDER.indexOf(bucket(t.state) as (typeof ORDER)[number])

  return [...list].sort((a, b) => rank(a) - rank(b) || (a.n ?? 999) - (b.n ?? 999))
}


// ---------- the prompts of the person, counted (pure) ----------

const PROMPTS_KEY = 'prompts'
const MAX_SAID = 400
const MAX_SAID_TEXT = 240

/**
 * What a prompt means, in one key: lower case, one space between words, and a number, a link or a quoted name
 * replaced by a mark. "Merge PR 12" and "merge pr 13" are the same prompt, and so are two prompts that differ only
 * in the name of a ticket.
 */
export function promptKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<link>')
    .replace(/"[^"]*"|`[^`]*`/g, '<name>')
    .replace(/\b[a-z]{1,6}-\d+\b/g, '<id>')
    .replace(/#?\d+/g, '<n>')
    .replace(/[^\p{L}\p{N}<>/ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

/** One more prompt at `at`. The list is the same list with that prompt counted, and the oldest single prompts leave when it is full. */
export function countPrompt(list: Said[], text: string, at: number): Said[] {
  const key = promptKey(text)
  if (key === '') return list
  const shown = text.trim().replace(/\s+/g, ' ').slice(0, MAX_SAID_TEXT)
  const i = list.findIndex(s => s.key === key)
  if (i >= 0) return list.map((s, j) => (j === i ? { ...s, n: s.n + 1, last: at, text: shown } : s))
  const next = [...list, { key, text: shown, n: 1, first: at, last: at }]
  if (next.length <= MAX_SAID) return next
  const drop = next.findIndex(s => s.n === 1)

  return next.filter((_, j) => j !== (drop >= 0 ? drop : 0))
}

export type PromptReport = { total: number; unique: number; repeated: Said[]; once: Said[]; share: number; since: number }

/** The count of the prompts: the ones said more than once (most often first), the ones said once, and the share that is a repeat. */
export function reportPrompts(list: Said[]): PromptReport {
  const total = list.reduce((n, s) => n + s.n, 0)
  const repeated = list.filter(s => s.n > 1).sort((a, b) => b.n - a.n || b.last - a.last)
  const once = list.filter(s => s.n === 1).sort((a, b) => b.last - a.last)
  const extra = repeated.reduce((n, s) => n + s.n - 1, 0)

  return { total, unique: list.length, repeated, once, share: total === 0 ? 0 : Math.round((extra / total) * 100), since: list.reduce((m, s) => (m === 0 || s.first < m ? s.first : m), 0) }
}

/** The text that asks for a skill for a prompt that came back. It goes in the chat input. */
export function automateText(s: Said): string {
  return `I said this ${s.n} times: "${s.text}". Make a skill or a command that does it, and tell me how to start it.`
}

async function loadPrompts($: EngineInterface): Promise<Said[]> {
  const kept = await safeGet($, PROMPTS_KEY)

  return Array.isArray(kept) ? (kept as Said[]).filter(s => typeof s?.key === 'string' && typeof s.n === 'number') : []
}

/** A short mark for the CI of a ticket. */
// ---------- the ticket list as a report (pure) ----------

const REVIEW_HUE = '#c084fc'
const GROUPS: Record<(typeof ORDER)[number], { label: string; hue: string; mark: string }> = {
  needs: { label: 'NEEDS YOU', hue: HUE.stopped, mark: '!' },
  running: { label: 'IN PROGRESS', hue: HUE.running, mark: '◉' },
  review: { label: 'IN REVIEW', hue: REVIEW_HUE, mark: '◐' },
  queued: { label: 'NOT STARTED', hue: DIM, mark: '○' },
  done: { label: 'DONE', hue: HUE.completed, mark: '✓' },
}

export type TicketGroup = { group: (typeof ORDER)[number]; label: string; hue: string; mark: string; rows: Ticket[] }

/** The tickets in groups, in the order of the list: what needs the person first and what is done last. Empty groups are left out. */
export function groupTickets(list: Ticket[]): TicketGroup[] {
  return ORDER.map(group => ({ group, ...GROUPS[group], rows: list.filter(t => bucket(t.state) === group) })).filter(g => g.rows.length > 0)
}

/**
 * How far a ticket is on the way from queued to verified: `at` of `total` steps are done. A ticket that waits for
 * the person, is blocked or failed has no place on that way: `at` is undefined.
 */
export function stepOf(state: string): { at?: number; total: number; text: string } {
  const total = STAGES.length
  const key = state === 'draft' ? 'review' : state === 'pending' ? 'running' : state === 'closed' || state === 'skipped' || state === 'done' ? 'verified' : state
  const i = STAGES.indexOf(key)
  if (i === -1) return { total, text: state }
  const at = i + 1

  return { at, total, text: `${'●'.repeat(at)}${'○'.repeat(total - at)} ${state} ${at}/${total}` }
}

/** The colour of each step on the way. A step keeps its colour when it is done, so a line of steps is not one colour. */
const STAGE_HUE = ['#c9d1d9', HUE.running, REVIEW_HUE, '#60a5fa', HUE.completed]

/** The steps of one ticket: done, current, to do, each with its mark and colour. A ticket that is off the way has none. */
export type StepPart = { name: string; mark: string; hue: string; isNow: boolean }
export function stepParts(state: string): StepPart[] {
  const { at } = stepOf(state)
  if (at === undefined) return []

  return STAGES.map((name, i) => {
    const isDone = i + 1 < at || at === STAGES.length
    const isNow = i + 1 === at && !isDone

    return { name, mark: isDone ? '✓' : isNow ? '◉' : '○', hue: isDone || isNow ? (STAGE_HUE[i] ?? DIM) : DIM, isNow }
  })
}

/** The track of a ticket as a small drawing: one dot for each step, a line between them, the current dot glows. */
export function drawTrack(state: string): Drawing | undefined {
  const parts = stepParts(state)
  if (parts.length === 0) return undefined
  const gap = 34
  let svg = ''
  parts.forEach((p, i) => {
    const x = 10 + i * gap
    const isDone = p.mark === '✓'
    if (i > 0) svg += `<line x1="${x - gap + 7}" y1="10" x2="${x - 7}" y2="10" stroke="${isDone || p.isNow ? p.hue : EDGE}" stroke-width="2" stroke-linecap="round"/>`
    svg +=
      `<g><title>${esc(p.name)}</title>` +
      (p.isNow
        ? `<circle cx="${x}" cy="10" r="7" fill="${p.hue}" filter="url(#glow)"/><circle cx="${x}" cy="10" r="2.6" fill="${CARD}"/>`
        : isDone
          ? `<circle cx="${x}" cy="10" r="6" fill="${p.hue}"/>`
          : `<circle cx="${x}" cy="10" r="5.5" fill="none" stroke="${EDGE}" stroke-width="1.6"/>`) +
      `</g>`
  })

  return frame(svg, 20, 10 + (parts.length - 1) * gap + 10)
}

/** The steps of one ticket in a line: done, current, to do. A ticket that is off the way shows why. */
export function stepList(state: string): string {
  const parts = stepParts(state)
  if (parts.length === 0) {
    return state === 'needs-you' ? '! Waits for you' : state === 'blocked' ? '✗ Blocked' : state === 'failed' ? '✗ Failed' : `! ${state}`
  }

  return parts.map(p => `${p.mark} ${p.name}`).join('  →  ')
}

/** A ticket in words for the chat input: its number, its title, its PR and its link. */
export function ticketRef(t: Ticket): string {
  const name = `${t.n !== undefined ? `#${t.n} ` : ''}${t.title}`

  return `ticket "${name}"${t.prNumber !== undefined ? ` (PR #${t.prNumber})` : ''}${t.url !== undefined ? ` ${t.url}` : ''}`
}

/** The quick actions of a ticket. Each puts a text in the chat input and does not send it. */
export const ACTIONS: { key: string; label: string; mode: 'insert' | 'replace'; text: (ref: string) => string }[] = [
  { key: 'ref', label: '＋ Name', mode: 'insert', text: ref => `${ref} ` },
  { key: 'status', label: 'Status', mode: 'replace', text: ref => `Give me the status of ${ref}: what is done, what is left and what stops it.` },
  { key: 'continue', label: 'Continue', mode: 'replace', text: ref => `Continue the work on ${ref} to the end.` },
  { key: 'verify', label: 'Verify', mode: 'replace', text: ref => `Verify ${ref} on staging in the browser, and show me the evidence.` },
]

/**
 * The same ticket with its times kept. Work starts when the ticket first leaves the queue. It ends when the ticket
 * is first done, and a ticket that opens again has no end.
 */
export function timed(old: Ticket | undefined, next: Ticket, at: number): Ticket {
  const group = bucket(next.state)
  const startedAt = old?.startedAt ?? (group === 'queued' ? undefined : at)
  const endedAt = group === 'done' ? (old?.endedAt ?? at) : undefined
  const out: Ticket = { ...next }
  if (startedAt !== undefined) out.startedAt = startedAt
  else delete out.startedAt
  if (endedAt !== undefined) out.endedAt = endedAt
  else delete out.endedAt
  if (old?.mine !== undefined) out.mine = old.mine
  if (old?.mineMs !== undefined) out.mineMs = old.mineMs

  return out
}

/** `ms` of the person's time, in equal parts for the tickets that are open (started and not done) at this moment. */
export function shareTime(b: Board, ms: number, at: number): Board {
  const open = b.rows.filter(t => t.startedAt !== undefined && t.endedAt === undefined)
  if (open.length === 0 || ms <= 0) return b
  const part = ms / open.length

  return {
    ...b,
    rows: b.rows.map(t => (open.includes(t) ? { ...t, mine: (t.mine ?? 0) + 1, mineMs: (t.mineMs ?? 0) + part } : t)),
    updatedAt: at,
  }
}

/** How long the ticket took (or takes) and the person's part. '' for a ticket with no start. */
export function ticketTime(t: Ticket, now: number): string {
  if (t.startedAt === undefined) return ''
  const took = Math.max(0, (t.endedAt ?? now) - t.startedAt)
  const mine = Math.min(t.mineMs ?? 0, took)
  const part = took > 0 ? Math.round((mine / took) * 100) : 0

  return `${span(took)}${t.endedAt === undefined ? ' so far' : ''} · you about ${span(mine)} (${part}%)`
}

export function ciMark(t: Ticket): string {
  if (t.ci === 'green' || t.ci === 'passed') return '✓ CI'
  if (t.ci === 'red' || t.ci === 'failed') return '✗ CI'
  if (t.ci === 'pending') return '… CI'

  return ''
}

/** The facts line of an open ticket. The PR and its CI stay at the end. */
export function ticketFacts(t: Ticket): string {
  return [
    t.repo,
    t.surface,
    t.size,
    t.model,
    t.sev !== undefined ? `sev ${t.sev}` : '',
    t.branch,
    t.source,
    t.prNumber !== undefined ? `PR #${t.prNumber}` : '',
    t.ci ? `CI ${t.ci}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The group of a ticket on the dashboard. */
export function bucket(state: string): View['filter'] {
  if (state === 'running') return 'running'
  if (state === 'review' || state === 'draft') return 'review'
  if (state === 'merged' || state === 'verified' || state === 'closed' || state === 'skipped') return 'done'
  if (state === 'needs-you' || state === 'blocked' || state === 'failed' || state === 'cancelled') return 'needs'

  return 'queued'
}

/** Today: the phases of the day as a pipeline. */
export type PhasePart = { key: string; label: string; hue: string; n: number }

/** The tickets of the day in the parts that the stepper shows. A blocked or failed ticket is its own part. */
export function phaseParts(rows: Ticket[]): PhasePart[] {
  const isStuck = (t: Ticket) => t.state === 'blocked' || t.state === 'failed'
  const count = (group: View['filter']) => rows.filter(t => bucket(t.state) === group && !isStuck(t)).length

  return [
    { key: 'done', label: 'done', hue: HUE.completed, n: count('done') },
    { key: 'running', label: 'in progress', hue: HUE.running, n: count('running') },
    { key: 'review', label: 'in review', hue: REVIEW_HUE, n: count('review') },
    { key: 'needs', label: 'need you', hue: HUE.stopped, n: count('needs') },
    { key: 'blocked', label: 'blocked', hue: HUE.failed, n: rows.filter(isStuck).length },
    { key: 'queued', label: 'queued', hue: DIM, n: count('queued') },
  ]
}

export function drawPhases(b: Board): Drawing {
  const at = PHASES.indexOf(b.phase)
  // The day can close with tickets that are not done. The last step then says so: it is not a green check.
  const left = b.rows.filter(r => bucket(r.state) !== 'done').length
  const isClosedOpen = b.phase === 'done' && left > 0
  let svg = heading(24, 'START WORK', at < 0 && b.phase ? `${b.id} · ${b.phase}` : b.id)
  const y = 62
  PHASES.forEach((name, i) => {
    const x = 46 + i * 92
    const isLast = i === PHASES.length - 1
    const state = at < 0 ? 'idle' : isLast && isClosedOpen ? 'stopped' : i < at || b.phase === 'done' ? 'completed' : i === at ? 'running' : 'idle'
    const shown = isLast && isClosedOpen ? `closed, ${left} open` : name
    if (i > 0) {
      const lit = i <= at ? HUE.completed : EDGE
      svg += `<line x1="${x - 78}" y1="${y}" x2="${x - 14}" y2="${y}" stroke="${lit}" stroke-width="2" stroke-linecap="round"${i === at && b.phase !== 'done' ? ' stroke-dasharray="5 5"><animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.8s" repeatCount="indefinite"/></line>' : '/>'}`
    }
    svg +=
      `<g><title>${esc(shown)}: ${state === 'completed' ? 'done' : state === 'running' ? 'now' : state === 'stopped' ? 'the day is closed, and some tickets are not done' : 'waits'}</title>` +
      `<g filter="url(#shadow)"><circle cx="${x}" cy="${y}" r="13" fill="${CARD}"/></g>` +
      `<circle cx="${x}" cy="${y}" r="13" fill="none" stroke="${HUE[state]}" stroke-width="1.6"${state === 'idle' ? '' : ' filter="url(#glow)"'}/>` +
      icon(state, x, y) +
      `<text x="${x}" y="${y + 29}" class="${i === at ? 'b' : state === 'completed' ? 't' : 's'}" text-anchor="middle">${esc(shown)}</text></g>`
  })
  return frame(svg, 104)
}

/** One ticket, opened: its session, its agents and its PR. */
/** The day as a ring: each group is an arc in its colour, and the centre gives the share that is done. */
export function drawOverview(rows: Ticket[]): Drawing {
  const total = rows.length
  const done = rows.filter(t => bucket(t.state) === 'done').length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const R = 62
  const C = 2 * Math.PI * R
  let offset = 0
  let arcs = `<circle cx="90" cy="80" r="${R}" fill="none" stroke="${EDGE}" stroke-width="14"/>`
  for (const p of phaseParts(rows)) {
    if (p.n === 0) continue
    const len = (p.n / total) * C
    arcs +=
      `<circle cx="90" cy="80" r="${R}" fill="none" stroke="${p.hue}" stroke-width="14" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 80)"` +
      `${p.key === 'done' ? ' filter="url(#glow)"' : ''}><title>${esc(p.label)}: ${p.n}</title></circle>`
    offset += len
  }
  const centre =
    `<text x="90" y="86" text-anchor="middle" class="b" style="font-size:24px">${pct}%</text>` +
    `<text x="90" y="104" text-anchor="middle" class="s">${done} of ${total} done</text>`

  return frame(arcs + centre, 170, 180)
}

export function drawTicket(t: Ticket, workers: Worker[]): Drawing {
  const g = drawGraph(ticketNodes(t, workers), '', 0, 'BREAKDOWN')

  return frame(g.svg, g.bottom + 8)
}

const DEMO_ROWS: { title: string; repo: string; surface: string; sev: number; size: string; model: string; source: string; at: number[]; fixed?: string; pr?: number; branch?: string; session?: string }[] = [
  { title: 'Login fails after a token refresh', repo: 'web-app', surface: 'web', sev: 4, size: 'S', model: 'sonnet', source: 'errors', at: [4, 10, 15, 19], pr: 101, branch: 'fix/token', session: 'lane-web' },
  { title: 'PR 97: red CI on the unit tests', repo: 'web-app', surface: 'web', sev: 3, size: 'XS', model: 'haiku', source: 'pr', at: [4, 8, 11, 13], pr: 97, branch: 'fix/units', session: 'lane-web' },
  { title: 'Add export to CSV', repo: 'api', surface: 'backend', sev: 2, size: 'M', model: 'sonnet', source: 'board', at: [8, 17, 99, 99], pr: 104, branch: 'feat/csv', session: 'lane-api' },
  { title: 'Rate limit the search endpoint', repo: 'api', surface: 'backend', sev: 2, size: 'S', model: 'sonnet', source: 'board', at: [13, 99, 99, 99], branch: 'feat/limit', session: 'lane-api' },
  { title: 'Update the onboarding text', repo: 'web-app', surface: 'web', sev: 1, size: 'XS', model: 'haiku', source: 'board', at: [], fixed: 'needs-you' },
  { title: 'Migrate the scheduled jobs', repo: 'infra', surface: 'infra', sev: 2, size: 'L', model: 'opus', source: 'board', at: [], fixed: 'blocked' },
]

export function demoBoard(tick: number, start: number): Board {
  const rows: Ticket[] = DEMO_ROWS.map((d, i) => {
    const stage = d.at.filter(t => tick >= t).length
    const state = d.fixed ?? STAGES[stage] ?? 'queued'

    return clean({
      id: `r0${i + 1}`,
      n: i + 1,
      title: d.title,
      repo: d.repo,
      surface: d.surface,
      sev: d.sev,
      size: d.size,
      model: d.model,
      source: d.source,
      state,
      branch: d.branch,
      session: d.session,
      prNumber: stage >= 2 ? d.pr : undefined,
      ci: stage >= 3 ? 'green' : stage === 2 ? 'pending' : undefined,
    } as Ticket)
  })
  const laneState = (name: string) => (rows.some(r => r.session === name && r.state === 'running') ? 'running' : tick > 4 ? 'done' : 'idle')
  const agent = (id: string, title: string, branch: string, from: number, to: number): Worker => ({
    id,
    name: id,
    kind: 'agent',
    title,
    branch,
    state: tick < from ? 'idle' : tick < to ? 'running' : 'done',
  })

  return {
    id: 'demo',
    phase: tick < 2 ? 'inbox' : tick < 4 ? 'plan' : tick < 20 ? 'running' : 'done',
    headline: 'Demo: 4 tickets start now, 1 waits for you, 1 is blocked.',
    needsYou: ['Onboarding text: the new wording needs your OK'],
    rows,
    workers: [
      { id: 'lane-web', name: 'lane-web', kind: 'session', title: 'Lane: web-app · web', state: laneState('lane-web') },
      { id: 'lane-api', name: 'lane-api', kind: 'session', title: 'Lane: api · backend', state: laneState('lane-api') },
      agent('a1', 'Fix the refresh call', 'fix/token--refresh', 4, 8),
      agent('a2', 'Add the tests', 'fix/token--tests', 5, 9),
      agent('a3', 'Review the branch', 'fix/token--review', 8, 10),
      agent('a4', 'CSV writer', 'feat/csv--writer', 8, 14),
      agent('a5', 'Export endpoint', 'feat/csv--endpoint', 9, 16),
    ],
    updatedAt: start + tick * DEMO_MS,
  }
}

// ---------- the /flow command ----------

export const FLOW_HELP = 'Use /flow [tickets | sessions | prompts | status | clear | demo | help].'

async function flowCommand($: EngineInterface, raw: string): Promise<string> {
  const arg = raw.trim().toLowerCase()
  if (arg === '') return 'Workflow pane opened.'
  if (arg === 'demo') return toggleDemo($)
  if (arg === 'tickets' || arg === 'sessions' || arg === 'prompts') {
    const tab: View['tab'] = arg
    await update($, view, w => ({ ...w, tab }))

    return `Workflow pane shows ${arg}.`
  }
  if (arg === 'status') {
    const list = await read($, peers)
    const day = await read($, board)
    const live = list.filter(p => p.status === 'running').length
    const needs = day.rows.filter(r => bucket(r.state) === 'needs').length

    const time = timeFacts(await read($, flow), await $.clock.now())
    const lines = time === undefined ? '' : `\n${timeLines(time).join('\n')}`

    return `${plural(list.length, 'session')} (${live} run). Plan ${day.id || 'none'}: ${plural(day.rows.length, 'ticket')}, ${needs} need you.${lines}`
  }
  if (arg === 'clear') {
    demoTimer?.cancel()
    demoTimer = undefined
    let n = 0
    for (const key of await $.store.keys()) {
      if (key.startsWith('day:') || key.startsWith('s:demo-')) {
        await $.store.delete(key)
        n += 1
      }
    }
    await refresh($)

    return `Removed ${plural(n, 'saved plan or demo item')}. The sessions stay.`
  }

  return FLOW_HELP
}

// ---------- hooks ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'flow',
      description: 'Show the runs, steps and agents in a live pane. tickets | sessions | prompts | status | clear | demo | help',
      argumentHint: 'tickets | sessions | prompts | status | clear | demo | help',
    })
    void $.ui.open({ id: PANE, title: 'Workflow' })
    await update($, typed, () => [])
    void loadPrompts($).then(list => update($, typed, () => list))
    $.clock.every(3000, () => refresh($))
    void refresh($)

    return next(e)
  })

  on('command.run', { command: 'flow' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'Workflow' })
    try {
      return { text: await flowCommand($, e.args) }
    } catch (err) {
      return { text: `flow-view: ${String(err)}` }
    }
  })

  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    const id = e.agentId ?? MAIN
    await update($, flow, f => {
      const g = patch(ensure(f, id, at), id, n => ({
        ...n,
        status: 'running',
        startedAt: id === MAIN ? at : n.startedAt,
        endedAt: undefined,
      }))

      return id === MAIN
        ? clean({
            ...g,
            turns: g.turns + 1,
            since: g.since ?? at,
            me: turned(g.me),
            // A turn that a system notice starts has no words of the person.
            title:
              g.title !== undefined && !g.title.startsWith('<')
                ? g.title
                : e.text.trim() && !e.text.trim().startsWith('<')
                  ? clip(e.text, 60)
                  : undefined,
          })
        : clean(g)
    })
    await publish($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const at = await $.clock.now()
    const id = e.agentId ?? MAIN
    const status =
      e.reason === 'error' ? 'failed' : e.isAborted ? 'stopped' : 'completed'
    await update($, flow, f => {
      const main = id === MAIN ? f.nodes.find(n => n.id === MAIN && n.status === 'running') : undefined
      const g = patch(f, id, n =>
        n.status === 'running' ? { ...n, status, endedAt: at } : n,
      )

      return main === undefined ? g : { ...g, me: turned(g.me, at, at - main.startedAt) }
    })
    await publish($)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      if (isTyped(e)) {
        const at = await $.clock.now()
        const before = (await read($, flow)).me?.mineMs ?? 0
        const after = await update($, flow, f => ({ ...f, me: said(f.me, at) }))
        await shareWithTickets($, (after.me?.mineMs ?? 0) - before, at)
        const counted = countPrompt(await loadPrompts($), e.text, at)
        await $.store.set(PROMPTS_KEY, counted)
        await update($, typed, () => counted)
      }
    } catch {
      // The time count is a view only: a prompt always goes through.
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    const id = ran.agentId
    if (id !== undefined) {
      const at = await $.clock.now()
      await update($, flow, f =>
        patch(ensure(f, id, at), id, n => clean({
          ...n,
          label: e.description || e.subagentType || n.label,
          kind: e.subagentType,
          model: ran.model,
          prompt: clip(e.prompt, 600),
          parent: e.parentAgentId,
        })),
      )
      await publish($)
    }

    return ran
  })

  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    const call: Call = {
      id: e.tool_use_id,
      tool: short(e.tool),
      agent: e.agentId ?? MAIN,
      startedAt: at,
      isError: false,
    }
    const args = e as unknown as Record<string, unknown>
    await update($, flow, f => begin(f, call, e.tool, args))
    let isError = true
    try {
      const ran = await next(e)
      isError = ran.deny !== undefined || ran.isError === true

      return ran
    } finally {
      const end = await $.clock.now()
      await update($, flow, f => finish(f, call.id, end, isError))
      if (e.tool === 'ArtifactData' && !isError) {
        try {
          await capture($, args)
        } catch {
          // The plan copy is a view only: a write that it cannot read changes nothing.
        }
      }
      if (!isError) {
        try {
          await observe($, e.tool, args)
        } catch {
          // A fact that cannot be read changes nothing.
        }
      }
      if (end - lastPublish > 2000) await publish($)
    }
  })

  // Two short lists. Each row is a button: a press opens the drawing of
  // that item, and a second press closes it.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const { Box, Text, Button, Link } = t
    const v = await read($, view)
    const me = await $.session.id()
    const now = await $.clock.now()
    const v0 = await read($, view)
    const everyone = sortPeers(await read($, peers), me)
    const shown = v0.live === true ? everyone.filter(p => p.status === 'running') : everyone
    const all = shown.slice(0, MAX_PEERS)
    const day = await read($, board)
    // The width of a drawing: its own size, or less in a narrow pane (a cell is about 9 pixels).
    const width = Math.min(Math.round(W * SCALE), Math.max(280, (e.props.bodyColumns ?? 80) * 9))
    const sorted = sortTickets(day.rows)
    const matching = sorted.filter(r => v.filter === 'all' || bucket(r.state) === v.filter)
    const rows = matching
    const count = (group: View['filter']) => sorted.filter(r => group === 'all' || bucket(r.state) === group).length
    const only = (group: View['filter']) => () =>
      update($, view, w => ({ ...w, filter: w.filter === group ? 'all' : group, ticket: '' }))
    // The day in four numbers. Each is a button: a press shows only its
    // tickets, and a second press shows all tickets again.
    const TILES: [View['filter'], string, string][] = [
      ['all', 'All', INK],
      ['running', 'Running', HUE.running],
      ['review', 'In review', '#c084fc'],
      ['done', 'Done', HUE.completed],
      ['needs', 'Needs you', HUE.stopped],
      ['queued', 'Queued', DIM],
    ]
    const live = everyone.filter(p => p.status === 'running').length
    const isDemo = everyone.some(p => p.id.startsWith('demo-'))
    const tab = (name: View['tab']) => () => update($, view, w => ({ ...w, tab: name }))
    // The done group starts folded: the person looks at the open work first.
    const closed = v.closed ?? ['done']
    const columns = e.props.bodyColumns ?? 80
    const cardWidth = columns >= 90 ? Math.floor((columns - 1) / 2) : columns
    const fold = (group: string) => () =>
      update($, view, w => {
        const now = w.closed ?? ['done']

        return { ...w, closed: now.includes(group) ? now.filter(g => g !== group) : [...now, group] }
      })
    const foldAll = (groups: string[]) => () => update($, view, w => ({ ...w, closed: (w.closed ?? ['done']).length > 0 ? [] : groups }))
    const openTicket = (id: string) => () => update($, view, w => ({ ...w, ticket: w.ticket === id ? '' : id }))
    const toChat = (r: Ticket, a: (typeof ACTIONS)[number]) => async () => {
      const filled = await $.prompt.fill({ text: a.text(ticketRef(r)), mode: a.mode })
      if (!filled.isFilled) await $.ui.toast('The chat input cannot take the text now. Close the open dialog, then try again.')
    }
    const openSession = (id: string) => () => update($, view, w => ({ ...w, session: w.session === id ? '' : id }))
    const time = timeFacts(await read($, flow), now)
    const report = reportPrompts(await read($, typed))
    const toChatText = (text: string) => async () => {
      const filled = await $.prompt.fill({ text, mode: 'replace' })
      if (!filled.isFilled) await $.ui.toast('The chat input cannot take the text now. Close the open dialog, then try again.')
    }
    const showOnce = v.once === true
    const toggleOnce = () => update($, view, w => ({ ...w, once: w.once !== true }))
    const tint = (status: FlowNode['status']) =>
      status === 'running' ? 'suggestion' : status === 'completed' ? 'success' : status === 'failed' ? 'error' : status === 'stopped' ? 'warning' : 'inactive'

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="tab-tickets" variant={v.tab === 'tickets' ? 'primary' : 'secondary'} onPress={tab('tickets')}>
            Today {sorted.length > 0 ? sorted.length : ''}
          </Button>
          <Button key="tab-sessions" variant={v.tab === 'sessions' ? 'primary' : 'secondary'} onPress={tab('sessions')}>
            Sessions {live > 0 ? `${live} run` : everyone.length > 0 ? everyone.length : ''}
          </Button>
          <Button key="tab-prompts" variant={v.tab === 'prompts' ? 'primary' : 'secondary'} onPress={tab('prompts')}>
            My prompts {report.repeated.length > 0 ? `${report.repeated.length} repeat` : report.total > 0 ? report.total : ''}
          </Button>
          <Button key="demo" plain dimColor onPress={() => toggleDemo($)}>
            {isDemo ? 'Stop demo' : 'Demo'}
          </Button>
        </Box>

        <Box key="overview" flexDirection="row" gap={2} flexWrap="wrap">
          {'Svg' in t && sorted.length > 0 && (
            <t.Svg source={drawOverview(sorted).source} width={150} alt={`${count('done')} of ${sorted.length} tickets done.`} />
          )}
          {time !== undefined && (
            <Box flexDirection="column" alignSelf="flex-start" gap={1} borderStyle="round" borderColor="subtle" paddingX={1}>
              <Text bold>⏱ Time of this session</Text>
              <Text>{timeLines(time)[0]}</Text>
              <Text color={time.share >= 25 ? 'warning' : 'success'}>{timeLines(time)[1]}</Text>
            </Box>
          )}
        </Box>

        {v.tab === 'prompts' && (
          <Box flexDirection="column" gap={1}>
            {report.total === 0 ? (
              <Text dimColor>Nothing counted yet. Each prompt that you type is counted and kept on this computer.</Text>
            ) : (
              <Box flexDirection="row" gap={1} flexWrap="wrap">
                {[
                  [report.total, 'prompts', HUE.running],
                  [report.unique, 'different', HUE.completed],
                  [`${report.share}%`, 'repeat', report.share >= 30 ? HUE.stopped : HUE.completed],
                ].map(([n, label, hue]) => (
                  <Box borderStyle="round" borderColor={String(hue)} paddingX={1}>
                    <Text bold color={String(hue)}>
                      {n}
                    </Text>{' '}
                    <Text dimColor>{label}</Text>
                  </Box>
                ))}
              </Box>
            )}
            {report.repeated.map(sa => {
              const top = report.repeated[0]?.n ?? 1
              const hue = sa.n >= 3 ? HUE.stopped : HUE.running

              return (
                <Box flexDirection="row" gap={1} flexWrap="wrap">
                  <Text color={hue}>{'█'.repeat(Math.max(1, Math.round((sa.n / top) * 10)))}</Text>
                  <Text bold color={hue}>
                    {sa.n}x
                  </Text>
                  <Text>{clip(sa.text, 60)}</Text>
                  <Button key={`auto-${sa.key}`} variant="secondary" onPress={toChatText(automateText(sa))}>
                    ⚙ Skill
                  </Button>
                  <Button key={`again-${sa.key}`} variant="secondary" onPress={toChatText(sa.text)}>
                    ＋
                  </Button>
                </Box>
              )
            })}
            {report.once.length > 0 && (
              <Button key="once" plain onPress={toggleOnce}>
                <Text bold color={DIM}>
                  {showOnce ? '▾' : '▸'} ○ Once
                </Text>{' '}
                <Text dimColor>{report.once.length}</Text>
              </Button>
            )}
            {showOnce &&
              report.once.map(sa => (
                <Text dimColor>
                  {'  '}○ {clip(sa.text, 80)}
                </Text>
              ))}
          </Box>
        )}

        {v.tab === 'tickets' && day.id === '' && <Text dimColor>No plan yet. Run /start-work, or press Demo.</Text>}

        {v.tab === 'tickets' && day.id !== '' && (
          <Box flexDirection="column" gap={1}>
            {'Svg' in t ? (
              <t.Svg source={drawPhases(day).source} width={width} alt={`Plan ${day.id}: phase ${day.phase}, ${count('done')} of ${sorted.length} tickets done.`} />
            ) : (
              <Text bold>
                Plan {day.id} · {day.phase}
              </Text>
            )}
            {day.needsYou.slice(0, 3).map(line => (
              <Text color="warning">! {clip(line, 90)}</Text>
            ))}
            {day.needsYou.length > 3 && <Text dimColor>+{day.needsYou.length - 3} more for you</Text>}
            {day.headline !== undefined && <Text dimColor>{clip(day.headline, 100)}</Text>}
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {TILES.map(([group, label, hue]) => (
                <Box borderStyle="round" borderColor={count(group) > 0 && (v.filter === group || v.filter === 'all') ? hue : 'subtle'} paddingX={1}>
                  <Button key={`filter-${group}`} plain dimColor={v.filter !== 'all' && v.filter !== group} onPress={only(group)}>
                    <Text bold color={count(group) > 0 ? hue : 'inactive'}>
                      {count(group)}
                    </Text>{' '}
                    {label}
                  </Button>
                </Box>
              ))}
            </Box>
            {rows.length === 0 && <Text dimColor>No tickets in this group.</Text>}
            {groupTickets(rows).map(g => (
              <Box key={`group-${g.group}`} flexDirection="column">
                <Button key={`fold-${g.group}`} plain onPress={fold(g.group)}>
                  <Text bold color={g.hue}>
                    {closed.includes(g.group) ? '▸' : '▾'} {g.mark} {g.label}
                  </Text>{' '}
                  <Text dimColor>{g.rows.length}</Text>
                </Button>
                {!closed.includes(g.group) && (
                  <Box flexDirection="row" flexWrap="wrap" gap={1}>
                    {g.rows.map(r => {
                      const isOpen = v.ticket === r.id
                      const isActive = g.group === 'needs' || g.group === 'running' || g.group === 'review'
                      const isDone = g.group === 'done'
                      const isBad = r.state === 'failed' || r.state === 'blocked'
                      const hue = isBad ? HUE.failed : g.hue
                      const step = stepOf(r.state)
                      const track = drawTrack(r.state)
                      const ci = ciMark(r)
                      const time = ticketTime(r, now)
                      const facts = ticketFacts(r)

                      return (
                        <Box
                          flexDirection="column"
                          width={cardWidth}
                          borderStyle="round"
                          borderColor={isOpen || isActive ? hue : 'subtle'}
                          paddingX={1}
                        >
                          <Button key={`ticket-${r.id}`} plain onPress={openTicket(r.id)}>
                            <Text bold color={hue}>
                              {isBad ? '✗' : g.mark}
                            </Text>{' '}
                            <Text dimColor>{r.n !== undefined ? `#${r.n} ` : ''}</Text>
                            <Text bold={!isDone} dimColor={isDone}>
                              {clip(r.title, Math.max(16, cardWidth - 12))}
                            </Text>
                          </Button>
                          <Box flexDirection="row" gap={1} flexWrap="wrap">
                            {track !== undefined && 'Svg' in t ? (
                              <t.Svg source={track.source} width={Math.round(track.units * SCALE)} alt={`${r.state} ${step.at} of ${step.total}`} />
                            ) : (
                              <Text bold color={hue}>
                                {step.at === undefined ? stepList(r.state) : step.text}
                              </Text>
                            )}
                            {step.at !== undefined && (
                              <Text color={hue}>
                                {r.state} {step.at}/{step.total}
                              </Text>
                            )}
                            {r.prNumber !== undefined && <Text dimColor>PR #{r.prNumber}</Text>}
                            {ci !== '' && (
                              <Text color={r.ci === 'red' || r.ci === 'failed' ? HUE.failed : r.ci === 'pending' ? HUE.stopped : HUE.completed}>{ci}</Text>
                            )}
                          </Box>
                          {isActive && r.note !== undefined && !isOpen && <Text color="warning">{clip(r.note, Math.max(20, cardWidth - 4))}</Text>}
                          {(isOpen || isActive) && (
                            <Box flexDirection="row" gap={1} flexWrap="wrap">
                              {ACTIONS.map(a => (
                                <Button key={`act-${a.key}-${r.id}`} variant="secondary" onPress={toChat(r, a)}>
                                  {a.label}
                                </Button>
                              ))}
                              {r.url !== undefined && /^https?:\/\//.test(r.url) && <Link href={r.url} label="↗" />}
                            </Box>
                          )}
                          {isOpen && (
                            <Box flexDirection="column">
                              <Text dimColor>{time !== '' ? `⏱ ${time}` : '⏱ not measured'}</Text>
                              {facts !== '' && <Text dimColor>{facts}</Text>}
                              {r.note !== undefined && <Text color="warning">{clip(r.note, 100)}</Text>}
                              {'Svg' in t && <t.Svg source={drawTicket(r, day.workers).source} width={width} alt={`Ticket ${r.title}: ${r.state}.`} />}
                            </Box>
                          )}
                        </Box>
                      )
                    })}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}

        {v.tab === 'sessions' && all.length === 0 && (
          <Text dimColor>No session data yet. Data shows after the first turn. Press Demo to see samples.</Text>
        )}

        {v.tab === 'sessions' && everyone.length > 1 && (
          <Button key="only-live" plain dimColor onPress={() => update($, view, w => ({ ...w, live: !w.live, session: '' }))}>
            {v.live === true ? `Showing ${live} running of ${everyone.length}. Show all sessions` : `Only running (${live})`}
          </Button>
        )}

        {v.tab === 'sessions' && (
          <Box flexDirection="column" gap={1}>
            {all.map(p => {
              const isOpen = v.session === p.id

              return (
                <Box flexDirection="column">
                  <Button key={`session-${p.id}`} plain onPress={openSession(p.id)}>
                    <Text color={tint(p.status)}>{MARK[p.status]}</Text> {clip(p.title, 44)}{' '}
                    <Text dimColor>
                      {p.id === me ? 'this session · ' : ''}
                      {p.stepsTotal > 0 ? `${p.stepsDone}/${p.stepsTotal} steps` : p.status}
                      {p.agents.length > 0 ? ` · ${plural(p.agents.length, 'agent')}` : ''}
                      {failedAgents(p) > 0 ? ` · ${failedAgents(p)} failed` : ''}
                      {p.status !== 'running' ? ` · ${ago(now - p.updatedAt)}` : ''}
                    </Text>
                  </Button>
                  {!isOpen && p.status === 'running' && p.step !== undefined && <Text dimColor>{'  '}→ {clip(p.step, 60)}</Text>}
                  {isOpen && (
                    <Text dimColor>
                      {'  '}
                      {p.folder} · {span(now - p.startedAt)} · {plural(p.calls, 'tool call')}
                    </Text>
                  )}
                  {isOpen && 'Svg' in t && (
                    <t.Svg source={drawRun(p).source} width={width} alt={`Session ${p.title}: ${p.stepsDone} of ${p.stepsTotal} steps done.`} />
                  )}
                  {isOpen && !('Svg' in t) && p.steps.length === 0 && <Text dimColor>{'  '}No plan yet.</Text>}
                  {isOpen &&
                    !('Svg' in t) &&
                    p.steps.map(st => (
                      <Text dimColor={st.status === 'completed'} bold={st.status === 'in_progress'}>
                        {'  '}
                        {MARK[st.status]} {clip(st.content, 60)}
                      </Text>
                    ))}
                  {isOpen &&
                    !('Svg' in t) &&
                    p.agents.map((a: PeerAgent) => (
                      <Text color={tint(a.status)}>
                        {'  '.repeat(a.depth + 1)}
                        {MARK[a.status]} {a.label}
                      </Text>
                    ))}
                </Box>
              )
            })}
            {shown.length > all.length && <Text dimColor>+{shown.length - all.length} more sessions</Text>}
          </Box>
        )}
      </Box>
    )
  })
}
