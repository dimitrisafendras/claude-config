import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'flow-view',
  component: 'Pane',
  requestId: 'flow-view',
  props: {
    title: 'Workflow',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const NOW = Date.parse('2026-11-22T12:00:00Z')

const FILLED: string[] = []

// Each hook here stands for the engine: nothing sits beneath the mod.
function world(on: On) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: '/work/web-app' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }))
  on('prompt.fill', (_, e) => (FILLED.push(`${e.mode}:${e.text}`), { isFilled: true }))

  return clock
}

type Ui = { findAll: (q: { type: 'Svg' | 'Link' }) => Promise<{ props: { source?: unknown } }[]> }

// Every drawing on the screen, as one text.
async function drawn(ui: Ui): Promise<string> {
  return (await ui.findAll({ type: 'Svg' })).map(one => String(one.props.source ?? '')).join('\n')
}

test('a session is one row, and a press opens its steps and agents', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Fix the login bug', turnId: 't1' })
  await $.tool.call({
    tool: 'mcp__ccd_turn__update_plan',
    items: [
      { content: 'Read the code', status: 'in_progress' },
      { content: 'Write the fix', status: 'pending' },
    ],
  })
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })
  await $.agent.spawn({
    tool_use_id: 'u1',
    prompt: 'Find the bug',
    description: 'Bug hunt',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'sonnet',
    background: false,
    fork: false,
  })
  await clock.advance(3000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-sessions' })
  expect((await ui.find({ key: 'session-session-1' }))?.text).toMatch(/Fix the login bug.*this session.*1\/2 steps.*1 agent\b/)
  expect(await drawn(ui)).toBe('')

  await ui.press({ key: 'session-session-1' })
  const open = await drawn(ui)
  expect(open).toContain('1 of 2 done')
  expect(open).toContain('Bug hunt')

  await ui.press({ key: 'session-session-1' })
  expect(await drawn(ui)).toBe('')
  await ui.unmount()
})

test('a system notice does not become the session title', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '<task-notification>done</task-notification>', turnId: 't1' })
  await clock.advance(3000)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-sessions' })
  const row = (await ui.find({ key: 'session-session-1' }))?.text ?? ''
  expect(row).toContain('web-app')
  expect(row).not.toContain('task-notification')
  await ui.unmount()
})

test('the demo plays a day with tickets and several sessions', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'demo' })
  await clock.advance(10000)
  expect((await ui.find({ key: 'ticket-r01' }))?.text).toMatch(/#1 Login fails after a token refresh/)
  expect(await ui.find({ type: 'Text', text: /running 2\/5/ })).toBeDefined()
  const plan = await drawn(ui)
  expect(plan).toContain('START WORK')
  // A card does not open: no breakdown drawing. Each card has a track, also a ticket that is off the way.
  expect(plan).not.toContain('BREAKDOWN')
  expect(plan).toContain('stopped here')

  // An active ticket draws its track and shows its quick actions with no press.
  expect(await drawn(ui)).toContain('<title>running: now</title>')
  expect(await ui.find({ key: 'act-status-r05' })).toBeDefined()
  FILLED.length = 0
  await ui.press({ key: 'act-status-r01' })
  await ui.press({ key: 'act-ref-r01' })
  expect(FILLED[0]).toMatch(/^replace:Give me the status of ticket "#1 Login fails after a token refresh"/)
  expect(FILLED[1]).toMatch(/^insert:ticket "#1 Login fails after a token refresh"/)

  // A count tile is a button: a press shows only its tickets.
  expect((await ui.find({ key: 'filter-needs' }))?.text).toMatch(/2\s+Needs you/)
  await ui.press({ key: 'filter-needs' })
  expect(await ui.find({ key: 'ticket-r05' })).toBeDefined()
  expect(await ui.find({ key: 'ticket-r01' })).toBeUndefined()
  await ui.press({ key: 'filter-needs' })
  expect(await ui.find({ key: 'ticket-r01' })).toBeDefined()
  await ui.press({ key: 'filter-running' })
  await ui.press({ key: 'filter-all' })
  expect(await ui.find({ key: 'ticket-r05' })).toBeDefined()

  await ui.press({ key: 'tab-sessions' })
  await ui.press({ key: 'session-demo-1' })
  const run = await drawn(ui)
  expect(run).toContain('#1 Add the tests')
  expect(run).toContain('Review the branch')

  await ui.press({ key: 'demo' })
  await clock.advance(3000)
  expect(await ui.find({ key: 'session-demo-1' })).toBeUndefined()
  await ui.unmount()
})

test('the plan of /start-work shows as tickets, and each card shows its facts with no press', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'desktop', isInteractive: true })
  await $.tool.call({
    tool: 'ArtifactData',
    action: 'batch',
    url: 'https://claude.ai/artifact/x',
    writes: [
      { op: 'set', collection: 'days', doc_id: '2026-11-22', data: { phase: 'running', headline: 'Two rows today', needsYou: ['Sign in to the board'] } },
      { op: 'set', collection: 'days/2026-11-22/rows', doc_id: 'r01', data: { n: 1, title: 'Fix the cart total', repo: 'shop', surface: 'web', sev: 3, size: 'S', state: 'running', branch: 'fix/cart', session: 'lane-web' } },
      { op: 'set', collection: 'days/2026-11-22/rows', doc_id: 'r02', data: { n: 2, title: 'Add the invoice page', repo: 'shop', surface: 'web', state: 'queued' } },
      { op: 'set', collection: 'days/2026-11-22/sessions', doc_id: 'lane-web', data: { name: 'lane-web', kind: 'session', title: 'Lane web', state: 'running' } },
      { op: 'set', collection: 'days/2026-11-22/sessions', doc_id: 'cart-agent', data: { name: 'cart-agent', kind: 'agent', title: 'Cart agent', state: 'running', branch: 'fix/cart--sum' } },
    ],
  })
  await $.tool.call({
    tool: 'ArtifactData',
    action: 'update',
    url: 'https://claude.ai/artifact/x',
    collection: 'days/2026-11-22/rows',
    doc_id: 'r02',
    data: { state: 'review', prNumber: 7, ci: 'pending' },
  })
  await clock.advance(3000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await drawn(ui)).toContain('2026-11-22')
  // The notes start folded: one line gives their count, and a press shows them with the summary of the day.
  expect((await ui.find({ key: 'notes' }))?.text).toMatch(/1 note for you/)
  expect(await ui.find({ type: 'Text', text: /Sign in to the board/ })).toBeUndefined()
  await ui.press({ key: 'notes' })
  expect(await ui.find({ type: 'Text', text: /Sign in to the board/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Two rows today/ })).toBeDefined()
  await ui.press({ key: 'notes' })
  expect((await ui.find({ key: 'ticket-r02' }))?.text).toMatch(/#2 Add the invoice page/)
  expect(await ui.find({ type: 'Text', text: /review 3\/5/ })).toBeDefined()

  // Each card names who works on its ticket, with no press. A press on a title puts the name in the chat input.
  expect(await ui.find({ type: 'Text', text: /Lane web · 1 agent \(1 run\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /shop · web · S · sev 3 · fix\/cart/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /PR #7/ })).toBeDefined()
  FILLED.length = 0
  await ui.press({ key: 'ticket-r02' })
  expect(FILLED[0]).toMatch(/^insert:ticket "#2 Add the invoice page"/)
  await ui.unmount()
})

test('a count tile for queued tickets, and a toggle for the running sessions', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'demo' })
  await clock.advance(1000)
  expect((await ui.find({ key: 'demo' }))?.text).toMatch(/Stop demo/)
  expect((await ui.find({ key: 'filter-queued' }))?.text).toMatch(/Queued/)
  await ui.press({ key: 'filter-queued' })
  expect(await ui.find({ key: 'ticket-r04' })).toBeDefined()
  expect(await ui.find({ key: 'ticket-r05' })).toBeUndefined()

  await ui.press({ key: 'tab-sessions' })
  expect(await ui.find({ key: 'session-demo-2' })).toBeDefined()
  await ui.press({ key: 'only-live' })
  expect(await ui.find({ key: 'session-demo-2' })).toBeUndefined()
  expect(await ui.find({ key: 'session-demo-0' })).toBeDefined()
  await ui.unmount()
})

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }

test('/flow has a status, a tab switch, a clear and a help line', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'Fix it', turnId: 't1' })
  await clock.advance(3000)

  expect((await $.command.run({ command: 'flow', args: 'status', ...RUN })).text).toMatch(/1 session \(1 run\)\. Plan none: 0 tickets, 0 need you\./)
  expect((await $.command.run({ command: 'flow', args: 'sessions', ...RUN })).text).toBe('Workflow pane shows sessions.')
  expect((await $.command.run({ command: 'flow', args: 'what', ...RUN })).text).toMatch(/^Use \/flow/)

  await $.command.run({ command: 'flow', args: 'demo', ...RUN })
  await clock.advance(1000)
  expect((await $.command.run({ command: 'flow', args: 'clear', ...RUN })).text).toMatch(/^Removed \d+ saved plan or demo items?\./)
  expect((await $.command.run({ command: 'flow', args: 'status', ...RUN })).text).toMatch(/Plan none/)
})

test('a ticket row shows its PR and the mark of its CI', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'demo' })
  await clock.advance(46000)
  await ui.press({ key: 'fold-done' })
  expect(await ui.find({ type: 'Text', text: /PR #101/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ CI/ })).toBeDefined()
  await ui.unmount()
})

test('the demo plan goes away five minutes after the demo ends', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'demo' })
  await clock.advance(46000)
  await ui.press({ key: 'fold-done' })
  expect(await ui.find({ key: 'ticket-r01' })).toBeDefined()
  await clock.advance(6 * 60 * 1000)
  expect(await ui.find({ key: 'ticket-r01' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /No plan yet/ })).toBeDefined()
  await ui.unmount()
})

test('a merge and a board move in this session update the ticket without a monitor write', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'desktop', isInteractive: true })
  await $.tool.call({
    tool: 'ArtifactData',
    action: 'batch',
    url: 'https://claude.ai/artifact/x',
    writes: [
      { op: 'set', collection: 'days', doc_id: '2026-11-22', data: { phase: 'running' } },
      { op: 'set', collection: 'days/2026-11-22/rows', doc_id: 'r01', data: { n: 1, title: 'Fix the cart total', state: 'review', prNumber: 7 } },
      { op: 'set', collection: 'days/2026-11-22/rows', doc_id: 'r02', data: { n: 2, title: 'Add the invoice page', url: 'https://app.example.com/t/abc123', state: 'queued' } },
    ],
  } as never)
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 7 --squash' } as never)
  await $.tool.call({ tool: 'mcp__board__update_task', task_id: 'abc123', status: 'in progress' } as never)
  await clock.advance(3000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'fold-done' })
  expect((await ui.find({ key: 'ticket-r01' }))?.text).toMatch(/Fix the cart total/)
  expect(await ui.find({ type: 'Text', text: /merged 4\/5/ })).toBeDefined()
  expect((await ui.find({ key: 'ticket-r02' }))?.text).toMatch(/Add the invoice page/)
  expect(await ui.find({ type: 'Text', text: /running 2\/5/ })).toBeDefined()
  await ui.unmount()
})


test('the Time section counts the messages of the person, not the turns that a notice starts', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Fix the login bug', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'Fix the login bug', turnId: 't1' })
  await clock.advance(600_000)
  await $.turn.complete({ turnId: 't1', reason: 'done', answer: 'Done.' } as never)
  await clock.advance(120_000)
  await $.prompt.submit({ text: 'Now add a test', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'Now add a test', turnId: 't2' })
  await clock.advance(300_000)
  await $.turn.complete({ turnId: 't2', reason: 'done', answer: 'Done.' } as never)
  await clock.advance(60_000)
  await $.prompt.submit({ text: 'ci: PR 7 is green', wait: false, origin: { kind: 'plugin' } } as never)
  await $.turn.start({ text: 'ci: PR 7 is green', turnId: 't3' })
  await clock.advance(120_000)
  await $.turn.complete({ turnId: 't3', reason: 'done', answer: 'Done.' } as never)

  const status = (await $.command.run({ command: 'flow', args: 'status', ...RUN })).text
  expect(status).toMatch(/Total 20m 00s · Claude worked 17m 00s · 1 turn started with no message of yours/)
  expect(status).toMatch(/You: 2 messages · about 2m 30s of your time \(13%\) · the work waited 2m 00s for you/)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /You: 2 messages/ })).toBeDefined()
  await ui.unmount()
})

test('a group folds, and a ticket shows its steps, its time and the part of the person', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Start the day', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'Start the day', turnId: 't1' })
  await $.tool.call({
    tool: 'ArtifactData',
    action: 'batch',
    url: 'https://claude.ai/artifact/x',
    writes: [
      { op: 'set', collection: 'days', doc_id: '2026-11-22', data: { phase: 'running' } },
      { op: 'set', collection: 'days/2026-11-22/rows', doc_id: 'r01', data: { n: 1, title: 'Fix the cart total', state: 'running', prNumber: 7 } },
      { op: 'set', collection: 'days/2026-11-22/rows', doc_id: 'r02', data: { n: 2, title: 'Add the invoice page', state: 'queued' } },
    ],
  } as never)
  await clock.advance(600_000)
  await $.turn.complete({ turnId: 't1', reason: 'done', answer: 'Done.' } as never)
  await clock.advance(120_000)
  await $.prompt.submit({ text: 'Merge it', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'Merge it', turnId: 't2' })
  await clock.advance(480_000)
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 7 --squash' } as never)
  await clock.advance(3000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'filter-done' }))?.text).toMatch(/1\s+Done/)
  // The done group starts folded. A press opens it, and a second press folds it again.
  expect((await ui.find({ key: 'fold-done' }))?.text).toMatch(/▸ ✓ DONE\s+1/)
  expect(await ui.find({ key: 'ticket-r01' })).toBeUndefined()
  await ui.press({ key: 'fold-done' })
  expect((await ui.find({ key: 'fold-done' }))?.text).toMatch(/▾ ✓ DONE\s+1/)
  expect(await ui.find({ key: 'ticket-r01' })).toBeDefined()
  await ui.press({ key: 'fold-done' })
  expect(await ui.find({ key: 'ticket-r01' })).toBeUndefined()
  expect(await ui.find({ key: 'ticket-r02' })).toBeDefined()
  await ui.press({ key: 'fold-done' })
  // The time of a ticket shows on its card with no press. A ticket with no time has no time text.
  expect(await ui.find({ type: 'Text', text: /⏱ 20m 00s · you about 2m 00s \(10%\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /not measured/ })).toBeUndefined()
  await ui.unmount()
})

test('the Prompts tab counts the prompts that the person typed, keeps them, and fills the chat input', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'desktop', isInteractive: true })
  for (const text of ['Merge PR 12', 'merge pr 13', 'Fix the login']) {
    await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
    await clock.advance(1000)
  }
  await $.prompt.submit({ text: 'ci: PR 7 is red', wait: false, origin: { kind: 'plugin', name: 'ci-watch' } })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-prompts' })
  expect(await ui.find({ type: 'Text', text: /^33%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2x/ })).toBeDefined()
  FILLED.length = 0
  const make = (await ui.findAll({ type: 'Button' })).find(b => String(b.props.key).startsWith('auto-'))
  await ui.press({ key: String(make?.props.key) })
  expect(FILLED[0]).toMatch(/^replace:I said this 2 times: "merge pr 13"/)
  await ui.press({ key: 'once' })
  expect(await ui.find({ type: 'Text', text: /○ Fix the login/ })).toBeDefined()
  await ui.unmount()
})

test('an active ticket with a link has a link that the browser opens, and a ticket with no link has none', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'desktop', isInteractive: true })
  await $.tool.call({
    tool: 'ArtifactData',
    action: 'batch',
    url: 'https://claude.ai/artifact/x',
    writes: [
      { op: 'set', collection: 'days', doc_id: '2026-11-22', data: { phase: 'running' } },
      { op: 'set', collection: 'days/2026-11-22/rows', doc_id: 'r01', data: { n: 1, title: 'With a link', url: 'https://app.example.com/t/abc', state: 'running' } },
      { op: 'set', collection: 'days/2026-11-22/rows', doc_id: 'r02', data: { n: 2, title: 'No link', state: 'running' } },
    ],
  } as never)
  await clock.advance(3000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const links = await ui.findAll({ type: 'Link' })
  expect(links.map(l => l.props.href)).toEqual(['https://app.example.com/t/abc'])
  await ui.unmount()
})

test('the All tile is first, counts every ticket, and shows them all again', async ($, on) => {
  const clock = world(on)
  await $.session.start({ cwd: '/work/web-app', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'demo' })
  await clock.advance(10000)
  expect((await ui.find({ key: 'filter-all' }))?.text).toMatch(/6\s+All/)
  await ui.press({ key: 'filter-running' })
  expect(await ui.find({ key: 'ticket-r05' })).toBeUndefined()
  await ui.press({ key: 'filter-all' })
  expect(await ui.find({ key: 'ticket-r05' })).toBeDefined()
  await ui.unmount()
})
