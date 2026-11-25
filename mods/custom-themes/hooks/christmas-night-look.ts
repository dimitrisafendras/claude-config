import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { SCENE } from './christmas-night-scene'

// A dark look only: a winter night. The grays have a deep indigo tint, the accent is warm gold,
// and red, green and amber keep their meaning.
const made = makeColors({
  label: 'Christmas Night',
  only: 'dark',
  roles: { accent: '#e2b44a', danger: '#e25563', success: '#3fae74', warning: '#e09a32', pro: '#9a86f2' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0d1030',
        'surface-1': '#12163c',
        'surface-2': '#161b45',
        'surface-3': '#1a204e',
        'text-primary': '#eef3ff',
        'text-secondary': '#d6def0',
        'text-muted': '#bcc7e0',
      },
    },
  },
})

/** Contrast notes from makeColors. A line that starts "Desktop won't paint" stops the whole theme. */
export const PROBLEMS: readonly string[] = made.problems

/** The colors alone: what stays when the app refuses the scene or the style. */
export const COLORS: ThemeSetArgs = { colors: made.theme, overrideColorScheme: 'dark' }

// A message sits on a matte indigo card: flat, solid, no shadow.
const CARD = { backgroundColor: '#1d2560', radius: 14, padding: 14, shadow: 'none' } as const

/**
 * The whole look: the colors, the scene behind the conversation, an indigo frosted glass on the panels of the app
 * (a light blur, so the shapes of the scene stay in view, and a dark tint, so the rows that a theme cannot give a card stay easy to read: command output, notes of the app, the status line), and matte indigo cards under the messages and tool rows.
 */
export const LOOK: ThemeSetArgs = {
  colors: made.theme,
  overrideColorScheme: 'dark',
  backdrop: { scene: SCENE, glass: { blur: 6, tint: '#0b0f2e', opacity: 0.66 } },
  style: {
    UserMessage: { ...CARD, backgroundColor: '#2a3478', borderColor: '#e2b44a66', borderWidth: 1 },
    AssistantMessage: CARD,
    ToolUse: { color: '#eef3ff', backgroundColor: '#1d2560', radius: 8, paddingX: 8 },
  },
}
