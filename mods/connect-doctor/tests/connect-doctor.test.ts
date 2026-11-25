import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

type World = {
  states: Record<string, 'ok' | 'auth' | 'failed' | 'disabled'>
  isGhOk?: boolean
  toolError?: string
}

function world(on: On, w: World) {
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/home/me' })
  const toasts: string[] = []
  const notes: string[] = []
  const statuses: (string | undefined)[] = []
  const connects: string[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work' }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    notes.push(e.text)
    return { value: { isSent: true, channel: 'terminal_bell' } }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { breakdown: { mcpTools: [{ name: 'mcp__sentry__search_issues', serverName: 'sentry', tokens: 10, isLoaded: false }] } },
      rateLimits: [],
    } as never,
  }))
  on('tool.list', () => ({ value: [{ name: 'mcp__sentry__search_issues', description: 'Search', mcp: true }] }))
  on('fs.read', (_, e) => {
    if (e.path === '/home/me/.claude.json') {
      return { value: JSON.stringify({ mcpServers: Object.fromEntries(Object.keys(w.states).map(k => [k, { token: 'x' }])) }) }
    }
    throw new Error('ENOENT')
  })
  on('mcp.connect', (_, e) => {
    connects.push(e.server)
    const s = w.states[e.server] ?? 'failed'
    if (s === 'ok') return { value: { isConnected: true, server: e.server } }
    return { value: { isConnected: false, reason: s, message: `${e.server}: ${s}` } }
  })
  on('process.run', () => ({
    value: w.isGhOk === false
      ? { exitCode: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login', isStdoutTruncated: false, isStderrTruncated: false }
      : { exitCode: 0, stdout: '', stderr: 'github.com\n  ✓ Logged in to github.com account octo (keyring)', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  if (w.toolError !== undefined) {
    const text = w.toolError
    on('tool.call', () => ({ isError: true, result: text, text }))
  }
  return { clock, toasts, notes, statuses, connects }
}

test('the start check tells the person once what needs a sign-in', async ($, on) => {
  const w = world(on, { states: { sentry: 'ok', figma: 'auth', posthog: 'ok', blender: 'disabled' } })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(w.toasts).toHaveLength(0)
  await w.clock.advance(11000)
  expect(w.toasts).toHaveLength(1)
  expect(w.notes).toHaveLength(1)
  expect(w.toasts[0]).toBe('connect-doctor: sign in needed for figma (run /mcp). Reconnected: posthog. gh: OK (octo)')
  expect(w.statuses.at(-1)).toBe('mcp 1 need sign-in')
})

test('the start check is silent when all is fine', async ($, on) => {
  const w = world(on, { states: { sentry: 'ok', blender: 'disabled' } })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await w.clock.advance(11000)
  expect(w.toasts).toHaveLength(0)
  expect(w.notes).toHaveLength(0)
  expect(w.statuses.at(-1)).toBe('mcp ok')
})

test('/mcp-doctor answers a table, gh included', async ($, on) => {
  world(on, { states: { sentry: 'ok', figma: 'auth' }, isGhOk: false })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const out = await $.command.run({
    command: 'mcp-doctor',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(out.text).toContain('| figma | needs sign-in | none (no sign-in tried) | run /mcp and sign in |')
  expect(out.text).toContain('| sentry | connected | - | - |')
  expect(out.text).toContain('| gh (CLI) | not signed in |')
  expect(out.text).toContain('mcp 1 need sign-in · gh not signed in')
})

test('a connection error on an MCP tool gets one connect and a hint', async ($, on) => {
  const w = world(on, { states: { sentry: 'ok' }, toolError: 'MCP error -32000: Connection closed' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await w.clock.advance(11000)
  const before = w.connects.length
  const ran = await $.tool.call({ tool: 'mcp__sentry__search_issues', query: 'x' })
  expect(w.connects.length).toBe(before + 1)
  expect(ran.context).toContain('connect-doctor reconnected sentry; retry the call once.')
  // A second failure inside two minutes is not retried.
  const again = await $.tool.call({ tool: 'mcp__sentry__search_issues', query: 'x' })
  expect(w.connects.length).toBe(before + 1)
  expect(again.context ?? []).not.toContain('connect-doctor reconnected sentry; retry the call once.')
})
