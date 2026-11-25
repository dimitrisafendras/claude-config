import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { SCENE } from './christmas-night-scene'

// A dark look only: a winter night. The grays have a deep navy tint, the accent is warm gold,
// and red, green and amber keep their meaning.
const made = makeColors({
  label: 'Christmas Night',
  only: 'dark',
  roles: { accent: '#e2b44a', danger: '#e25563', success: '#3fae74', warning: '#e09a32', pro: '#9a86f2' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#07101f',
        'surface-1': '#0b1628',
        'surface-2': '#0e1a2f',
        'surface-3': '#101d34',
        'text-primary': '#eef3ff',
        'text-secondary': '#c6d1e8',
        'text-muted': '#9eacc9',
      },
    },
  },
})

/** Contrast notes from makeColors. A line that starts "Desktop won't paint" stops the whole theme. */
export const PROBLEMS: readonly string[] = made.problems

/** The colors alone: what stays when the app refuses the scene or the style. */
export const COLORS: ThemeSetArgs = { colors: made.theme, overrideColorScheme: 'dark' }

// A message sits on a matte blue card: flat, solid, no shadow.
const CARD = { backgroundColor: '#132a52', radius: 10, padding: 14, shadow: 'none' } as const

/**
 * The whole look: the colors, the scene behind the conversation, a blue frosted glass on the panels of the app
 * (the same strength as the official dark themes), and matte blue cards under the messages and tool rows.
 */
export const LOOK: ThemeSetArgs = {
  colors: made.theme,
  overrideColorScheme: 'dark',
  backdrop: { scene: SCENE, glass: { blur: 14, tint: '#0a1430', opacity: 0.45 } },
  style: {
    UserMessage: { ...CARD, backgroundColor: '#1c3764', borderColor: '#e2b44a66', borderWidth: 1 },
    AssistantMessage: CARD,
    ToolUse: { color: '#eef3ff', backgroundColor: '#132a52', radius: 8, paddingX: 8 },
  },
}
