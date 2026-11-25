// Lane health: the pure part. A lane is a nested session that the paralel dispatcher started; the coordinator keeps
// it as a row of the ledger file ~/.claude/paralel/<repo>-<YYYY-MM-DD>.json (paralel, keep-it-running.md, section 2).

import type { OpsLaneHealth } from '../types'

export type LedgerLane = {
  lane?: string
  items?: readonly unknown[]
  session?: string | null
  name?: string
  branch?: string
  pr?: number | string | null
  state?: string
  lastReport?: string
  restarts?: number
}

export type Ledger = {
  repo?: string
  started?: string
  updated?: string
  coordinator?: string
  lanes?: readonly LedgerLane[]
}

/** What the session tools say of a lane's session, when they answer. */
export type LaneSession = { isRunning?: boolean; isArchived?: boolean; isMissing?: boolean; lastActivityAt?: number }

/** What ops-board did for one lane: at most one check, one restart and one decision record, ever. */
export type LaneMark = { checkAt?: number; restartAt?: number; decidedAt?: number }

export type LaneStep = 'check' | 'restart' | 'decide'

/** The decision record of routines/README.md. */
export type DecisionRecord = {
  id: string
  ticket: string | null
  question: string
  options: [string, string]
  default: string
  deadline: string
  reversible: boolean
}

const DONE_RE = /\b(done|merged|verified|closed)\b/i
const DEAD_RE = /\b(failed|stopped|crashed|dead|ended|killed)\b/i
const RUNNING_RE = /^\s*running\b/i
const TICKET_RE = /^[A-Z][A-Z0-9]*-\d+$/
const FILE_RE = /-(\d{4}-\d{2}-\d{2})\.json$/

const pad = (n: number) => String(n).padStart(2, '0')
/** The local date of a time, `YYYY-MM-DD`. */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A ledger file of today or yesterday (a lane can run over midnight). */
export function isRecentLedger(name: string, now: number): boolean {
  const m = FILE_RE.exec(name)
  if (m === null) return false
  return m[1] === dayOf(now) || m[1] === dayOf(now - 24 * 3600 * 1000)
}

export function timeOf(value: unknown): number | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : undefined
}

export const hasPr = (l: LedgerLane): boolean => l.pr !== undefined && l.pr !== null && l.pr !== '' && l.pr !== 0

/** The newest sign of life of a lane: its last report (else the ledger's own times), its session, or a change ops-board saw in its row. */
export function lastActivity(l: LedgerLane, ledger: Ledger, session: LaneSession | undefined, changedAt: number | undefined): number | undefined {
  const base = timeOf(l.lastReport) ?? timeOf(ledger.updated) ?? timeOf(ledger.started)
  const all = [base, session?.lastActivityAt, changedAt].filter((t): t is number => t !== undefined)
  return all.length === 0 ? undefined : Math.max(...all)
}

/**
 * The health of a lane. `dead`: its session stopped (the ledger says failed or stopped, or the session is archived or
 * gone) with no PR and no done mark. `silent`: the ledger says running and nothing moved for `limitMs`.
 */
export function laneHealth(
  l: LedgerLane,
  activity: number | undefined,
  now: number,
  limitMs: number,
  session?: LaneSession,
): { health: OpsLaneHealth; why: string } {
  const state = typeof l.state === 'string' ? l.state : ''
  if (DONE_RE.test(state)) return { health: 'done', why: 'done mark in the ledger' }
  if (!hasPr(l)) {
    if (DEAD_RE.test(state)) return { health: 'dead', why: `the ledger says "${state.slice(0, 40)}", with no PR` }
    if (session?.isArchived === true) return { health: 'dead', why: 'its session is archived, with no PR and no done mark' }
    if (session?.isMissing === true) return { health: 'dead', why: 'its session is gone, with no PR and no done mark' }
  }
  if (RUNNING_RE.test(state) && session?.isRunning !== true && activity !== undefined && now - activity >= limitMs) {
    return { health: 'silent', why: `no activity for ${Math.round((now - activity) / 60_000)} min while the ledger says running` }
  }
  return { health: 'ok', why: state === '' ? 'no state' : state.slice(0, 40) }
}

/** The one next step for a lane that is silent or dead: one check, then one restart, then one decision record. */
export function nextStep(health: OpsLaneHealth, mark: LaneMark, ledgerRestarts: number | undefined, now: number, limitMs: number): LaneStep | undefined {
  if (health !== 'silent' && health !== 'dead') return undefined
  if (mark.decidedAt !== undefined) return undefined
  if (mark.checkAt === undefined) return 'check'
  const restartAt = mark.restartAt ?? ((ledgerRestarts ?? 0) >= 1 ? mark.checkAt : undefined)
  if (restartAt === undefined) return now - mark.checkAt >= limitMs ? 'restart' : undefined
  return now - restartAt >= limitMs ? 'decide' : undefined
}

export function laneLabel(l: LedgerLane): string {
  const items = (l.items ?? []).filter((x): x is string => typeof x === 'string').join(', ')
  return `lane ${l.lane ?? '?'} (${[l.name, items].filter(Boolean).join('; ') || 'no name'})`
}

export function stepText(step: 'check' | 'restart', l: LedgerLane, file: string, health: OpsLaneHealth, why: string): string {
  const who = `${laneLabel(l)} of the ledger ~/.claude/paralel/${file}`
  if (step === 'check') {
    return (
      `ops-board: ${who} looks ${health}: ${why}. Check it once, by the paralel rules (keep-it-running.md, section 3): ` +
      `read its session state (list_sessions, linked) and its pushed work; if it is idle, send it "status?". ` +
      `Write what you find in its ledger row (state, lastReport). Do not restart it in this turn. ops-board asks for one check only.`
    )
  }
  const branch = l.branch ? ` on \`${l.branch}\`` : ''
  return (
    `ops-board: ${who} is still ${health} after one check: ${why}. Restart it once: a new lane session with the same brief, ` +
    `plus "resume from the pushed work${branch}; check for saved WIP before you dispatch anything". ` +
    `Add 1 to its \`restarts\` in the ledger. If it was restarted before, do not restart it again: set it to blocked. ops-board asks for one restart only.`
  )
}

const slug = (s: string) => s.replace(/\.json$/, '').replace(/[^\w.-]+/g, '-')

export function decisionOf(l: LedgerLane, file: string, health: OpsLaneHealth, now: number): DecisionRecord {
  const ticket = (l.items ?? []).find((x): x is string => typeof x === 'string' && TICKET_RE.test(x)) ?? null
  const options: [string, string] = ['mark the lane blocked', 'a person takes the lane over']
  return {
    id: `ops-board-lane-${slug(file)}-${slug(l.lane ?? 'x')}`,
    ticket,
    question: `${laneLabel(l)} is still ${health} after one check and one restart. How to go on?`,
    options,
    default: options[0],
    deadline: new Date(now + 24 * 3600 * 1000).toISOString(),
    reversible: true,
  }
}

/** The decisions file with the record added or replaced by id; undefined when the file is not a JSON array (change nothing then). */
export function withDecision(text: string | undefined, rec: DecisionRecord): string | undefined {
  let list: unknown[] = []
  if (text !== undefined && text.trim() !== '') {
    try {
      const j = JSON.parse(text) as unknown
      if (!Array.isArray(j)) return undefined
      list = j
    } catch {
      return undefined
    }
  }
  const rest = list.filter(x => !(typeof x === 'object' && x !== null && (x as { id?: unknown }).id === rec.id))
  return JSON.stringify([...rest, rec], null, 2) + '\n'
}

/** True when the ledger names this session as its coordinator. */
export function isCoordinator(coordinator: unknown, ids: readonly (string | undefined)[]): boolean {
  if (typeof coordinator !== 'string' || coordinator === '') return false
  return ids.some(id => id !== undefined && id.length >= 8 && (coordinator === id || coordinator.includes(id) || id.includes(coordinator)))
}

/** Reads what the get_session tool answers (a JSON text) as a LaneSession. */
export function sessionOf(text: string, isError: boolean): LaneSession | undefined {
  if (isError) return /not found|no session|unknown session/i.test(text) ? { isMissing: true } : undefined
  try {
    const j = JSON.parse(text) as { isRunning?: unknown; isArchived?: unknown; lastActivityAt?: unknown }
    const out: LaneSession = {}
    if (typeof j.isRunning === 'boolean') out.isRunning = j.isRunning
    if (typeof j.isArchived === 'boolean') out.isArchived = j.isArchived
    const at = timeOf(j.lastActivityAt)
    if (at !== undefined) out.lastActivityAt = at
    return out
  } catch {
    return undefined
  }
}
