import { expect, mock, test } from 'claude-code/testing'
import type { On, ProcessRunResult } from 'claude-code'

import { automaticSource, capMessage, dayOf, parseCount, takeTurn } from '../hooks/register'

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
        : e.argv[1]?.endsWith('mem-free.sh')
          ? { exitCode: 0, stdout: 'Docker: not running.\nmem-free: stopped 1 docker project(s), quit 0 app(s)\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
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
  const { notes, runs, clock } = engine(on, { ...FULL })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await clock.advance(60_000)
  await clock.advance(60_000)
  expect(notes.length).toBe(1)
  expect(notes[0]).toMatch(/22% is below the 30% floor.*node/)
  expect(notes[0]).toMatch(/mem-free: stopped 1 docker project/)
  expect(runs.filter(a => a[1]?.endsWith('mem-free.sh')).length).toBe(1)
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

// ---------- the shared daily cap of automatic turns ----------

const NOW = Date.parse('2026-11-25T12:00:00')
const TURNS = '/Users/test/.claude/autonomy/turns.json'

test('automaticSource: plugin, scheduled and coordinator prompts are automatic; a person is not', () => {
  expect(automaticSource({ kind: 'plugin', name: 'ci-watch' })).toBe('ci-watch')
  expect(automaticSource({ kind: 'scheduled-trigger' })).toBe('scheduled task')
  expect(automaticSource({ kind: 'coordinator' })).toBe('coordinator hand-off')
  expect(automaticSource({ kind: 'composer' })).toBeUndefined()
  expect(automaticSource({ kind: 'peer-send-message' })).toBeUndefined()
  expect(automaticSource(undefined)).toBeUndefined()
})

test('parseCount and takeTurn: one count per local day, refused at the cap', () => {
  const day = dayOf(NOW)
  expect(day).toBe('2026-11-25')
  expect(parseCount(undefined, day)).toEqual({ day, count: 0, cap: 60, by: {} })
  expect(parseCount('not json', day).count).toBe(0)
  expect(parseCount(JSON.stringify({ day: '2026-11-24', count: 59, by: {} }), day).count).toBe(0)
  const old = parseCount(JSON.stringify({ day, count: 3, by: { 'ci-watch': 3 } }), day)
  const one = takeTurn(old, 'ops-board')
  expect(one.isAllowed).toBe(true)
  expect(one.count).toEqual({ day, count: 4, cap: 60, by: { 'ci-watch': 3, 'ops-board': 1 } })
  const full = takeTurn({ day, count: 60, cap: 60, by: {} }, 'ci-watch')
  expect(full.isAllowed).toBe(false)
  expect(full.count.count).toBe(60)
  expect(capMessage(full.count, 'An automatic turn')).toMatch(/daily cap reached: 60 of 60 automatic turns today \(2026-11-25\), all loops together/)
})

// A world with a file system: the counter file, its lock folder and mv.
function capWorld(on: On, start: string | undefined) {
  const files = new Map<string, string>()
  if (start !== undefined) files.set(TURNS, start)
  const dirs = new Set<string>()
  const toasts: string[] = []
  mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME: '/Users/test' })
  const done = (exitCode = 0): { value: ProcessRunResult } => ({ value: { exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e) => {
    const [cmd, a, b, c] = e.argv
    if (cmd === 'mkdir' && a === '-p') return done()
    if (cmd === 'mkdir' && a !== undefined) {
      if (dirs.has(a)) return done(1)
      dirs.add(a)
      return done()
    }
    if (cmd === 'rmdir' && a !== undefined) return done(dirs.delete(a) ? 0 : 1)
    if (cmd === 'mv' && b !== undefined && c !== undefined) {
      files.set(c, files.get(b) ?? '')
      files.delete(b)
      return done()
    }
    return { value: { exitCode: 0, stdout: ROOM.line + '\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_, e) => ({ value: files.get(e.path) ?? '' }) as never)
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'memgov' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  return { files, dirs, toasts }
}

test('an automatic prompt takes one turn from the shared file; a typed prompt takes none', async ($, on) => {
  const w = capWorld(on, JSON.stringify({ day: '2026-11-25', count: 5, cap: 60, by: { 'ci-watch': 5 } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.prompt.submit({ text: 'ci: PR 7 is red', wait: false, origin: { kind: 'plugin', name: 'ci-watch' } })
  expect(r.drop).toBeUndefined()
  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  const saved = JSON.parse(w.files.get(TURNS) ?? '{}')
  expect(saved).toEqual({ day: '2026-11-25', count: 6, cap: 60, by: { 'ci-watch': 6 } })
  // The lock is gone and no temp file stays.
  expect(w.dirs.size).toBe(0)
  expect([...w.files.keys()]).toEqual([TURNS])
  const status = await $.command.run({ ...CMD, command: 'memgov', args: 'status' })
  expect(status.text).toContain('Automatic turns today (2026-11-25, all loops): 6 of 60 (ci-watch 6).')
})

test('at the cap an automatic prompt is dropped with a clear message and a typed one runs', async ($, on) => {
  const w = capWorld(on, JSON.stringify({ day: '2026-11-25', count: 60, cap: 60, by: { 'ci-watch': 40, 'scheduled task': 20 } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.prompt.submit({ text: 'run the morning prep', wait: false, origin: { kind: 'scheduled-trigger' } })
  expect(r.drop).toMatch(/daily cap reached: 60 of 60 automatic turns today/)
  expect(w.toasts[0]).toMatch(/An automatic turn from scheduled task is refused until local midnight/)
  // The same automatic turn may not start a new session either.
  const start = await $.tool.call({ tool: 'mcp__ccd_session__start_session', prompt: 'lane A' } as never)
  expect(start.deny).toMatch(/A new automatic session is refused/)
  const typed = await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
  expect(typed.drop).toBeUndefined()
  expect(JSON.parse(w.files.get(TURNS) ?? '{}').count).toBe(60)
})

test('a count of yesterday starts again at 0', async ($, on) => {
  const w = capWorld(on, JSON.stringify({ day: '2026-11-24', count: 60, cap: 60, by: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.prompt.submit({ text: 'lane B: status?', wait: false, origin: { kind: 'plugin', name: 'ops-board' } })
  expect(r.drop).toBeUndefined()
  expect(JSON.parse(w.files.get(TURNS) ?? '{}')).toEqual({ day: '2026-11-25', count: 1, cap: 60, by: { 'ops-board': 1 } })
})
