import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const PROMPT = { wait: false, origin: { kind: 'composer' as const } }

const SKILLS: Record<string, string> = {
  'start-work': '---\nname: start-work\ndescription: Start the day. Use when the user says "/start-work", "start my day" or "what is on my plate".\n---\nbody',
  cleanup: '---\nname: cleanup\ndescription: >\n  Clean up dead worktrees. Use when the user says "clean up worktrees".\n---\nbody',
  hidden: '---\nname: hidden\ndescription: Secret. Use when "secret phrase here".\ndisable-model-invocation: true\n---\nbody',
  review: '---\nname: review\ndescription: Review a pull request in depth.\n---\nbody',
}

type World = { label: { value: string | undefined; calls: number; labels: string[][] }; prompts: (readonly string[] | undefined)[] }

function world(on: On, env: Record<string, string> = { HOME: '/home/me' }): World {
  const w: World = { label: { value: 'none', calls: 0, labels: [] }, prompts: [] }
  mock.store(on)
  mock.env(on, env)
  mock.clock(on, { now: 1000 })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.list', (_, e) => {
    // The engine makes the path native, so check only its end: /home/me or C:/Users/me.
    if (/\/me\/\.claude\/skills$/.test(e.path.replace(/\\/g, '/'))) {
      return { value: Object.keys(SKILLS).map(name => ({ name, kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true })) }
    }
    throw new Error('ENOENT')
  })
  on('fs.read', (_, e) => {
    const m = /skills\/([^/]+)\/SKILL\.md$/.exec(e.path)
    const body = m === null ? undefined : SKILLS[m[1] as string]
    if (body === undefined) throw new Error('ENOENT')
    return { value: body }
  })
  on('model.classify', (_, e) => {
    w.label.calls += 1
    w.label.labels.push([...e.labels])
    return { value: w.label.value }
  })
  on('prompt.submit', (_, e) => {
    w.prompts.push(e.context)
    return { text: e.text, context: e.context }
  })
  return w
}

const start = ($: any) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
const send = ($: any, text: string) => $.prompt.submit({ text, ...PROMPT })
const cmd = async ($: any, args: string) => (await $.command.run({ command: 'skill-router', args, ...RUN })).text ?? ''
const LONG = 'please look at the open pull request and tell me whether the change is safe to merge'

test('a trigger phrase hit adds one context line and no classify call', async ($, on) => {
  const w = world(on)
  await start($)
  await send($, 'ok so start my day please')
  expect(w.prompts.at(-1)).toHaveLength(1)
  expect(w.prompts.at(-1)?.[0]).toContain('the skill "start-work"')
  expect(w.prompts.at(-1)?.[0]).toContain('Load it with the Skill tool')
  expect(w.label.calls).toBe(0)
  expect(await cmd($, 'status')).toContain('Suggested 1')
  expect(await cmd($, 'why')).toContain('trigger')
})

test('a slash command is left alone', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit({
    text: '/start-work now',
    command: { name: 'start-work', args: 'now' } as never,
    ...PROMPT,
  })
  expect(w.prompts.at(-1)).toBeUndefined()
})

test('"yes" and short prompts are left alone', async ($, on) => {
  const w = world(on)
  await start($)
  await send($, 'yes')
  await send($, 'continue')
  await send($, 'start my day')
  expect(w.prompts.every(p => p === undefined || p.length > 0)).toBe(true)
  expect(w.prompts[0]).toBeUndefined()
  expect(w.prompts[1]).toBeUndefined()
  expect(w.label.calls).toBe(0)
})

test('classify none adds nothing; a label adds one line; the cache avoids a second call', async ($, on) => {
  const w = world(on)
  await start($)
  await send($, LONG)
  expect(w.prompts.at(-1)).toBeUndefined()
  expect(w.label.calls).toBe(1)
  expect(w.label.labels[0]).toContain('none')
  expect(w.label.labels[0]).not.toContain('hidden')

  w.label.value = 'review'
  await send($, LONG + ' now')
  expect(w.prompts.at(-1)?.[0]).toContain('the skill "review"')
  expect(w.label.calls).toBe(2)
})

test('an already invoked skill is not suggested again', async ($, on) => {
  const w = world(on)
  await start($)
  await $.tool.call({ tool: 'Skill', skill: 'start-work' }).catch(() => undefined)
  await send($, 'start my day please')
  expect(w.prompts.at(-1)).toBeUndefined()
})

test('a skill suggested in the last 3 prompts is not suggested again', async ($, on) => {
  const w = world(on)
  await start($)
  await send($, 'start my day please')
  expect(w.prompts.at(-1)).toHaveLength(1)
  await send($, 'start my day again please')
  expect(w.prompts.at(-1)).toBeUndefined()
})

test('off stops it, on restarts it', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await cmd($, 'off')).toContain('off')
  await send($, 'start my day please')
  expect(w.prompts.at(-1)).toBeUndefined()
  await cmd($, 'on')
  await send($, 'start my day please')
  expect(w.prompts.at(-1)).toHaveLength(1)
})

test('reload rebuilds the index', async ($, on) => {
  world(on)
  await start($)
  expect(await cmd($, 'reload')).toContain('3 skills')
})

test('with no HOME (Windows) the skills come from USERPROFILE', async ($, on) => {
  const w = world(on, { USERPROFILE: 'C:/Users/me' })
  await start($)
  await send($, 'ok so start my day please')
  expect(w.prompts.at(-1)?.[0]).toContain('the skill "start-work"')
})
