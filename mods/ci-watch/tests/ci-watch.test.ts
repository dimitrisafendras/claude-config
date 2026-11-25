import { expect, mock, test } from 'claude-code/testing'
import type { On, ToolCallArgs } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// Nothing sits beneath the plugin: these hooks stand for the engine and gh.

type Gh = { exitCode: number; stdout: string; stderr: string }
const ok = (j: unknown): Gh => ({ exitCode: 0, stdout: JSON.stringify(j), stderr: '' })

const RED = {
  state: 'OPEN',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'BLOCKED',
  url: 'https://github.com/o/r/pull/5',
  title: 'Fix it',
  baseRefName: 'main',
  statusCheckRollup: [
    {
      __typename: 'CheckRun',
      name: 'test',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      detailsUrl: 'https://github.com/o/r/actions/runs/777/job/1',
    },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ],
}
const GREEN = { ...RED, statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] }
const PENDING = { ...RED, statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS' }] }

const CONFLICT = { ...GREEN, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }

type World = {
  clock: ReturnType<typeof mock.clock>
  prompts: string[]
  toasts: string[]
  notes: string[]
  statuses: (string | undefined)[]
  gh: { pr: unknown; rateLimited: boolean; calls: string[][] }
}

function world(on: On): World {
  const w: World = { clock: mock.clock(on), prompts: [], toasts: [], notes: [], statuses: [], gh: { pr: RED, rateLimited: false, calls: [] } }
  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', () => ({ value: { command: 'ci-watch' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__ci-watch__watch' } }))
  on('ui.status', (_, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    w.notes.push(e.text)
    return { value: { isSent: true as const, channel: 'terminal_bell' } }
  })
  on('prompt.submit', (_, e) => {
    w.prompts.push(e.text)
    return { text: e.text }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    w.gh.calls.push(argv)
    if (argv[0] !== 'gh') return { value: { exitCode: 1, stdout: '', stderr: 'no', isStdoutTruncated: false, isStderrTruncated: false } }
    let r: Gh
    if (w.gh.rateLimited) r = { exitCode: 1, stdout: '', stderr: 'HTTP 403: API rate limit exceeded' }
    else if (argv.includes('-R')) r = ok(w.gh.pr)
    else if (argv[3] === '--json' && argv[4]?.includes('headRefName')) r = ok({ number: 5, url: 'https://github.com/o/r/pull/5', headRefName: 'feat' })
    else r = ok({ number: 5, url: 'https://github.com/o/r/pull/5' })
    return { value: { ...r, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  return w
}

const START = { cwd: '/repo', surface: 'terminal' as const, isInteractive: true }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }

test('add, then a red check starts a turn with the failed check and run id', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const added = await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  expect(added.text).toContain('now watching o/r#5')

  await $.command.run({ command: 'ci-watch', args: 'check', ...RUN })
  await w.clock.advance(1)
  const listed = await $.command.run({ command: 'ci-watch', args: 'list', ...RUN })
  expect(listed.text).toContain('o/r#5 red')
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('ci-watch: o/r#5 is red. Failed checks: test.')
  expect(w.prompts[0]).toContain('gh run view 777 --log-failed -R o/r')
  expect(w.statuses.at(-1)).toBe('ci 1 red')

  // The same red state does not start a second turn.
  await $.command.run({ command: 'ci-watch', args: 'check', ...RUN })
  await w.clock.advance(1)
  expect(w.prompts.length).toBe(1)
})

test('green notifies without a turn; auto-merge on asks to merge', async ($, on) => {
  const w = world(on)
  w.gh.pr = GREEN
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add https://github.com/o/r/pull/5', ...RUN })
  await $.command.run({ command: 'ci-watch', args: 'check', ...RUN })
  await w.clock.advance(1)
  expect(w.prompts.length).toBe(0)
  expect(w.toasts).toContain('o/r#5 is green')

  await $.command.run({ command: 'ci-watch', args: 'auto-merge 5 on', ...RUN })
  await $.command.run({ command: 'ci-watch', args: 'check', ...RUN })
  await w.clock.advance(1)
  expect(w.prompts[0]).toBe('ci-watch: o/r#5 is green and mergeable; merge it per the repo rules.')
})

test('a sleep-poll loop is denied and the PR is watched; allow-poll lets it run', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const denied = await $.tool.call({ tool: 'Bash', command: 'while true; do gh pr checks 5 -R o/r; sleep 30; done' })
  expect(denied.text ?? denied.deny).toContain('ci-watch watches o/r#5 and starts a turn when CI changes. Do not poll')

  const list = await $.command.run({ command: 'ci-watch', args: 'list', ...RUN })
  expect(list.text).toContain('o/r#5')

  await $.command.run({ command: 'ci-watch', args: 'allow-poll on', ...RUN })
  const ran = await $.tool.call({ tool: 'Bash', command: 'gh run watch 777' })
  expect(ran.deny).toBeUndefined()
  expect(w.prompts.length).toBe(0)
})

test('a successful git push adds the branch PR and tells the model', async ($, on) => {
  world(on)
  await $.session.start(START)
  const ran = await $.tool.call({ tool: 'Bash', command: 'cd ~/code/r && git push -u origin HEAD' })
  expect(ran.context?.join(' ')).toContain('ci-watch now watches o/r#5')
  const list = await $.command.run({ command: 'ci-watch', args: 'list', ...RUN })
  expect(list.text).toContain('o/r#5 not checked yet')
})

test('the watch tool adds a PR (the interop path for other mods)', async ($, on) => {
  world(on)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'mcp__ci-watch__watch', pr: 'o/r#9' } as unknown as ToolCallArgs)
  expect(String(r.result)).toContain('ci-watch now watches o/r#9')
})

test('the 90 s timer polls; a rate limit doubles the interval and shows it', async ($, on) => {
  const w = world(on)
  const clock = w.clock
  w.gh.pr = PENDING
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })

  await clock.advance(90_000)
  expect(w.statuses.at(-1)).toBe('ci 1 pending')

  w.gh.rateLimited = true
  await clock.advance(90_000)
  expect(w.statuses.at(-1)).toBe('ci 1 pending · rate-limited, next in 3m')

  w.gh.rateLimited = false
  w.gh.pr = RED
  await clock.advance(180_000)
  expect(w.prompts.length).toBe(1)
  expect(w.statuses.at(-1)).toBe('ci 1 red')
})

// The option fix_turns: `on` (the default) starts the fix turn, `off` only reports.
const check = async ($: Engine, w: World) => {
  await $.command.run({ command: 'ci-watch', args: 'check', ...RUN })
  await w.clock.advance(1)
}

test('fix_turns on: a conflict starts a turn, with no toast', { options: { fix_turns: 'on' } }, async ($, on) => {
  const w = world(on)
  w.gh.pr = CONFLICT
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.prompts).toEqual([
    'ci-watch: o/r#5 has merge conflicts with main. Fetch origin, rebase onto (or merge) origin/main, resolve the conflicts, run the tests, and push.',
  ])
  expect(w.toasts).toEqual([])
  expect(w.notes).toEqual([])
})

test('fix_turns off: red CI gets a toast and a notification, and no turn', { options: { fix_turns: 'off' } }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const added = await $.tool.call({ tool: 'mcp__ci-watch__watch', pr: 'o/r#5' } as unknown as ToolCallArgs)
  expect(String(added.result)).toContain('ci-watch now watches o/r#5 and reports red CI and conflicts with a notification (it starts no fix turn')
  await check($, w)
  expect(w.prompts).toEqual([])
  expect(w.toasts).toEqual(['o/r#5 is red: test'])
  expect(w.notes).toEqual(['o/r#5 is red: test'])
  expect(w.statuses.at(-1)).toBe('ci 1 red')

  // The same red state does not report again.
  await check($, w)
  expect(w.toasts.length).toBe(1)
})

test('fix_turns off: a conflict gets a toast and a notification, and no turn', { options: { fix_turns: 'off' } }, async ($, on) => {
  const w = world(on)
  w.gh.pr = CONFLICT
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.prompts).toEqual([])
  expect(w.toasts).toEqual(['o/r#5 has merge conflicts'])
  expect(w.notes).toEqual(['o/r#5 has merge conflicts'])
})

test('fix_turns off: the green path does not change', { options: { fix_turns: 'off' } }, async ($, on) => {
  const w = world(on)
  w.gh.pr = GREEN
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.prompts).toEqual([])
  expect(w.toasts).toEqual(['o/r#5 is green'])
  expect(w.notes).toEqual(['o/r#5 is green'])

  await $.command.run({ command: 'ci-watch', args: 'auto-merge 5 on', ...RUN })
  await check($, w)
  expect(w.prompts).toEqual(['ci-watch: o/r#5 is green and mergeable; merge it per the repo rules.'])
})

test('the watch tool can switch auto-merge on for the PR', async ($, on) => {
  world(on)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'mcp__ci-watch__watch', pr: 'o/r#9', auto_merge: true } as unknown as ToolCallArgs)
  expect(String(r.result)).toContain('Auto-merge is on')
  const list = await $.command.run({ command: 'ci-watch', args: 'list', ...RUN })
  expect(list.text).toContain('o/r#9')
  expect(list.text).toContain('(auto-merge on)')
})
