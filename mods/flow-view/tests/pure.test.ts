import { expect, test } from 'claude-code/testing'

import { drawOverview, drawTrack, cardFacts, ticketCrew, ACTIONS, automateText, countPrompt, promptKey, reportPrompts, ago, applyFact, facts, phaseParts, groupTickets, stepParts, ticketRef, shareTime, stepList, stepOf, ticketTime, timed, isTyped, said, timeFacts, timeLines, turned, bucket, capTools, card, ciMark, clip, nodeHue, isBoard, isPeer, merge, toPeer, demoBoard, demoPeers, drawPhases, drawRun, drawTicket, failedAgents, plan, plural, sortPeers, sortTickets, span, stamp, ticketFacts, tip, tone } from '../hooks/register'

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
  expect(src).toContain('OF THE DAY')
  expect(src).toContain('<title>')
  // No count that the tiles give: the bar, its line and the legend are gone.
  expect(src).not.toContain('tickets done')
  expect(drawPhases({ ...day, rows: [] }).source).toContain('no tickets')
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

test('stepOf shows how far a ticket is, and no step for a ticket that waits for the person', () => {
  expect(stepOf('queued').text).toBe('●○○○○ queued 1/5')
  expect(stepOf('review').text).toBe('●●●○○ review 3/5')
  expect(stepOf('draft').at).toBe(3)
  expect(stepOf('verified').text).toBe('●●●●● verified 5/5')
  expect(stepOf('closed').at).toBe(5)
  expect(stepOf('needs-you')).toEqual({ total: 5, text: 'needs-you' })
  expect(stepOf('blocked').at).toBeUndefined()
})

test('groupTickets puts what needs the person first and what is done last', () => {
  const row = (id: string, state: string) => ({ id, title: id, state })
  const groups = groupTickets([row('a', 'verified'), row('b', 'needs-you'), row('c', 'running'), row('d', 'merged'), row('e', 'blocked')])
  expect(groups.map(g => `${g.label}:${g.rows.map(r => r.id).join('')}`)).toEqual(['NEEDS YOU:be', 'IN PROGRESS:c', 'DONE:ad'])
  expect(groupTickets([])).toEqual([])
})

test('the steps of a ticket have one colour, the colour of its card, and a step to do is dim', () => {
  const parts = stepParts('review', '#c084fc')
  expect(parts.map(p => p.mark).join('')).toBe('✓✓◉○○')
  expect(parts[2]?.isNow).toBe(true)
  expect(new Set(parts.slice(0, 3).map(p => p.hue))).toEqual(new Set(['#c084fc']))
  expect(parts[3]?.hue).toBe(parts[4]?.hue)
  expect(parts[3]?.hue).not.toBe('#c084fc')
  expect(stepParts('blocked')).toEqual([])
})

test('each card has a track of the same size, also a ticket that is off the way', () => {
  const on = drawTrack('review', '#c084fc')
  const off = drawTrack('needs-you', '#fbbf24')
  expect(off.units).toBe(on.units)
  expect(off.tall).toBe(on.tall)
  expect(on.source).not.toContain('#22d3ee')
  expect(off.source).toContain('#fbbf24')
  expect(off.source).toContain('off the way')
})

test('the facts of a card have no dash for a value that is not known, and the crew names the sessions', () => {
  const t = { id: 'r', title: 'T', state: 'needs-you', repo: 'org/app', surface: '-', size: '-', model: '-', sev: 0, source: 'board', ci: 'none' }
  expect(cardFacts(t)).toBe('org/app · board')
  const w = [{ id: 's1', name: 'lane', kind: 'session', title: 'Lane web', state: 'running', branch: 'fix/a' }, { id: 'a1', kind: 'agent', title: 'Cart agent', state: 'running', branch: 'fix/a-cart' }]
  expect(ticketCrew({ id: 'r', title: 'T', state: 'running', branch: 'fix/a', session: 'lane' }, w)).toBe('Lane web · 1 agent (1 run)')
  expect(ticketCrew({ id: 'q', title: 'T', state: 'queued' }, w)).toBe('')
})

test('a quick action makes a text that names the ticket', () => {
  const ref = ticketRef({ id: 'r1', n: 4, title: 'Fix the cart', state: 'review', prNumber: 7, url: 'https://board.test/t/4' })
  expect(ref).toBe('ticket "#4 Fix the cart" (PR #7) https://board.test/t/4')
  expect(ACTIONS.map(a => a.key)).toEqual(['ref', 'status', 'continue', 'verify'])
  expect(ACTIONS[1]?.text(ref)).toContain(ref)
  expect(ticketRef({ id: 'r2', title: 'No number', state: 'queued' })).toBe('ticket "No number"')
})

test('stepList names each step and marks the current one', () => {
  expect(stepList('review')).toBe('✓ queued  →  ✓ running  →  ◉ review  →  ○ merged  →  ○ verified')
  expect(stepList('verified')).toBe('✓ queued  →  ✓ running  →  ✓ review  →  ✓ merged  →  ✓ verified')
  expect(stepList('needs-you')).toBe('! Waits for you')
  expect(stepList('blocked')).toBe('✗ Blocked')
})

test('timed starts the time when work starts and ends it when the ticket is done', () => {
  const queued = timed(undefined, { id: 'r1', title: 'One', state: 'queued' }, 10)
  expect(queued.startedAt).toBeUndefined()
  const running = timed(queued, { ...queued, state: 'running' }, 20)
  expect(running.startedAt).toBe(20)
  expect(running.endedAt).toBeUndefined()
  const merged = timed({ ...running, mine: 2, mineMs: 90 }, { id: 'r1', title: 'One', state: 'merged' }, 50)
  expect(merged).toEqual({ id: 'r1', title: 'One', state: 'merged', startedAt: 20, endedAt: 50, mine: 2, mineMs: 90 })
  expect(timed(merged, { ...merged, state: 'verified' }, 80).endedAt).toBe(50)
  expect(timed(merged, { ...merged, state: 'running' }, 90).endedAt).toBeUndefined()
})

test('shareTime gives the time of the person to the open tickets in equal parts', () => {
  const day = { id: 'd', phase: 'running', needsYou: [], updatedAt: 1, workers: [], rows: [
    { id: 'r1', title: 'One', state: 'running', startedAt: 5 },
    { id: 'r2', title: 'Two', state: 'review', startedAt: 6, mine: 1, mineMs: 10_000 },
    { id: 'r3', title: 'Three', state: 'merged', startedAt: 1, endedAt: 4 },
    { id: 'r4', title: 'Four', state: 'queued' },
  ] }
  const next = shareTime(day, 60_000, 9)
  expect(next.rows.map(r => r.mineMs)).toEqual([30_000, 40_000, undefined, undefined])
  expect(next.rows.map(r => r.mine)).toEqual([1, 2, undefined, undefined])
  expect(shareTime({ ...day, rows: [day.rows[2]!, day.rows[3]!] }, 60_000, 9).rows[0]?.mineMs).toBeUndefined()
  expect(shareTime(day, 0, 9)).toBe(day)
})

test('ticketTime gives the time of the ticket and the part of the person', () => {
  expect(ticketTime({ id: 'r', title: 'T', state: 'queued' }, 100)).toBe('')
  expect(ticketTime({ id: 'r', title: 'T', state: 'merged', startedAt: 0, endedAt: 3_600_000, mineMs: 360_000 }, 9_999_999)).toBe('1h 00m · you about 6m 00s (10%)')
  expect(ticketTime({ id: 'r', title: 'T', state: 'running', startedAt: 0 }, 600_000)).toBe('10m 00s so far · you about 0ms (0%)')
})

test('a closed day with open tickets does not show a green done step', () => {
  const row = (id: string, state: string) => ({ id, title: id, state })
  const day = { id: 'd', phase: 'done', needsYou: [], updatedAt: 1, workers: [], rows: [row('a', 'verified'), row('b', 'needs-you'), row('c', 'review')] }
  const open = drawPhases(day).source
  expect(open).toContain('closed, 2 open')
  expect(open).toContain('33%')
  expect(open).toContain('<title>need you: 1</title>')
  expect(open).not.toContain('blocked: 0')
  const all = drawPhases({ ...day, rows: [row('a', 'verified'), row('d', 'merged')] }).source
  expect(all).not.toContain('closed,')
  expect(open).toContain('>2 open</text>')
  expect(all).toContain('>done</text>')
  expect(all).toContain('100%')
})

test('phaseParts counts blocked and queued tickets as their own parts', () => {
  const row = (id: string, state: string) => ({ id, title: id, state })
  const parts = phaseParts([row('a', 'verified'), row('b', 'needs-you'), row('c', 'blocked'), row('d', 'failed'), row('e', 'queued'), row('f', 'running'), row('g', 'draft')])
  expect(parts.map(p => `${p.key}:${p.n}`)).toEqual(['done:1', 'running:1', 'review:1', 'needs:1', 'blocked:2', 'queued:1'])
  const src = drawPhases({ id: 'd', phase: 'running', needsYou: [], updatedAt: 1, workers: [], rows: [row('c', 'blocked'), row('e', 'queued'), row('a', 'merged')] }).source
  expect(src).toContain('<title>blocked: 1</title>')
  expect(src).toContain('<title>queued: 1</title>')
  expect(src).toContain('33%')
  const timed = drawPhases({ id: 'd', phase: 'running', needsYou: [], updatedAt: 1, workers: [], rows: [row('a', 'merged')] }, { totalMs: 3_600_000, busyMs: 1_800_000, auto: 2, mine: 4, mineMs: 600_000, share: 17, waitMs: 120_000 })
  expect(timed.source).toContain('your time')
  expect(timed.source).toContain('17%')
  expect(timed.tall).toBeGreaterThan(drawPhases({ id: 'd', phase: 'running', needsYou: [], updatedAt: 1, workers: [], rows: [] }).tall)
})

test('promptKey makes prompts that differ in a number, a link, an id or a quoted name the same', () => {
  expect(promptKey('Merge PR 12!')).toBe(promptKey('merge pr   13'))
  expect(promptKey('Verify ticket "#4 Fix the cart" on staging')).toBe(promptKey('verify ticket "#9 Other work" on staging'))
  expect(promptKey('Look at https://a.test/x and SN-12')).toBe(promptKey('look at https://b.test/y and SN-99'))
  expect(promptKey('Merge it')).not.toBe(promptKey('Fix it'))
  expect(promptKey('   ')).toBe('')
})

test('countPrompt counts a repeat once more, keeps the last text, and skips an empty prompt', () => {
  let list = countPrompt([], 'Merge PR 12', 100)
  list = countPrompt(list, 'merge pr 13', 200)
  list = countPrompt(list, 'Fix the login', 300)
  expect(list).toHaveLength(2)
  expect(list[0]).toMatchObject({ n: 2, first: 100, last: 200, text: 'merge pr 13' })
  expect(countPrompt(list, '  ', 400)).toBe(list)
})

test('countPrompt drops the oldest single prompt when the list is full', () => {
  let list = [] as ReturnType<typeof countPrompt>
  for (let i = 0; i < 400; i++) list = countPrompt(list, `topic ${i.toString(26).replace(/\d/g, d => 'qrstuvwxyz'[Number(d)] ?? 'q')} prompt`, i)
  list = countPrompt(list, 'merge it', 999)
  expect(list).toHaveLength(400)
  expect(list.some(s => s.key === 'merge it')).toBe(true)
  expect(list.some(s => s.first === 0)).toBe(false)
})

test('reportPrompts puts the prompts said again first, and gives the share of repeats', () => {
  const list = [
    { key: 'a', text: 'a', n: 1, first: 10, last: 10 },
    { key: 'b', text: 'b', n: 5, first: 5, last: 50 },
    { key: 'c', text: 'c', n: 2, first: 20, last: 60 },
  ]
  const r = reportPrompts(list)
  expect(r.total).toBe(8)
  expect(r.unique).toBe(3)
  expect(r.repeated.map(s => s.key)).toEqual(['b', 'c'])
  expect(r.once.map(s => s.key)).toEqual(['a'])
  expect(r.share).toBe(63)
  expect(r.since).toBe(5)
  expect(reportPrompts([])).toMatchObject({ total: 0, share: 0, since: 0 })
  expect(automateText(list[1]!)).toContain('5 times: "b"')
})

test('drawOverview draws one arc for each group and gives the share that is done', () => {
  const row = (id: string, state: string) => ({ id, title: id, state })
  const rows = [row('a', 'verified'), row('b', 'merged'), row('c', 'running'), row('d', 'queued')]
  const drawing = drawOverview(rows)
  expect(drawing.source).toContain('50%')
  expect(drawing.source).toContain('2 of 4 done')
  expect(drawing.source.match(/stroke-dasharray/g)).toHaveLength(3)
  expect(drawOverview([]).source).toContain('0%')
})
