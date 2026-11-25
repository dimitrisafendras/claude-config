import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import { THEMES, otherOwner, retakeBudget, themeOf } from './themes'
import type { Theme } from './themes'
import type { Choice } from '../types'

type $ = EngineInterface

const PLUGIN = 'custom-themes'
const CARD = 'themes-card'
// Not `theme`: that is the engine's own command (the terminal's color theme). Not `custom-theme`: the theme-examples plugin has it.
const COMMAND = 'themes'
const PREVIEW_MS = 20_000
const STORE_KEY = 'applied'

const choice = atom({ plugin: 'custom-themes', key: 'choice' } as const, {} as Choice, { shape: 'choice-1' })
// How full the context window is, in percent, to the nearest 5. A scene that follows the fill reads it.
const fill = atom({ plugin: 'custom-themes', key: 'fill' } as const, 0)

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 160)

/** Reads the context window (a free call) and keeps its fill. A change draws the backdrop again. */
async function refresh($: $): Promise<void> {
  try {
    // The summary breakdown is free and measures against the compaction window, which may be smaller than the model window.
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const raw = context.breakdown?.percentage ?? context.percent ?? 0
    const now = Math.round(Math.min(100, Math.max(0, raw)) / 5) * 5
    if (now !== (await read($, fill))) await update($, fill, () => now)
  } catch {
    // The scene keeps the fill it has.
  }
}

// The theme calls of this mod are counted, so the hooks below tell them from the calls of another mod.
let ownCalls = 0
async function own<T>(fn: () => Promise<T>): Promise<T> {
  ownCalls += 1
  try {
    return await fn()
  } finally {
    ownCalls -= 1
  }
}

/** Sets a theme's look and says in one line what happened. A build that refuses the style keeps the colors and the scene. */
async function setLook($: $, theme: Theme): Promise<string> {
  const say = (set: { isDrawn: boolean; reason?: string }, note = '') =>
    set.isDrawn ? `${theme.title} is set.${note}` : `${theme.title} is set, but this window draws no theme: ${set.reason ?? 'unknown'}`
  try {
    return say(await own(() => $.theme.set(theme.look)))
  } catch (err) {
    const { style: _style, ...without }: ThemeSetArgs = theme.look
    try {
      return say(await own(() => $.theme.set(without)), ` The app refused the message style: ${message(err)}`)
    } catch (again) {
      return `The app refused ${theme.title}: ${message(again)}`
    }
  }
}

/** Applies a theme (or none) and keeps the choice: in the store for all projects (one file for the user), or in the session state only. */
async function apply($: $, theme: Theme | undefined, forAll: boolean): Promise<string> {
  hasYielded = false
  if (theme === undefined) {
    if (forAll) await $.store.set(STORE_KEY, 'none')
    const scope: Choice['scope'] = forAll ? undefined : 'session'
    await update($, choice, was => ({ ...was, applied: undefined, scope, preview: undefined }))
    await own(() => $.theme.clear())
    return 'No theme.'
  }
  if (forAll) await $.store.set(STORE_KEY, theme.id)
  const scope: Choice['scope'] = forAll ? 'project' : 'session'
  await update($, choice, was => ({ ...was, applied: theme.id, scope, preview: undefined }))
  return setLook($, theme)
}

let previewEnd: { cancel(): void } | undefined

async function preview($: $, theme: Theme): Promise<string> {
  previewEnd?.cancel()
  await update($, choice, was => ({ ...was, preview: theme.id }))
  const said = await setLook($, theme)
  previewEnd = $.clock.after(PREVIEW_MS, async () => {
    previewEnd = undefined
    try {
      const now = await read($, choice)
      if (now.preview !== theme.id) return
      await update($, choice, was => ({ ...was, preview: undefined }))
      const back = themeOf(now.applied)
      if (back !== undefined) await setLook($, back)
      else await own(() => $.theme.clear())
    } catch {
      // The look that stays is the preview; the next command sets another.
    }
  })
  return `Preview of ${said} It ends in 20 seconds.`
}

/** The theme at a start: the session's own choice, else the one from the store, which all projects share. */
async function startTheme($: $): Promise<void> {
  const now = await read($, choice)
  const own = now.scope === 'session' ? themeOf(now.applied) : undefined
  if (now.scope === 'session' && own === undefined) return
  const stored = await $.store.get(STORE_KEY)
  // Nothing stored yet: the first theme is the default. `/themes off` stores 'none', so a clear stays.
  const theme = own ?? (stored === undefined ? THEMES[0] : themeOf(typeof stored === 'string' ? stored : undefined))
  if (theme === undefined) return
  const scope: Choice['scope'] = own === undefined ? 'project' : 'session'
  await update($, choice, was => ({ ...was, applied: theme.id, scope }))
  await setLook($, theme)
}

function list(now: Choice): string {
  const lines = THEMES.map(t => `- ${t.id}${now.applied === t.id ? ' (applied)' : ''}: ${t.title}, for ${t.window === 'both' ? 'light and dark' : t.window} windows. ${t.blurb}`)
  return `Themes (${THEMES.length}):\n${lines.join('\n')}\n/${COMMAND} <name> applies one to all projects; add "session" for this session only. /${COMMAND} off clears it. /${COMMAND} preview <name> shows it for 20 seconds.`
}

async function putCardAway($: $): Promise<void> {
  await update($, choice, was => ({ ...was, cardInBand: false, cardAway: true }))
}

type CardElements = ReturnType<$['ui']['resolve']>

function card($: $, { Box, Text, Button }: CardElements, now: Choice) {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} gap="md">
      <Box flexDirection="row" gap={1}>
        <Text bold>Custom themes</Text>
        <Button key="off" label="No theme" onPress={async () => (await apply($, undefined, true), putCardAway($))}>
          No theme
        </Button>
        <Button key="close" label="Close" role="dismiss" autoFocus onPress={() => putCardAway($)}>
          Close
        </Button>
      </Box>
      {THEMES.map(theme => {
        const isApplied = now.applied === theme.id
        const applyWord = isApplied && now.scope === 'project' ? 'Applied' : 'Apply'
        const sessionWord = isApplied && now.scope === 'session' ? '✓ This session' : 'This session'
        const previewWord = now.preview === theme.id ? 'Previewing' : 'Preview'
        return (
          <Box key={`theme-${theme.id}`} flexDirection="column" gap="xs">
            <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap="md" rowGap="xs">
              <Text bold={isApplied}>
                {isApplied ? '✓ ' : ''}
                {theme.title}
                <Text dimColor>{` · ${theme.window === 'both' ? 'light and dark' : theme.window}`}</Text>
              </Text>
              <Box flexDirection="row" gap={1}>
                <Button key={`apply-${theme.id}`} label={applyWord} onPress={async () => (await apply($, theme, true), putCardAway($))}>
                  {applyWord}
                </Button>
                <Button key={`session-${theme.id}`} label={sessionWord} onPress={async () => (await apply($, theme, false), putCardAway($))}>
                  {sessionWord}
                </Button>
                <Button key={`preview-${theme.id}`} label={previewWord} onPress={() => preview($, theme)}>
                  {previewWord}
                </Button>
              </Box>
            </Box>
            <Text dimColor>{theme.blurb}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

// One theme owner. Another plugin that sets or clears the theme is seen by the origin of its call (`next.origin`).
// When one is seen by the end of the session start, this mod refuses to be the second owner: it says so in a toast
// and sets no theme in this session, and it does not take the theme back. A theme the person picks later with
// /themes or the card applies all the same (the person's ask wins).
let otherThemeOwner: string | undefined
let hasYielded = false

const RETAKE_DELAY_MS = 250
// The number of takes in a minute is limited (`retakeBudget`): a mod that sets its theme again and again must not start a fight with no end.
let retakeAt: number[] = []
let retaking: { cancel(): void } | undefined
let gaveUp = false

/**
 * Another mod can replace or clear the theme: the theme-examples plugin applies its own choice at each session start
 * and at each prompt. While a theme of this mod is applied, it wins, and this puts it back a moment after. A preview
 * is left alone, and `/themes off` lets go, since no theme is applied then.
 */
async function retake($: $): Promise<void> {
  retaking?.cancel()
  retaking = $.clock.after(RETAKE_DELAY_MS, async () => {
    retaking = undefined
    try {
      if (hasYielded) return
      const now = await read($, choice)
      if (now.preview !== undefined) return
      const theme = themeOf(now.applied)
      if (theme === undefined) return
      const budget = retakeBudget(retakeAt, await $.clock.now())
      retakeAt = budget.times
      if (!budget.isAllowed) {
        if (!gaveUp) {
          gaveUp = true
          void $.ui.toast('custom-themes: another mod keeps replacing the theme, so it stops taking the theme back. Turn that mod off, or type /themes off.')
        }
        return
      }
      await setLook($, theme)
    } catch {
      // The look is decoration. A failure here must not reach the other mod or the session.
    }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The other plugins start first, so a theme that one of them sets at its start is seen before this mod sets one.
    const started = await next(e)
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Custom themes of this setup: a card to pick one. Add a name to apply it, "list" to see all, "off" to clear, "preview <name>" for a look.',
        argumentHint: '[<name> [session] | list | off | preview <name>]',
      })
      // A theme does not stay through a reload or --resume, so set it at each start, unless another plugin owns it.
      if (otherThemeOwner !== undefined) {
        hasYielded = true
        $.ui.toast(`custom-themes: the plugin ${otherThemeOwner} also sets the theme, so custom-themes sets none in this session (one theme owner). Turn one of them off, or pick a theme with /themes.`)
      } else {
        await startTheme($)
      }
      await refresh($)
      // No event says that the person ran /clear, so the fill is also read on a slow timer.
      $.clock.every(30_000, () => refresh($))
    } catch {
      // The look is decoration. A failure must not stop the session.
    }
    return started
  })

  // A theme set or cleared by another mod: take the applied theme back (see `retake`). The call of the other mod goes on.
  // One hook for each event, each with its own literal name.
  on('theme.set', async ($, e, next) => {
    const result = await next(e)
    if (ownCalls === 0) {
      otherThemeOwner = otherOwner(next.origin, PLUGIN) ?? otherThemeOwner
      await retake($)
    }
    return result
  }).catch(($, e, next) => next(e))
  on('theme.clear', async ($, e, next) => {
    const result = await next(e)
    if (ownCalls === 0) {
      otherThemeOwner = otherOwner(next.origin, PLUGIN) ?? otherThemeOwner
      await retake($)
    }
    return result
  }).catch(($, e, next) => next(e))

  // The context window changes with each turn and after a compaction.
  on('turn.start', async ($, e, next) => {
    await refresh($)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  }).catch(($, e, next) => next(e))

  // The desktop and mobile apps ask for the scene that $.theme.set named. Each mod hears it, so check whose it is.
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if (e.props.plugin !== PLUGIN) return next(e)
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    const theme = THEMES.find(t => t.id === e.props.scene)
    if (theme === undefined) return next(e)
    try {
      const percent = await read($, fill)
      const { Svg } = $.ui.resolve(e)
      return <Svg source={theme.scene(percent)} alt={theme.alt(percent)} />
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== PLUGIN || e.props.id !== CARD) return next(e)
    const now = await read($, choice)
    if (now.cardAway === true) return next(e)
    return card($, $.ui.resolve(e), now)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, choice)
    if (now.cardInBand !== true) return next(e)
    return card($, $.ui.resolve(e), now)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    try {
      const words = (e.args ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
      const now = await read($, choice)
      if (words.length === 0) {
        const placed = await $.ui.place({ id: CARD })
        await update($, choice, w => ({ ...w, cardInBand: !placed.isPlaced, cardAway: false }))
        return { text: 'Pick a theme on the card.' }
      }
      if (words[0] === 'list') return { text: list(now) }
      if (words[0] === 'off') return { text: await apply($, undefined, words[1] !== 'session') }
      if (words[0] === 'preview') {
        const theme = themeOf(words.slice(1).join(' '))
        return { text: theme === undefined ? `No theme named "${words.slice(1).join(' ')}". ${list(now)}` : await preview($, theme) }
      }
      const forSession = words[words.length - 1] === 'session'
      const name = (forSession ? words.slice(0, -1) : words).join(' ')
      const theme = themeOf(name)
      if (theme === undefined) return { text: `No theme named "${name}". ${list(now)}` }
      const unpainted = theme.problems.find(p => p.startsWith("Desktop won't paint"))
      const said = await apply($, theme, !forSession)
      return { text: `${said}${forSession ? ' This session only.' : ' Saved for all projects.'}${unpainted === undefined ? '' : `\n${unpainted}`}` }
    } catch (err) {
      return { text: `Custom themes: the change failed (${message(err)}).` }
    }
  })
}
