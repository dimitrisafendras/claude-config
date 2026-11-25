import type { On, ThemeSetArgs } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { THEMES, otherOwner, retakeBudget, themeOf } from '../hooks/themes'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const START = { cwd: '/work', surface: 'desktop', isInteractive: true } as const
const CARD = { plugin: 'custom-themes', component: 'Placed', requestId: 'themes-card', props: { id: 'themes-card', plugin: 'custom-themes' } } as const
const XMAS = THEMES[0]!
const PIXEL = THEMES[1]!
const backdrop = (id: string) =>
  ({ plugin: 'custom-themes', component: 'Backdrop', requestId: 'backdrop', props: { scene: id, plugin: 'custom-themes', glass: { blur: 6, tint: '#0b0f2e', opacity: 0.66 } } }) as const

const SETS: ThemeSetArgs[] = []
const TOASTS: string[] = []
let clears = 0
let isStyleRefused = false
let percent: number | undefined = 0
// The compaction-window percent of the breakdown; absent, the mock has no breakdown.
let windowPercent: number | undefined
let isPlaced = true

// Each hook here stands for the engine, beneath the mod.
function world(on: On, stored: Record<string, unknown> = {}): ReturnType<typeof mock.clock> {
  SETS.length = 0
  TOASTS.length = 0
  clears = 0
  isStyleRefused = false
  percent = 0
  windowPercent = undefined
  isPlaced = true
  const clock = mock.clock(on, { now: Date.parse('2026-12-24T18:00:00Z') })
  on('ui.toast', (_, e) => {
    TOASTS.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, ...(percent === undefined ? {} : { percent }), ...(windowPercent === undefined ? {} : { breakdown: { percentage: windowPercent } as never }) }, rateLimits: [] } }))
  mock.store(on, stored)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.compact', () => ({ messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }))
  on('ui.place', () => ({ value: isPlaced ? { isPlaced: true, requestId: 'themes-card' } : { isPlaced: false, reason: 'no surface', requestId: 'themes-card' } }))
  on('theme.set', (_, e) => {
    if (isStyleRefused && e.style !== undefined) throw new Error('style is not a known attribute')
    SETS.push(e)
    return { value: { isDrawn: true, requestId: 'theme' } }
  })
  on('theme.clear', () => {
    clears += 1
    return { value: { isDrawn: false, reason: 'the theme is cleared' } }
  })
  return clock
}
const cmd = async ($: any, args: string): Promise<string> => (await $.command.run({ command: 'themes', args, ...RUN })).text ?? ''
const drawn = async (ui: any): Promise<string> => (await ui.findAll({ type: 'Svg' })).map((s: any) => String(s.props.source ?? '')).join('')

test('each theme paints, names its scene, and is pure vector', () => {
  for (const t of THEMES) {
    expect(t.problems.filter(p => p.startsWith("Desktop won't paint"))).toEqual([])
    expect(t.look.backdrop).toMatchObject({ scene: t.id })
    const svg = t.scene(50)
    expect(svg.length).toBeLessThan(131_072)
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('href')
    expect(t.scene(100)).not.toBe(t.scene(0))
  }
  expect(themeOf('Christmas Night')?.id).toBe(XMAS.id)
  expect(themeOf('pixel blue')?.id).toBe(PIXEL.id)
  expect(themeOf('nope')).toBeUndefined()
})

test('a start with nothing stored applies the first theme, Christmas Night', async ($, on) => {
  world(on)
  await $.session.start(START)
  expect(SETS.length).toBe(1)
  expect(SETS[0]?.backdrop).toMatchObject({ scene: XMAS.id })
  expect(await cmd($, 'list')).toContain(`${XMAS.id} (applied)`)
})

test('/themes <name> applies for all projects, and a new start sets it again', async ($, on) => {
  world(on, { applied: 'none' })
  await $.session.start(START)
  expect(SETS.length).toBe(0)
  expect(await cmd($, 'christmas-night')).toContain('Christmas Night is set. Saved for all projects.')
  expect(SETS[0]?.backdrop).toMatchObject({ scene: XMAS.id })
  SETS.length = 0
  await $.session.start(START)
  expect(SETS[0]?.backdrop).toMatchObject({ scene: XMAS.id })
})

test('/themes <name> session keeps the choice out of the store', async ($, on) => {
  world(on, { applied: 'none' })
  await $.session.start(START)
  expect(await cmd($, 'pixel-blue session')).toContain('This session only.')
  expect(SETS[0]?.backdrop).toMatchObject({ scene: PIXEL.id })
  expect(await cmd($, 'list')).toContain('pixel-blue (applied)')
})

test('/themes off clears the theme and the store', async ($, on) => {
  world(on, { applied: XMAS.id })
  await $.session.start(START)
  expect(SETS.length).toBe(1)
  expect(await cmd($, 'off')).toBe('No theme.')
  expect(clears).toBe(1)
  // The clear is stored, so a new start does not fall back to the default theme.
  SETS.length = 0
  await $.session.start(START)
  expect(SETS.length).toBe(0)
})

test('the backdrop draws the applied scene and follows the context fill', async ($, on) => {
  world(on)
  await $.session.start(START)
  await cmd($, 'christmas-night')
  const ui = await $.ui.mount({ ...backdrop(XMAS.id), surface: 'desktop' })
  const empty = await drawn(ui)
  expect(empty).toContain('<svg')
  percent = 80
  await $.turn.start({ text: 'Fill the window', turnId: 't1' })
  const full = await drawn(ui)
  expect(full.length).toBeGreaterThan(empty.length)
  percent = 10
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'old', toolUses: [] }] })
  expect((await drawn(ui)).length).toBeLessThan(full.length)
  await ui.unmount()

  const other = await $.ui.mount({ ...backdrop('navy'), props: { scene: 'navy', plugin: 'other', glass: false }, surface: 'desktop' })
  expect(await drawn(other)).toBe('')
  await other.unmount()
})

test('the fill follows the compaction window when the breakdown has it', async ($, on) => {
  world(on)
  await $.session.start(START)
  await cmd($, 'christmas-night')
  const ui = await $.ui.mount({ ...backdrop(XMAS.id), surface: 'desktop' })
  percent = 30
  await $.turn.start({ text: 'Work', turnId: 't1' })
  const low = await drawn(ui)
  // 30% of the model window is 50% of a smaller compaction window: the scene follows the second figure.
  windowPercent = 50
  await $.turn.start({ text: 'More', turnId: 't2' })
  expect(await drawn(ui)).toContain('50%')
  expect(low).toContain('30%')
  await ui.unmount()
})

test('Pokémon Pixel shows the context as HP and more creatures as the window fills', async ($, on) => {
  world(on)
  await $.session.start(START)
  expect(await cmd($, 'pokemon-pixel session')).toContain('Pokémon Pixel is set.')
  const ui = await $.ui.mount({ ...backdrop('pokemon-pixel'), surface: 'desktop' })
  const low = await drawn(ui)
  expect(low).toContain('100/100')
  expect(low).toContain('id="wild-ember"')
  expect(low).not.toContain('id="wild-splash"')
  percent = 85
  await $.turn.start({ text: 'Fill the window', turnId: 't1' })
  const high = await drawn(ui)
  expect(high).toContain('15/100')
  expect(high).toContain('id="wild-splash"')
  expect(high).toContain('id="wild-sprout"')
  await ui.unmount()
})

test('the takes of the theme back from another mod are limited to six in a minute', () => {
  let times: number[] = []
  const allowed: boolean[] = []
  for (let i = 0; i < 8; i++) {
    const r = retakeBudget(times, i * 1000)
    times = r.times
    allowed.push(r.isAllowed)
  }
  expect(allowed).toEqual([true, true, true, true, true, true, false, false])
  // A minute later the budget is whole again.
  expect(retakeBudget(times, 61_000).isAllowed).toBe(true)
})

test('the fill is also read on the timer, so /clear lowers the snow', async ($, on) => {
  const clock = world(on)
  await $.session.start(START)
  await cmd($, 'christmas-night')
  const ui = await $.ui.mount({ ...backdrop(XMAS.id), surface: 'desktop' })
  percent = 60
  await $.turn.start({ text: 'Work', turnId: 't1' })
  const high = await drawn(ui)
  percent = 0
  await clock.advance(31_000)
  expect((await drawn(ui)).length).toBeLessThan(high.length)
  await ui.unmount()
})

test('preview shows a theme for 20 seconds, then the applied one comes back', async ($, on) => {
  const clock = world(on)
  await $.session.start(START)
  await cmd($, 'pixel-blue')
  expect(await cmd($, 'preview christmas-night')).toContain('Preview of Christmas Night is set.')
  expect(SETS[SETS.length - 1]?.backdrop).toMatchObject({ scene: XMAS.id })
  await clock.advance(21_000)
  expect(SETS[SETS.length - 1]?.backdrop).toMatchObject({ scene: PIXEL.id })
})

test('the card lists the themes, and a press applies one', async ($, on) => {
  world(on, { applied: 'none' })
  await $.session.start(START)
  expect(await cmd($, '')).toBe('Pick a theme on the card.')
  const ui = await $.ui.mount({ ...CARD, surface: 'desktop' })
  expect(await ui.find({ key: `apply-${XMAS.id}` })).toBeDefined()
  expect(await ui.find({ key: `preview-${PIXEL.id}` })).toBeDefined()
  await ui.press({ key: `apply-${XMAS.id}` })
  expect(SETS[0]?.backdrop).toMatchObject({ scene: XMAS.id })
  // The press put the card away.
  expect(await ui.find({ key: 'close' })).toBeUndefined()
  await ui.unmount()
})

test('with no surface for a placed row the card shows above the prompt', async ($, on) => {
  world(on)
  isPlaced = false
  await $.session.start(START)
  await cmd($, '')
  const band = await $.ui.mount({
    plugin: 'custom-themes',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  })
  expect(await band.find({ key: 'close' })).toBeDefined()
  await band.press({ key: 'close' })
  expect(await band.find({ key: 'close' })).toBeUndefined()
  await band.unmount()
})

test('a build that refuses the style keeps the colors and the scene', async ($, on) => {
  world(on, { applied: 'none' })
  isStyleRefused = true
  await $.session.start(START)
  expect(await cmd($, 'christmas-night')).toContain('refused the message style')
  expect(SETS[0]?.style).toBeUndefined()
  expect(SETS[0]?.backdrop).toMatchObject({ scene: XMAS.id })
})

test('otherOwner: another plugin owns the theme; this mod, the engine and a settings hook do not', () => {
  expect(otherOwner({ plugin: 'theme-examples', tier: 'user' }, 'custom-themes')).toBe('theme-examples')
  expect(otherOwner({ plugin: 'custom-themes', tier: 'user' }, 'custom-themes')).toBeUndefined()
  expect(otherOwner({ plugin: 'engine', tier: 'core' }, 'custom-themes')).toBeUndefined()
  expect(otherOwner({ plugin: 'hook:SessionStart', tier: 'user' }, 'custom-themes')).toBeUndefined()
  expect(otherOwner(undefined, 'custom-themes')).toBeUndefined()
})

// A second theme mod that sets its own theme at each session start.
const OTHER_THEME = {
  name: 'other-theme',
  register(on: On) {
    on('session.start', async ($, e, next) => {
      await $.theme.set({ backdrop: { scene: 'other-scene' } })
      return next(e)
    })
  },
}

test('a second theme owner at the session start: a toast, and this mod sets no theme and takes none back', { plugins: [OTHER_THEME] }, async ($, on) => {
  const clock = world(on)
  await $.session.start(START)
  await clock.advance(1000)
  expect(SETS.map(s => (s.backdrop as { scene?: string } | undefined)?.scene)).toEqual(['other-scene'])
  expect(TOASTS.join('\n')).toContain('the plugin other-theme also sets the theme, so custom-themes sets none in this session')
  // The person's own pick still applies.
  expect(await cmd($, 'pixel-blue session')).toContain('Pixel Blue is set.')
  expect(SETS[SETS.length - 1]?.backdrop).toMatchObject({ scene: PIXEL.id })
})
