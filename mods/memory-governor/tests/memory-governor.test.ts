import { expect, mock, test } from 'claude-code/testing'
import type { On, ProcessRunResult } from 'claude-code'

// Nothing sits beneath the plugin: each hook here stands for the engine.
function engine(on: On, budget: { line: string; exitCode: number }, env: Record<string, string> = { HOME: '/Users/test' }) {
  const runs: string[][] = []
  const notes: string[] = []
  const statuses: (string | undefined)[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  mock.env(on, env)
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const value: ProcessRunResult =
      e.argv[0] === 'ps'
        ? { exitCode: 0, stdout: ' 900000 /usr/bin/node\n 400000 vitest\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        : { exitCode: budget.exitCode, stdout: budget.line + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    return { value }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    notes.push(e.text)
    return { value: { isSent: true, channel: 'terminal_bell' } }
  })
  on('command.register', () => ({ value: { command: 'memgov' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', (_, e) => ({ model: e.model ?? e.parentModel, agentId: 'a1' }))
  return { runs, notes, statuses, clock }
}

const ROOM = { line: 'free=75% total=24576MB heavy_procs=0 room_for_heavy_jobs=3 (floor 30%, ~3500MB/job)', exitCode: 0 }
const FULL = { line: 'free=22% total=24576MB heavy_procs=3 room_for_heavy_jobs=0 (floor 30%, ~3500MB/job)', exitCode: 1 }

const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const SPAWN = {
  tool_use_id: 'tu1',
  prompt: 'implement the thing',
  description: 'thing',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-4-7',
  background: true,
  fork: false,
}

test('the budget script runs at start and every minute, and the status shows it', async ($, on) => {
  const budget = { ...ROOM }
  const { runs, statuses, clock } = engine(on, budget)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(runs[0]).toEqual(['bash', '/Users/test/.claude/mem-budget.sh'])
  expect(statuses).toContain('mem 75% · room 3')

  await clock.advance(60_000)
  expect(runs.filter(r => r[0] === 'bash').length).toBe(2)
})

test('no room: a general agent is refused, Explore and haiku agents run', async ($, on) => {
  const { clock } = engine(on, { ...FULL })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const refused = await $.agent.spawn(SPAWN)
  expect(refused.deny).toMatch(/memory-governor: free memory is 22%.*\/memgov off/)
  expect((await $.agent.spawn({ ...SPAWN, subagentType: 'Explore' })).deny).toBeUndefined()
  expect((await $.agent.spawn({ ...SPAWN, model: 'haiku' })).deny).toBeUndefined()
})

test('no room: heavy Bash jobs are refused, light ones and scoped tests run', async ($, on) => {
  const { clock } = engine(on, { ...FULL })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  for (const command of ['npm ci', 'cd app && pnpm install', 'npx vitest run', 'xcodebuild -scheme App', 'CI=1 npx expo run:ios']) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toMatch(/memory-governor/)
  }
  for (const command of ['ls', 'npx vitest run src/a.test.ts', 'git status', 'echo npm ci']) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toBeUndefined()
  }
})

test('below the floor it notifies once, not every minute', async ($, on) => {
  const { notes, clock } = engine(on, { ...FULL })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await clock.advance(60_000)
  await clock.advance(60_000)
  expect(notes.length).toBe(1)
  expect(notes[0]).toMatch(/22% is below the 30% floor.*node/)
})

test('a new reading changes the decision, and /memgov off lets all through', async ($, on) => {
  const budget = { ...ROOM }
  const { runs, clock } = engine(on, budget)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  budget.line = FULL.line
  budget.exitCode = 1
  // The minute timer takes the new reading.
  const before = runs.length
  await clock.advance(200_000)
  expect(runs.length).toBeGreaterThan(before)
  expect((await $.agent.spawn(SPAWN)).deny).toMatch(/no room for another agent/)

  const off = await $.command.run({ ...CMD, command: 'memgov', args: 'off' })
  expect(off.text).toMatch(/off/)
  expect((await $.agent.spawn(SPAWN)).deny).toBeUndefined()
  const status = await $.command.run({ ...CMD, command: 'memgov', args: 'status' })
  expect(status.text).toMatch(/Denies made: 1\./)
})

test('with no HOME (Windows) the budget script comes from USERPROFILE', async ($, on) => {
  const { runs, clock } = engine(on, { ...ROOM }, { USERPROFILE: 'C:/Users/me' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(runs[0]).toEqual(['bash', 'C:/Users/me/.claude/mem-budget.sh'])
})
