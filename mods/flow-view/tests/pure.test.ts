import { expect, test } from 'claude-code/testing'

import { ago, applyFact, facts, isTyped, said, timeFacts, timeLines, turned, bucket, capTools, card, ciMark, clip, nodeHue, isBoard, isPeer, merge, toPeer, demoBoard, demoPeers, drawPhases, drawRun, drawTicket, failedAgents, plan, plural, sortPeers, sortTickets, span, stamp, ticketFacts, tip, tone } from '../hooks/register'

// Pure helpers: no engine sits beneath these tests.

test('span writes ms, seconds, minutes and hours', () => {
  expect(span(250)).toBe('250ms')
  expect(span(4_000)).toBe('4s')
  expect(span(125_000)).toBe('2m 05s')
  expect(span(3_900_000)).toBe('1h 05m')
  expect(span(Number.NaN)).toBe('0ms')
  expect(span(-5)).toBe('0ms')
})

test('ago writes one short unit', () => {
  expect(ago(10_000)).toBe('just now')
  expect(ago(3 * 60_000)).toBe('3m ago')
  expect(ago(5 * 3_600_000)).toBe('5h ago')
  expect(ago(2 * 86_400_000)).toBe('2d ago')
})

test('plural picks the form', () => {
  expect(plural(1, 'agent')).toBe('1 agent')
  expect(plural(2, 'agent')).toBe('2 agents')
  expect(plural(0, 'agent')).toBe('0 agents')
})

test('clip is safe for a small limit', () => {
  expect(clip('  a   b  ', 10)).toBe('a b')
  expect(clip('abcdef', 4)).toBe('abc…')
  expect(clip('abcdef', 1)).toBe('a')
  expect(clip('abcdef', 0)).toBe('')
})

test('tone and bucket agree on the new states', () => {
  expect(tone('draft').status).toBe('idle')
  expect(tone('cancelled').status).toBe('stopped')
  expect(bucket('draft')).toBe('review')
  expect(bucket('closed')).toBe('done')
  expect(bucket('cancelled')).toBe('needs')
  expect(bucket('queued')).toBe('queued')
  expect(bucket('idle')).toBe('queued')
})

test('stamp keeps the start time of a step with the same text', () => {
  const before = [{ content: 'a', status: 'in_progress' as const, startedAt: 5 }]
  const after = stamp(before, [{ content: 'a', status: 'completed' as const }], 9)
  expect(after[0]?.startedAt).toBe(5)
  expect(after[0]?.endedAt).toBe(9)
})

test('plan advances the step that runs', () => {
  const steps = [
    { content: 'a', status: 'in_progress' as const },
    { content: 'b', status: 'pending' as const },
  ]
  const next = plan(steps, 'mcp__ccd_turn__update_plan', { advance: true })
  expect(next.map(s => s.status)).toEqual(['completed', 'in_progress'])
})

test('sortPeers puts running sessions first, then this one, then the newest', () => {
  const base = { title: 't', folder: 'f', updatedAt: 0, stepsDone: 0, stepsTotal: 0, steps: [], agents: [], calls: 0, started: [] }
  const list = [
    { ...base, id: 'old', status: 'idle' as const, startedAt: 1 },
    { ...base, id: 'new', status: 'idle' as const, startedAt: 9 },
    { ...base, id: 'me', status: 'idle' as const, startedAt: 2 },
    { ...base, id: 'run', status: 'running' as const, startedAt: 0 },
  ]
  expect(sortPeers(list, 'me').map(p => p.id)).toEqual(['run', 'me', 'new', 'old'])
})

test('failedAgents counts the failed agents of a session', () => {
  const agents = [
    { label: 'a', kind: 'x', status: 'failed' as const, depth: 0 },
    { label: 'b', kind: 'x', status: 'completed' as const, depth: 0 },
  ]
  const p = { id: 'p', title: 't', folder: 'f', status: 'idle' as const, startedAt: 0, updatedAt: 0, stepsDone: 0, stepsTotal: 0, steps: [], agents, calls: 0, started: [] }
  expect(failedAgents(p)).toBe(1)
})

test('sortTickets puts what needs you first, then by number', () => {
  const t = (n: number, state: string) => ({ id: `r${n}`, n, title: 't', state })
  const list = [t(1, 'merged'), t(2, 'queued'), t(3, 'running'), t(4, 'blocked'), t(5, 'review'), t(6, 'running')]
  expect(sortTickets(list).map(x => x.n)).toEqual([4, 3, 6, 5, 2, 1])
})

test('ticketFacts keeps the PR and its CI at the end', () => {
  const facts = ticketFacts({ id: 'r', title: 't', state: 'review', repo: 'shop', surface: 'web', size: 'S', sev: 3, branch: 'fix/a', prNumber: 7, ci: 'pending' })
  expect(facts).toBe('shop · web · S · sev 3 · fix/a · PR #7 · CI pending')
  expect(ticketFacts({ id: 'r', title: 't', state: 'queued' })).toBe('')
})

test('the phases drawing shows how many tickets are done', () => {
  const day = demoBoard(22, 0)
  const src = drawPhases(day).source
  expect(src).toContain('tickets done')
  expect(src).toContain('<title>')
  expect(drawPhases({ ...day, rows: [] }).source).not.toContain('tickets done')
})

test('the steps drawing shows the progress and the time spent', () => {
  const [peer] = demoPeers(22, 1_000)
  const src = drawRun(peer!).source
  expect(src).toMatch(/\d+ of \d+ done · /)
  const waiting = drawRun({ ...peer!, steps: [{ content: 'later', status: 'pending' }] }).source
  expect(waiting).toContain('queued')
})

const NODE = { id: 'n', label: 'Bug hunt', kind: 'Explore', status: 'running' as const, startedAt: 0, calls: 3, errors: 0 }

test('a card shows the model, the errors and the last tool of a node that runs', () => {
  const src = card({ ...NODE, model: 'haiku', errors: 2, lastTool: 'Grep' }, 0, 0, 460, 44, false)
  expect(src).toContain('Explore · in progress · haiku · 2 errors · Grep')
})

test('a node that ended well with failed calls is amber', () => {
  const ok = card({ ...NODE, status: 'completed', endedAt: 4000 }, 0, 0, 300, 44, false)
  const warn = card({ ...NODE, status: 'completed', endedAt: 4000, errors: 1 }, 0, 0, 300, 44, false)
  expect(ok).toContain('stroke="#2bd98a" stroke-width="1.8"')
  expect(warn).toContain('stroke="#fbbf24" stroke-width="1.8"')
})

test('the tip names the last tool, and a tiny card does not break', () => {
  expect(tip({ ...NODE, lastTool: 'Grep' })).toContain('Last tool: Grep')
  expect(card(NODE, 0, 0, 20, 44, false)).toContain('Bug')
})

test('isPeer needs a known status, and isBoard needs rows with an id', () => {
  const peer = { id: 'p', title: 't', folder: 'f', status: 'running', startedAt: 0, updatedAt: 0, stepsDone: 0, stepsTotal: 0, steps: [], agents: [], calls: 0, started: [] }
  expect(isPeer(peer)).toBe(true)
  expect(isPeer({ ...peer, status: 'weird' })).toBe(false)
  const day = { id: 'd', phase: 'plan', needsYou: [], rows: [{ id: 'r1' }], workers: [], updatedAt: 1 }
  expect(isBoard(day)).toBe(true)
  expect(isBoard({ ...day, rows: [{ title: 'no id' }] })).toBe(false)
  expect(isBoard({ ...day, workers: [null] })).toBe(false)
})

test('toPeer takes the folder from a Windows path too', () => {
  const flow = { steps: [], nodes: [], calls: [], tools: {}, turns: 0, started: [] }
  expect(toPeer(flow, 'a', 'C:\\work\\web-app', 1).folder).toBe('web-app')
  expect(toPeer(flow, 'a', '/work/web-app/', 1).folder).toBe('web-app')
})

test('merge ignores a number that is not finite, and updates one field', () => {
  const list = [{ id: 'r1', title: 'old', state: 'queued', n: 1 }]
  const next = merge(list, 'r1', 'update', { state: 'running', n: Number.NaN }, ['title', 'state'], ['n'])
  expect(next).toEqual([{ id: 'r1', title: 'old', state: 'running', n: 1 }])
})

test('capTools keeps the tools that were used most', () => {
  const tools: Record<string, number> = {}
  for (let i = 0; i < 50; i++) tools[`t${i}`] = i
  const out = capTools(tools)
  expect(Object.keys(out).length).toBe(40)
  expect(out.t49).toBe(49)
  expect(out.t0).toBeUndefined()
  expect(capTools({ a: 1 })).toEqual({ a: 1 })
})

test('ciMark has one mark for each CI state', () => {
  const t = (ci?: string) => ({ id: 'r', title: 't', state: 'review', ci })
  expect(ciMark(t('green'))).toBe('✓ CI')
  expect(ciMark(t('red'))).toBe('✗ CI')
  expect(ciMark(t('pending'))).toBe('… CI')
  expect(ciMark(t())).toBe('')
})

test('the wire and the card use one color for a node', () => {
  const n = { id: 'n', label: 'a', kind: 'x', status: 'completed' as const, startedAt: 0, calls: 1, errors: 1 }
  expect(nodeHue(n)).toBe('#fbbf24')
  expect(nodeHue({ ...n, errors: 0 })).toBe('#2bd98a')
  expect(nodeHue({ ...n, status: 'failed' })).toBe('#ff4d5e')
})

test('an unknown phase is named in the phases drawing', () => {
  const day = { ...demoBoard(5, 0), phase: 'waiting' }
  expect(drawPhases(day).source).toContain('· waiting')
})

test('a long note in a heading is cut, and the breakdown names the ticket', () => {
  const day = { ...demoBoard(5, 0), id: 'x'.repeat(80) }
  expect(drawPhases(day).source).not.toContain('x'.repeat(60))
  const t = demoBoard(10, 0).rows[0]!
  expect(drawTicket(t, []).source).toContain('Login fails after a token refresh')
})

test('facts reads a merged pull request and a status move, and nothing else', () => {
  expect(facts('Bash', { command: 'cd repo && gh pr merge 10254 -R org/repo --squash' })).toEqual([{ pr: 10254, state: 'merged' }])
  expect(facts('Bash', { command: 'gh pr merge https://github.com/org/repo/pull/7 --squash' })).toEqual([{ pr: 7, state: 'merged' }])
  expect(facts('Bash', { command: 'gh pr view 10254' })).toEqual([])
  expect(facts('mcp__x__update_task', { task_id: 'abc123', status: 'In Review' })).toEqual([{ ticket: 'abc123', state: 'review' }])
  expect(facts('mcp__x__update_task', { task_id: 'abc123', status: 'backlog' })).toEqual([])
  expect(facts('mcp__x__get_task', { task_id: 'abc123', status: 'done' })).toEqual([])
})

test('applyFact moves the matching row forward and never back', () => {
  const day = { id: 'd', phase: 'running', needsYou: [], updatedAt: 1, workers: [], rows: [
    { id: 'r01', title: 'SN-1 One', url: 'https://app.example.com/t/abc123', state: 'running', prNumber: 7 },
    { id: 'r02', title: 'SN-2 Two', state: 'verified', prNumber: 8 },
  ] }
  const merged = applyFact(day, { pr: 7, state: 'merged' }, 5)
  expect(merged.rows[0]?.state).toBe('merged')
  expect(merged.updatedAt).toBe(5)
  expect(applyFact(merged, { ticket: 'abc123', state: 'review' }, 9)).toBe(merged)
  expect(applyFact(merged, { ticket: 'abc123', state: 'blocked' }, 9)).toBe(merged)
  expect(applyFact(day, { ticket: 'SN-1', state: 'blocked' }, 9).rows[0]?.state).toBe('blocked')
  expect(applyFact(day, { pr: 8, state: 'merged' }, 9)).toBe(day)
  expect(applyFact(day, { pr: 99, state: 'merged' }, 9)).toBe(day)
})


test('isTyped is true only for a prompt that a person wrote', () => {
  expect(isTyped({ text: 'Fix the cart', origin: { kind: 'composer' } })).toBe(true)
  expect(isTyped({ text: 'Fix the cart', origin: { kind: 'bridge' } })).toBe(true)
  expect(isTyped({ text: 'Fix the cart' })).toBe(true)
  expect(isTyped({ text: 'ci: PR 7 is red', origin: { kind: 'plugin' } })).toBe(false)
  expect(isTyped({ text: '<task-notification>done</task-notification>', origin: { kind: 'composer' } })).toBe(false)
  expect(isTyped({ text: 'status', command: {}, origin: { kind: 'composer' } })).toBe(false)
  expect(isTyped({ text: 'x', isMeta: true, origin: { kind: 'composer' } })).toBe(false)
  expect(isTyped({ text: '  ', origin: { kind: 'composer' } })).toBe(false)
})

test('said counts the wait one time, and the time of the person from 30 seconds to 5 minutes', () => {
  const first = said(undefined, 1_000)
  expect(first).toEqual({ mine: 1, mineMs: 30_000, waitMs: 0, busyMs: 0 })
  const idle = turned(turned(first), 100_000, 60_000)
  expect(idle).toEqual({ mine: 1, mineMs: 30_000, waitMs: 0, busyMs: 60_000, idleSince: 100_000 })
  const quick = said(idle, 110_000)
  expect(quick.mineMs).toBe(60_000)
  expect(quick.waitMs).toBe(10_000)
  const again = said(quick, 112_000)
  expect(again.waitMs).toBe(12_000)
  expect(again.mine).toBe(3)
  const away = said(turned(turned(first), 100_000, 60_000), 100_000 + 3_600_000)
  expect(away.waitMs).toBe(3_600_000)
  expect(away.mineMs).toBe(30_000 + 300_000)
  expect(turned(away).idleSince).toBeUndefined()
})

test('timeFacts gives the total, the work time and the share of the person', () => {
  expect(timeFacts({ turns: 0, nodes: [] }, 5)).toBeUndefined()
  const facts = timeFacts(
    {
      since: 0,
      turns: 5,
      me: { mine: 2, mineMs: 360_000, waitMs: 900_000, busyMs: 1_800_000 },
      nodes: [{ id: 'main', label: 'Main', kind: 'main', status: 'running', startedAt: 3_000_000, calls: 0, errors: 0 }],
    },
    3_600_000,
  )
  expect(facts).toEqual({ totalMs: 3_600_000, busyMs: 2_400_000, mineMs: 360_000, waitMs: 900_000, mine: 2, auto: 3, share: 10 })
  if (facts === undefined) return
  expect(timeLines(facts)[0]).toBe('Total 1h 00m · Claude worked 40m 00s · 3 turns started with no message of yours')
  expect(timeLines(facts)[1]).toBe('You: 2 messages · about 6m 00s of your time (10%) · the work waited 15m 00s for you')
})
