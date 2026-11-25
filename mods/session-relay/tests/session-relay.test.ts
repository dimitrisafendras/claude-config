import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const START = { cwd: '/repo', surface: 'terminal' as const, isInteractive: true }

type World = { clock: ReturnType<typeof mock.clock>; toasts: string[]; notes: string[]; reply: { text: string; isError?: true } }

function world(on: On): World {
  const w: World = { clock: mock.clock(on, { now: Date.UTC(2026, 10, 16, 12, 0, 0) }), toasts: [], notes: [], reply: { text: 'ok' } }
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'relay-status' } }))
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    w.notes.push(e.text)
    return { value: { isSent: true as const, channel: 'terminal_bell' } }
  })
  on('tool.call', () => ({ result: w.reply.text, text: w.reply.text, ...(w.reply.isError ? { isError: true as const } : {}) }))
  return w
}

const send = ($: any, tool: string, to: string) => $.tool.call({ tool, to, message: 'hi' })
const status = async ($: any) => (await $.command.run({ command: 'relay-status', args: '', ...RUN })).text as string

test('each failure pattern alerts, hints the model and names the recipient', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const cases = [
    'Message not delivered',
    'The message could not be delivered',
    'No such session: abc',
    'Session not found',
    'Target session is not running',
    'Delivery refused by the host',
    'The host client may be unreachable',
    'Request timed out',
  ]
  for (const [i, text] of cases.entries()) {
    w.reply = { text, isError: true }
    const ran = await send($, 'SendMessage', `agent-${i}`)
    expect(ran.context?.[0]).toContain(`the message to agent-${i} did not arrive`)
    expect(ran.context?.[0]).toContain('Check the recipient with the session list before you resend; do not assume it was read.')
  }
  expect(w.toasts.length).toBe(cases.length)
  expect(w.notes.length).toBe(cases.length)
})

test('"queued for delivery" is normal and gives no alert', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  w.reply = { text: 'Message queued for delivery to agent-1.' }
  const ran = await send($, 'SendMessage', 'agent-1')
  expect(ran.context).toBeUndefined()
  expect(w.toasts.length).toBe(0)
  expect(w.notes.length).toBe(0)
  expect(await status($)).toContain('0 undelivered')
})

test('the MCP send_message and start_session tools are watched; other tools are not', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  w.reply = { text: 'Session not found', isError: true }
  const a = await send($, 'mcp__ccd_session_mgmt__send_message', 's1')
  expect(a.context?.[0]).toContain('to s1')
  const b = await send($, 'mcp__ccd_session__start_session', 's2')
  expect(b.context?.[0]).toContain('to s2')
  const c = await $.tool.call({ tool: 'Bash', command: 'echo refused' })
  expect(c.context).toBeUndefined()
})

test('at most one notify per recipient per 2 minutes', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  w.reply = { text: 'Message not delivered', isError: true }
  await send($, 'SendMessage', 'a')
  await send($, 'SendMessage', 'a')
  await send($, 'SendMessage', 'b')
  expect(w.notes.length).toBe(2)
  // The hint still goes to the model on the throttled call.
  const again = await send($, 'SendMessage', 'a')
  expect(again.context?.[0]).toContain('did not arrive')
  await w.clock.advance(121_000)
  await send($, 'SendMessage', 'a')
  expect(w.notes.length).toBe(3)
})

test('a hook timeout toasts once a minute and says the call did not run', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  w.reply = { text: 'PreToolUse:Bash hook timed out after 30s', isError: true }
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(ran.context).toEqual(['session-relay: the call did not run; retry once.'])
  expect(w.toasts).toEqual(['session-relay: a hook call timed out on Bash'])
  w.reply = { text: 'PreToolUse hook error: host client may be unreachable', isError: true }
  await $.tool.call({ tool: 'Read', file_path: '/x' })
  expect(w.toasts.length).toBe(1)
  await w.clock.advance(61_000)
  await $.tool.call({ tool: 'Read', file_path: '/x' })
  expect(w.toasts.length).toBe(2)
})

test('/relay-status shows counts and the last events', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  w.reply = { text: 'Message not delivered', isError: true }
  await send($, 'SendMessage', 'agent-9')
  w.reply = { text: 'PreToolUse hook timed out', isError: true }
  await $.tool.call({ tool: 'Edit', file_path: '/x', old_string: 'a', new_string: 'b' })
  const t = await status($)
  expect(t).toContain('1 undelivered, 1 hook timeouts')
  expect(t).toContain('2026-11-16: 1 undelivered, 1 hook timeouts')
  expect(t).toContain('undelivered to agent-9')
  expect(t).toContain('hook timeout on Edit')
})

test('a long successful result that echoes the word is not scanned', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  w.reply = { text: `Sent. ${'The build timed out earlier. '.repeat(40)}` }
  const ran = await send($, 'SendMessage', 'a')
  expect(ran.context).toBeUndefined()
  expect(w.toasts.length).toBe(0)
})

test('file content that names a hook timeout is not an alert', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  w.reply = { text: `${'x'.repeat(700)} PreToolUse hook timed out ${'y'.repeat(50)}` }
  const ran = await $.tool.call({ tool: 'Read', file_path: '/log' })
  expect(ran.context).toBeUndefined()
  expect(w.toasts.length).toBe(0)
})
