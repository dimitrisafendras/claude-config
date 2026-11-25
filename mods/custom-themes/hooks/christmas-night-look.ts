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

// A message sits on a matte indigo card: flat, solid, no shadow.
const CARD = { backgroundColor: '#1d2560', radius: 14, padding: 14, shadow: 'none' } as const

/**
 * The whole look: the colors, the scene behind the conversation, an indigo frosted glass on the panels of the app
 * (a light blur, so the scene stays in view behind the conversation), and matte indigo cards under the messages and tool rows.
 */
export const LOOK: ThemeSetArgs = {
  colors: made.theme,
  overrideColorScheme: 'dark',
  backdrop: { scene: SCENE, glass: { blur: 6, tint: '#11153c', opacity: 0.34 } },
  style: {
    UserMessage: { ...CARD, backgroundColor: '#2a3478', borderColor: '#e2b44a66', borderWidth: 1 },
    AssistantMessage: CARD,
    ToolUse: { color: '#eef3ff', backgroundColor: '#1d2560', radius: 8, paddingX: 8 },
  },
}
