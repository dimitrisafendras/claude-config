import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }

type Reply = { isError?: true; text: string }

function world(on: On, reply: { value: Reply }) {
  mock.store(on)
  const clock = mock.clock(on, { now: 1000 })
  const notes: string[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.notify', (_, e) => {
    notes.push(e.text)
    return { value: { isSent: true, channel: 'terminal_bell' } }
  })
  on('tool.call', () => {
    const r = reply.value
    return r.isError === true ? { isError: true as const, result: r.text, text: r.text } : { result: r.text, text: r.text }
  })
  return { clock, notes }
}

const start = ($: any) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
const call = ($: any, tool = 'mcp__claude-in-chrome__computer') => $.tool.call({ tool, action: 'screenshot' } as never)
const status = async ($: any) => (await $.command.run({ command: 'browser-keeper', args: 'status', ...RUN })).text ?? ''

const CASES: [string, string, string][] = [
  ['tab-group', "Tab 12 is not in Claude's tab group", 'Call tabs_context first'],
  ['domain-change', 'Error: page navigated to a different domain', 'fresh refs'],
  ['no-preview', 'No preview is open. Start one first.', 'preview_start with a url'],
  ['policy-wait', 'Policy check in progress, try again', 'Wait a few seconds'],
  ['cdp-timeout', 'CDP command timed out after 30000ms', 'read the page as text'],
  ['tab-gone', 'Error: No tab with id: 55', 'list the tabs again'],
  ['extension-down', 'Error: the Chrome extension is not connected', 'bridge is down'],
]

for (const [id, text, hint] of CASES) {
  test(`pattern ${id} adds one hint and a count`, async ($, on) => {
    world(on, { value: { isError: true, text } })
    await start($)
    const ran = await call($)
    expect(ran.context).toHaveLength(1)
    expect(ran.context?.[0]).toContain('browser-keeper:')
    expect(ran.context?.[0]).toContain(hint)
    expect(await status($)).toMatch(new RegExp(`1  ${id}`))
  })
}

test('a successful result is left untouched', async ($, on) => {
  world(on, { value: { text: 'Screenshot taken. The tab group list is closed and a timeout setting exists.' } })
  await start($)
  const ran = await call($)
  expect(ran.context).toBeUndefined()
  expect(await status($)).toContain('0 hints given')
})

test('a non-browser tool is left untouched', async ($, on) => {
  world(on, { value: { isError: true, text: 'timed out' } })
  await start($)
  const ran = await $.tool.call({ tool: 'Bash', command: 'sleep 1' })
  expect(ran.context).toBeUndefined()
})

test('a sign-in page notifies once per host per 10 minutes and adds the hint', async ($, on) => {
  const w = world(on, { value: { text: 'Navigated to https://accounts.google.com/signin/v2/identifier' } })
  await start($)
  const first = await call($, 'mcp__Claude_Browser__navigate')
  expect(first.context?.[0]).toContain('This is a sign-in page. Stop.')
  expect(w.notes).toEqual(['browser-keeper: accounts.google.com needs your sign-in'])

  const second = await call($, 'mcp__Claude_Browser__navigate')
  expect(second.context?.[0]).toContain('sign-in page')
  expect(w.notes).toHaveLength(1)

  await w.clock.advance(11 * 60_000)
  await call($, 'mcp__Claude_Browser__navigate')
  expect(w.notes).toHaveLength(2)
})

test('page text with Sign in and a password field counts as a sign-in page', async ($, on) => {
  const w = world(on, { value: { text: 'URL: https://app.example.com/start\nSign in\nEmail\nPassword field' } })
  await start($)
  const ran = await call($, 'mcp__claude-in-chrome__get_page_text')
  expect(ran.context?.[0]).toContain('sign-in page')
  expect(w.notes[0]).toContain('app.example.com')
})

test('a normal page is not a sign-in page', async ($, on) => {
  const w = world(on, { value: { text: 'Navigated to https://example.com/pricing' } })
  await start($)
  const ran = await call($, 'mcp__Claude_Browser__navigate')
  expect(ran.context).toBeUndefined()
  expect(w.notes).toHaveLength(0)
})

test('the loop guard fires on the third same failure within 2 minutes', async ($, on) => {
  const reply = { value: { isError: true as const, text: 'CDP command timed out after 30000ms' } }
  const w = world(on, reply)
  await start($)
  expect((await call($)).context?.[0]).toContain('Retry once')
  await w.clock.advance(10_000)
  expect((await call($)).context?.[0]).toContain('Retry once')
  await w.clock.advance(10_000)
  const third = await call($)
  expect(third.context).toHaveLength(1)
  expect(third.context?.[0]).toContain('failed 3 times; stop retrying')
  expect(await status($)).toMatch(/1  loop-guard/)
})

test('the loop guard does not fire when the failures are far apart', async ($, on) => {
  const w = world(on, { value: { isError: true, text: 'CDP command timed out' } })
  await start($)
  await call($)
  await w.clock.advance(100_000)
  await call($)
  await w.clock.advance(100_000)
  expect((await call($)).context?.[0]).toContain('Retry once')
})

test('off stops the hints', async ($, on) => {
  world(on, { value: { isError: true, text: 'No tab with id: 3' } })
  await start($)
  await $.command.run({ command: 'browser-keeper', args: 'off', ...RUN })
  expect((await call($)).context).toBeUndefined()
  expect(await status($)).toContain('off')
})

test('a sign-in page on a local development host gives no stop hint', async ($, on) => {
  const reply = { value: { text: '' } }
  const w = world(on, reply)
  await start($)
  for (const url of ['http://localhost:36020/ui/v2/login/loginname', 'http://127.0.0.1:3000/login', 'http://auth.localhost/ui/v2/login']) {
    reply.value = { text: `Navigated to ${url}\nSign in\nPassword` }
    const ran = await call($, 'mcp__Claude_Browser__navigate')
    expect(ran.context).toBeUndefined()
  }
  expect(w.notes).toHaveLength(0)
})

test('a sign-in page on a host that only contains the word localhost still stops', async ($, on) => {
  const w = world(on, { value: { text: 'Navigated to https://localhost.example.com/login' } })
  await start($)
  const ran = await call($, 'mcp__Claude_Browser__navigate')
  expect(ran.context?.[0]).toContain('This is a sign-in page. Stop.')
  expect(w.notes).toHaveLength(1)
})
