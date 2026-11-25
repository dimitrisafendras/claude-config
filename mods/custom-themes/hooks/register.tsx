import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import { THEMES, themeOf } from './themes'
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

/** Sets a theme's look and says in one line what happened. A build that refuses the style keeps the colors and the scene. */
async function setLook($: $, theme: Theme): Promise<string> {
  const say = (set: { isDrawn: boolean; reason?: string }, note = '') =>
    set.isDrawn ? `${theme.title} is set.${note}` : `${theme.title} is set, but this window draws no theme: ${set.reason ?? 'unknown'}`
  try {
    return say(await $.theme.set(theme.look))
  } catch (err) {
    const { style: _style, ...without }: ThemeSetArgs = theme.look
    try {
      return say(await $.theme.set(without), ` The app refused the message style: ${message(err)}`)
    } catch (again) {
      return `The app refused ${theme.title}: ${message(again)}`
    }
  }
}

/** Applies a theme (or none) and keeps the choice: in the store for the project, or in the session state only. */
async function apply($: $, theme: Theme | undefined, forProject: boolean): Promise<string> {
  if (theme === undefined) {
    if (forProject) await $.store.set(STORE_KEY, 'none')
    const scope: Choice['scope'] = forProject ? undefined : 'session'
    await update($, choice, was => ({ ...was, applied: undefined, scope, preview: undefined }))
    await $.theme.clear()
    return 'No theme.'
  }
  if (forProject) await $.store.set(STORE_KEY, theme.id)
  const scope: Choice['scope'] = forProject ? 'project' : 'session'
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
      else await $.theme.clear()
    } catch {
      // The look that stays is the preview; the next command sets another.
    }
  })
  return `Preview of ${said} It ends in 20 seconds.`
}

/** The theme at a start: the session's own choice, else the project's from the store. */
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
  return `Themes (${THEMES.length}):\n${lines.join('\n')}\n/${COMMAND} <name> applies one to this project; add "session" for this session only. /${COMMAND} off clears it. /${COMMAND} preview <name> shows it for 20 seconds.`
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Custom themes of this setup: a card to pick one. Add a name to apply it, "list" to see all, "off" to clear, "preview <name>" for a look.',
        argumentHint: '[<name> [session] | list | off | preview <name>]',
      })
      // A theme does not stay through a reload or --resume, so set it at each start.
      await startTheme($)
      await refresh($)
      // No event says that the person ran /clear, so the fill is also read on a slow timer.
      $.clock.every(30_000, () => refresh($))
    } catch {
      // The look is decoration. A failure must not stop the session.
    }
    return next(e)
  })

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
      return { text: `${said}${forSession ? ' This session only.' : ' Saved for this project.'}${unpainted === undefined ? '' : `\n${unpainted}`}` }
    } catch (err) {
      return { text: `Custom themes: the change failed (${message(err)}).` }
    }
  })
}
