import type { ThemeSetArgs } from 'claude-code'

import { SCENE } from './pixel-blue-art'
import { makeColors } from './make-colors.js'

// The deep blue of a night sky in dark mode and the pale blue of a morning sky in light mode.
// Every gray has a blue tint.
// Red, green and amber keep their meaning.
const made = makeColors({
  label: 'Pixel Blue',
  roles: { accent: '#2f7df6', danger: '#d6455d', success: '#2e9e6b', warning: '#c98a1b', pro: '#7a5cf0' },
  light: {
    gray: {
      anchors: {
        'surface-0': '#e9f1fc',
        'surface-1': '#f1f6fe',
        'surface-2': '#fafcff',
        'text-primary': '#0e1f40',
        'text-secondary': '#2c416b',
        'text-muted': '#4a5f8a',
      },
    },
  },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0a1124',
        'surface-1': '#0e1830',
        'surface-2': '#111d37',
        'surface-3': '#13203c',
        'text-primary': '#e6eeff',
        'text-secondary': '#b9c8ea',
        'text-muted': '#93a5cf',
      },
    },
  },
})

/** Contrast notes from makeColors. A line that starts "Desktop won't paint" stops the whole theme. */
export const PROBLEMS: readonly string[] = made.problems

/** The colors alone: what stays when the art is off. */
export const COLORS: ThemeSetArgs = { colors: made.theme }

/**
 * The colors and the pixel art of the desktop app: a night-sky scene behind the conversation (the Backdrop
 * hook draws it), and square messages with a hard shadow. Both modes have colors, so the mode stays the person's.
 */
export const LOOK: ThemeSetArgs = {
  colors: made.theme,
  backdrop: { scene: SCENE, glass: false },
  style: {
    Heading: { fontFamily: ['mono'], letterSpacing: 1 },
    UserMessage: {
      radius: 0,
      borderColor: 'border-accent',
      borderWidth: 2,
      shadow: { x: 4, y: 4, blur: 0, color: 'border-accent' },
    },
    ToolUse: { radius: 0, fontFamily: ['mono'] },
  },
}
