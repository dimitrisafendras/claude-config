import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { SCENE } from './pokemon-art'

// A dark look only: the navy of a battle menu. The accent is the yellow of the games, danger is their red,
// and green and amber keep their meaning.
const made = makeColors({
  label: 'Pokémon Pixel',
  only: 'dark',
  roles: { accent: '#ffcb05', danger: '#ee3b3b', success: '#40c850', warning: '#f8a820', pro: '#8a7cf0' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0e1432',
        'surface-1': '#131a40',
        'surface-2': '#182048',
        'surface-3': '#1d2650',
        'text-primary': '#f8f8f0',
        'text-secondary': '#d0d8f0',
        'text-muted': '#a8b4d8',
      },
    },
  },
})

/** Contrast notes from makeColors. A line that starts "Desktop won't paint" stops the whole theme. */
export const PROBLEMS: readonly string[] = made.problems

/** The colors alone: what stays when the app refuses the scene or the style. */
export const COLORS: ThemeSetArgs = { colors: made.theme, overrideColorScheme: 'dark' }

// A message is a dialog box of the games: a navy fill, a white border, square corners and a hard black shadow.
const DIALOG = { backgroundColor: '#151c48', borderColor: '#f8f8f0', borderWidth: 3, radius: 4, padding: 14, shadow: { x: 4, y: 4, blur: 0, color: '#000000' } } as const

/**
 * The whole look: the colors, the route behind the conversation (the Backdrop hook draws it), navy glass on the
 * panels, and dialog boxes under the messages. The person's own messages have the yellow border of a chosen menu row.
 */
export const LOOK: ThemeSetArgs = {
  colors: made.theme,
  overrideColorScheme: 'dark',
  backdrop: { scene: SCENE, glass: { blur: 10, tint: '#0e1432', opacity: 0.55 } },
  style: {
    Heading: { fontFamily: ['mono'], letterSpacing: 1 },
    UserMessage: { ...DIALOG, backgroundColor: '#1d2660', borderColor: '#ffcb05' },
    AssistantMessage: DIALOG,
    ToolUse: { color: '#f8f8f0', backgroundColor: '#151c48', radius: 2, paddingX: 8, fontFamily: ['mono'] },
  },
}
