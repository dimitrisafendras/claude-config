import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'

const PANE = {
  plugin: 'ops-board',
  component: 'Pane',
  requestId: 'ops-board',
  props: {
    title: 'Ops board',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-16T12:00:00Z')

const SEARCH = [
  { number: 1, title: 'Fix login', url: 'https://github.com/acme/web/pull/1', updatedAt: '2026-11-16T11:00:00Z', repository: { nameWithOwner: 'acme/web' } },
  { number: 2, title: 'Add docs', url: 'https://github.com/acme/web/pull/2', updatedAt: '2026-11-16T10:00:00Z', repository: { nameWithOwner: 'acme/web' } },
  { number: 3, title: 'Old work', url: 'https://github.com/acme/web/pull/3', updatedAt: new Date(NOW - 10 * DAY).toISOString(), repository: { nameWithOwner: 'acme/web' } },
  { number: 9, title: 'Elsewhere', url: 'https://github.com/other/x/pull/9', updatedAt: '2026-11-16T11:30:00Z', repository: { nameWithOwner: 'other/x' } },
]

const VIEWS: Record<string, unknown> = {
  '1': { mergeable: 'MERGEABLE', reviewDecision: '', statusCheckRollup: [{ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'FAILURE' }] },
  '2': { mergeable: 'CONFLICTING', reviewDecision: '', statusCheckRollup: [] },
}

function ok(stdout: string) {
  return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

// The board reads only these fields of a `$.agent.list()` row. The cast keeps
// the rows valid when a build adds fields that the board does not read.
const agent = (a: Pick<AgentInfo, 'id' | 'description' | 'type' | 'status' | 'name'>) => a as AgentInfo

function world(on: On, options: { isRateLimited?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/me' })
  const calls: string[][] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({
    value: [
      agent({ id: 'a1', description: 'Review PR', type: 'pr-reviewer', status: 'running', name: 'reviewer' }),
      agent({ id: 'a2', description: 'Build it', type: 'general-purpose', status: 'failed' }),
    ],
  }))
  on('process.run', (_, e) => {
    calls.push([...e.argv])
    const [cmd, sub] = e.argv
    if (cmd === 'gh' && sub === 'search') {
      if (options.isRateLimited === true) {
        return { value: { exitCode: 1, stdout: '', stderr: 'API rate limit exceeded for user', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return ok(JSON.stringify(SEARCH))
    }
    if (cmd === 'gh' && sub === 'pr') return ok(JSON.stringify(VIEWS[e.argv[3] ?? ''] ?? {}))
    return ok('')
  })
  return { clock, calls }
}

test('the pane shows verdicts, needs-you and agents on every surface', async ($, on) => {
  const { clock, calls } = world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(2000)

  // Three views: PR 3 is older than 7 days. PR 9 is in another repo and shows too.
  expect(calls.filter(c => c[0] === 'gh' && c[1] === 'pr')).toHaveLength(3)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'pr:acme/web#1', text: /red/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'pr:acme/web#2', text: /conflict/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'need:acme/web#2' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'pr:other/x#9' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /running reviewer/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /agent failed: Build it/ })).toBeDefined()
    expect(await ui.find({ type: 'Link', text: 'open' })).toBeDefined()
    await ui.unmount()
  }
})

test('/ops-status answers a compact summary', async ($, on) => {
  const { clock } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  const out = await $.command.run({
    command: 'ops-status',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(out.text).toContain('**Agents**: 1 running')
  expect(out.text).toContain('- red: [web#1](https://github.com/acme/web/pull/1)')
  expect(out.text).toContain('- conflict: [acme/web#2](https://github.com/acme/web/pull/2) Add docs')
  expect(out.text).toContain('agent failed: Build it')
})

test('a rate limit backs off the timer', async ($, on) => {
  const { clock, calls } = world(on, { isRateLimited: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(2000)
  const searches = () => calls.filter(c => c[0] === 'gh' && c[1] === 'search').length
  expect(searches()).toBe(1)
  // The 2-minute tick falls inside the 4-minute backoff.
  await clock.advance(2 * 60 * 1000)
  expect(searches()).toBe(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /gh rate limit/ })).toBeDefined()
  await ui.unmount()
})
