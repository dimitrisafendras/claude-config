import { expect, mock, test } from 'claude-code/testing'
import type { On, ProcessRunResult } from 'claude-code'

import { decisionOf, isCoordinator, isRecentLedger, laneHealth, lastActivity, nextStep, sessionOf, withDecision } from '../hooks/lanes'

const MIN = 60_000
const LIMIT = 20 * MIN
const NOW = Date.parse('2026-11-25T12:00:00')

test('isRecentLedger: today and yesterday only', () => {
  expect(isRecentLedger('web-2026-11-25.json', NOW)).toBe(true)
  expect(isRecentLedger('web-2026-11-24.json', NOW)).toBe(true)
  expect(isRecentLedger('web-2026-11-22.json', NOW)).toBe(false)
  expect(isRecentLedger('notes.json', NOW)).toBe(false)
})

test('laneHealth: silent, dead, done and ok', () => {
  const running = { lane: 'A', state: 'running', lastReport: new Date(NOW - 30 * MIN).toISOString() }
  const act = lastActivity(running, {}, undefined, undefined)
  expect(laneHealth(running, act, NOW, LIMIT).health).toBe('silent')
  expect(laneHealth(running, NOW - 5 * MIN, NOW, LIMIT).health).toBe('ok')
  // The session tools say it works now: not silent.
  expect(laneHealth(running, act, NOW, LIMIT, { isRunning: true }).health).toBe('ok')
  expect(laneHealth({ state: 'failed (memory)' }, undefined, NOW, LIMIT).health).toBe('dead')
  expect(laneHealth({ state: 'running' }, NOW, NOW, LIMIT, { isArchived: true }).health).toBe('dead')
  // A PR or a done mark is not dead.
  expect(laneHealth({ state: 'failed', pr: 12 }, NOW, NOW, LIMIT).health).toBe('ok')
  expect(laneHealth({ state: 'done; worktree removed' }, undefined, NOW, LIMIT).health).toBe('done')
  // A change seen in the row is activity.
  expect(lastActivity(running, {}, undefined, NOW - MIN)).toBe(NOW - MIN)
})

test('nextStep: one check, one restart, one decision record, then nothing', () => {
  expect(nextStep('ok', {}, 0, NOW, LIMIT)).toBeUndefined()
  expect(nextStep('silent', {}, 0, NOW, LIMIT)).toBe('check')
  expect(nextStep('silent', { checkAt: NOW - 5 * MIN }, 0, NOW, LIMIT)).toBeUndefined()
  expect(nextStep('silent', { checkAt: NOW - LIMIT }, 0, NOW, LIMIT)).toBe('restart')
  expect(nextStep('dead', { checkAt: NOW - 2 * LIMIT, restartAt: NOW - LIMIT }, 0, NOW, LIMIT)).toBe('decide')
  // A restart the ledger counts already is the one restart.
  expect(nextStep('dead', { checkAt: NOW - LIMIT }, 1, NOW, LIMIT)).toBe('decide')
  expect(nextStep('dead', { checkAt: 1, restartAt: 2, decidedAt: 3 }, 0, NOW, LIMIT)).toBeUndefined()
})

test('decision records: the routines format, added or replaced by id, a bad file left alone', () => {
  const rec = decisionOf({ lane: 'B', name: 'lane-b', items: ['SN-12', 'docs'] }, 'web-2026-11-25.json', 'dead', NOW)
  expect(Object.keys(rec)).toEqual(['id', 'ticket', 'question', 'options', 'default', 'deadline', 'reversible'])
  expect(rec.id).toBe('ops-board-lane-web-2026-11-25-B')
  expect(rec.ticket).toBe('SN-12')
  expect(rec.options).toHaveLength(2)
  expect(rec.options).toContain(rec.default)
  expect(rec.deadline).toBe(new Date(NOW + 24 * 3600 * 1000).toISOString())
  const one = JSON.parse(withDecision(undefined, rec) ?? 'null')
  expect(one).toEqual([rec])
  const kept = JSON.parse(withDecision(JSON.stringify([{ id: 'other' }, { ...rec, question: 'old' }]), rec) ?? 'null')
  expect(kept).toEqual([{ id: 'other' }, rec])
  expect(withDecision('{"not":"an array"}', rec)).toBeUndefined()
  expect(withDecision('broken', rec)).toBeUndefined()
})

test('isCoordinator and sessionOf', () => {
  expect(isCoordinator('local_abcdef12-3456', ['abcdef12-3456'])).toBe(true)
  expect(isCoordinator('someone-else-0000', ['abcdef12-3456'])).toBe(false)
  expect(isCoordinator('', ['abcdef12-3456'])).toBe(false)
  expect(sessionOf('{"isRunning":false,"isArchived":true,"lastActivityAt":"2026-11-25T10:00:00Z"}', false)).toEqual({
    isRunning: false,
    isArchived: true,
    lastActivityAt: Date.parse('2026-11-25T10:00:00Z'),
  })
  expect(sessionOf('Session not found', true)).toEqual({ isMissing: true })
  expect(sessionOf('server down', true)).toBeUndefined()
})

// ---------- the loop in a session ----------

const HOME = '/home/me'
const LEDGER = `${HOME}/.claude/paralel/web-2026-11-25.json`
const DECISIONS = `${HOME}/.claude/autonomy/decisions.json`

function world(on: On, opts: { coordinator?: string; off?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  mock.store(on)
  const files = new Map<string, string>()
  files.set(
    LEDGER,
    JSON.stringify({
      repo: 'acme/web',
      started: new Date(NOW - 60 * MIN).toISOString(),
      coordinator: opts.coordinator ?? 'local_sess-0001-abcd',
      lanes: [
        { lane: 'A', items: ['SN-7'], name: 'lane-a', branch: 'feature/a', state: 'running', lastReport: new Date(NOW - 30 * MIN).toISOString(), restarts: 0 },
        { lane: 'B', items: ['SN-8'], name: 'lane-b', state: 'done', restarts: 0 },
      ],
    }),
  )
  const prompts: string[] = []
  const toasts: string[] = []
  const done = (): { value: ProcessRunResult } => ({ value: { exitCode: 0, stdout: '[]', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('session.id', () => ({ value: 'sess-0001-abcd' }))
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: 'no such server' }], isError: true } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('agent.list', () => ({ value: [] }))
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('fs.exists', (_, e) => ({ value: e.path === `${HOME}/.claude/paralel` || files.has(e.path) || (opts.off === true && e.path === `${HOME}/.claude/autonomy.off`) }))
  on('fs.list', () => ({ value: [{ name: 'web-2026-11-25.json', kind: 'file', size: 1, mtimeMs: NOW, isLink: false }, { name: 'old-2026-11-01.json', kind: 'file', size: 1, mtimeMs: NOW, isLink: false }] }))
  on('fs.read', (_, e) => ({ value: files.get(e.path) ?? '' }) as never)
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const [cmd, , from, to] = e.argv
    if (cmd === 'mv' && from !== undefined && to !== undefined) {
      files.set(to, files.get(from) ?? '')
      files.delete(from)
    }
    return done()
  })
  return { clock, files, prompts, toasts }
}

test('a silent lane gets one check turn, one restart turn, then one decision record', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(2000)
  expect(w.prompts).toHaveLength(1)
  expect(w.prompts[0]).toContain('lane A (lane-a; SN-7)')
  expect(w.prompts[0]).toContain('Check it once')

  // Still silent: no second check; after the limit, one restart.
  await w.clock.advance(10 * MIN)
  expect(w.prompts).toHaveLength(1)
  await w.clock.advance(12 * MIN)
  expect(w.prompts).toHaveLength(2)
  expect(w.prompts[1]).toContain('Restart it once')
  expect(w.prompts[1]).toContain('feature/a')

  // Still silent after the restart: a decision record, and no more turns.
  await w.clock.advance(22 * MIN)
  const recs = JSON.parse(w.files.get(DECISIONS) ?? '[]')
  expect(recs).toHaveLength(1)
  expect(recs[0].id).toBe('ops-board-lane-web-2026-11-25-A')
  expect(recs[0].ticket).toBe('SN-7')
  expect(w.toasts.join('\n')).toContain('Decision record ops-board-lane-web-2026-11-25-A')
  await w.clock.advance(60 * MIN)
  expect(w.prompts).toHaveLength(2)
  expect(JSON.parse(w.files.get(DECISIONS) ?? '[]')).toHaveLength(1)

  const ui = await $.ui.mount({
    plugin: 'ops-board',
    component: 'Pane',
    requestId: 'ops-board',
    surface: 'desktop',
    props: { title: 'Ops board', isFocused: false, bodyColumns: 160, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /silent +lane A .*decision written/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /lane silent: lane A/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /done +lane B/ })).toBeDefined()
  await ui.unmount()
})

test('the kill switch and another coordinator start no turn; the lane still shows', async ($, on) => {
  const w = world(on, { off: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await w.clock.advance(60 * MIN)
  expect(w.prompts).toHaveLength(0)
  expect(w.files.has(DECISIONS)).toBe(false)
  const out = await $.command.run({ command: 'ops-status', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(out.text).toContain('kill switch on: no turns')
  expect(out.text).toContain('- lane silent: lane A')
})

test('a ledger of another coordinator: shown, no turn', async ($, on) => {
  const w = world(on, { coordinator: 'local_other-9999-zzzz' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await w.clock.advance(60 * MIN)
  expect(w.prompts).toHaveLength(0)
})

test('the silent limit is an option', { options: { silent_minutes: 45 } }, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await w.clock.advance(2000)
  // 30 minutes without a report is under 45.
  expect(w.prompts).toHaveLength(0)
  await w.clock.advance(16 * MIN)
  expect(w.prompts).toHaveLength(1)
})
