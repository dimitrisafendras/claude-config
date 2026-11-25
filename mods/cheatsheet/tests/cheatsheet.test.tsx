import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { DEFAULT_BUTTONS, entryOf, parseButtons, render } from '../hooks/register'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const SKILLS: Record<string, string> = {
  'start-work': '---\nname: start-work\ndescription: Start the day. Use for "/start-work", "start my day".\nargument-hint: "[repo]"\n---\nbody',
  cleanup: '---\nname: cleanup\ndescription: >\n  Remove dead worktrees. Use for "clean up worktrees".\n---\nbody',
}

let CONFIG: string | undefined
const BAND = { plugin: 'cheatsheet', component: 'AbovePrompt', props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} } } as const

const SEEN: string[] = []
const READS: string[] = []

function world(on: On, env: Record<string, string> = { HOME: '/home/me' }): void {
  CONFIG = undefined
  SEEN.length = 0
  READS.length = 0
  on('command.run', { command: 'setup-audit' }, (_, e) => (SEEN.push(`run:${e.command} ${e.args}`.trim()), { text: 'ok' }))
  on('ui.toast', (_, e) => (SEEN.push(`toast:${e.text}`), { value: undefined }))
  on('prompt.fill', (_, e) => (SEEN.push(`fill:${e.text}`), { isFilled: true }))

  mock.env(on, env)
  mock.store(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.list', () => ({ value: Object.keys(SKILLS).map(name => ({ name, kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true })) }))
  on('fs.read', (_, e) => {
    READS.push(e.path.replace(/\\/g, '/'))
    if (e.path.endsWith('cheat-sheet-url')) return { value: 'https://example.test/sheet\n' }
    if (e.path.endsWith('cheat-buttons.json')) {
      if (CONFIG === undefined) throw new Error('ENOENT')
      return { value: CONFIG }
    }
    const m = /skills\/([^/]+)\/SKILL\.md$/.exec(e.path)
    const body = m === null ? undefined : SKILLS[m[1] as string]
    if (body === undefined) throw new Error('ENOENT')
    return { value: body }
  })
}
const cmd = async ($: any, args: string) => (await $.command.run({ command: 'cheat', args, ...RUN })).text ?? ''

test('/cheat lists every skill and the link', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const out = await cmd($, '')
  expect(out).toContain('2 skills')
  expect(out).toContain('/start-work [repo]')
  expect(out).toContain('/cleanup')
  expect(out).toContain('Cheat sheet: https://example.test/sheet')
})

test('/cheat <word> filters by name, summary and phrase', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const out = await cmd($, 'worktrees')
  expect(out).toContain('1 of 2 skills match')
  expect(out).toContain('/cleanup')
  expect(out).not.toContain('/start-work')
})

test('block descriptions and quoted phrases are read', () => {
  const e = entryOf('cleanup', SKILLS.cleanup as string)
  expect(e?.summary).toBe('Remove dead worktrees.')
  expect(e?.phrases).toEqual(['clean up worktrees'])
  expect(render([], '')).toContain('0 skills')
  expect(render([], '')).not.toContain('Cheat sheet')
})

test('parseButtons keeps good entries and drops bad ones', () => {
  const out = parseButtons(JSON.stringify({ buttons: [
    { label: 'day', command: '/start-work' },
    { label: 'sync', command: '/setup-audit --apply', send: true },
    { label: 'bad', command: 'rm -rf /' },
    { label: '', command: '/x' },
    { label: 'multi', command: '/a\n/b' },
  ] }))
  expect(out).toEqual([
    { label: 'day', command: '/start-work', isSend: false },
    { label: 'sync', command: '/setup-audit --apply', isSend: true },
  ])
  expect(parseButtons(JSON.stringify({ buttons: [
    { label: 'merge', command: '/merge-when-green', hint: '  Merge when CI is green.  ' },
  ] }))).toEqual([{ label: 'merge', command: '/merge-when-green', isSend: false, hint: 'Merge when CI is green.' }])
  expect(parseButtons('not json')).toBeUndefined()
  expect(DEFAULT_BUTTONS.filter(b => b.isSend).map(b => b.command)).toEqual(['/monitor'])
})

test('the band draws one button for each command and hides', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Button', text: /day/ }))?.text).toContain('day')
    expect(await ui.find({ type: 'Button', text: /hide/ })).toBeDefined()
    await ui.unmount()
  }
  expect(await cmd($, 'hide')).toContain('hidden')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', })
  expect(await ui.find({ type: 'Button', text: /day/ })).toBeUndefined()
  await ui.unmount()
  expect(await cmd($, 'show')).toContain('shown')
})

test('a button fills the prompt; a send button runs the command', async ($, on) => {
  world(on)
  CONFIG = JSON.stringify({ buttons: [{ label: 'day', command: '/start-work' }, { label: 'dry', command: '/setup-audit', send: true }] })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: '/start-work' })
  await ui.press({ key: '/setup-audit' })
  await ui.unmount()
  expect(SEEN).toEqual(['fill:/start-work ', 'run:setup-audit'])
})

test('with no HOME (Windows) the buttons come from USERPROFILE', async ($, on) => {
  world(on, { USERPROFILE: 'C:\\Users\\me' })
  CONFIG = JSON.stringify({ buttons: [{ label: 'mine', command: '/paralel' }] })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  // The engine makes the path native, so on Linux it differs from Windows: check only its end.
  expect(READS.some(p => p.endsWith('Users/me/.claude/cheat-buttons.json'))).toBe(true)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', text: /mine/ }))?.text).toContain('mine')
  expect(await ui.find({ type: 'Button', text: /^day$/ })).toBeUndefined()
  await ui.unmount()
})
