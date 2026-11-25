import { expect, mock, test } from 'claude-code/testing'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const stats = async ($: { command: { run: (e: any) => Promise<{ text?: string }> } }) =>
  (await $.command.run({ command: 'fail-hints', args: 'stats', ...RUN })).text ?? ''

test('a failed Edit gets one hint and a count', async ($, on) => {
  mock.store(on)
  on('tool.call', () => ({
    isError: true as const,
    result: 'String to replace not found in file.',
    text: 'String to replace not found in file.',
  }))

  const ran = await $.tool.call({
    tool: 'Edit',
    file_path: '/x/a.ts',
    old_string: 'a',
    new_string: 'b',
  })

  expect(ran.context).toEqual(['fail-hints: Read the current text of the file; it changed.'])
  expect(await stats($)).toContain('1 hints given')
  expect(await stats($)).toMatch(/1  string-not-found/)
})

test('a failed Bash git command gets the fetch hint', async ($, on) => {
  mock.store(on)
  on('tool.call', () => ({
    isError: true as const,
    result: 'Exit code 128',
    text: "Exit code 128\nfatal: ambiguous argument 'origin/main': unknown revision",
  }))

  const ran = await $.tool.call({ tool: 'Bash', command: 'git log origin/main' })
  expect(ran.context).toEqual(['fail-hints: Run `git fetch origin` first, then retry.'])
})

test('a good result is left as it is', async ($, on) => {
  mock.store(on)
  on('tool.call', () => ({ result: { stdout: 'ok' }, text: 'address already in use' }))

  const ran = await $.tool.call({ tool: 'Bash', command: 'echo hi' })
  expect(ran.context).toBeUndefined()
  expect(await stats($)).toContain('0 hints given')
})

test('an unknown error gets no hint', async ($, on) => {
  mock.store(on)
  on('tool.call', () => ({ isError: true as const, result: 'boom', text: 'boom' }))

  const ran = await $.tool.call({ tool: 'Bash', command: 'false' })
  expect(ran.context).toBeUndefined()
})

test('/fail-hints stats lists the counts', async ($, on) => {
  mock.store(on, { stats: { 'disk-full': 2 } })

  const text = await stats($)
  expect(text).toContain('2 hints given')
  expect(text).toMatch(/2  disk-full/)
})
