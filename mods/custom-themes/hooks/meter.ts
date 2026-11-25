import type { ThemeColors } from 'claude-code'

/**
 * A theme whose accent is a yellow or a gold, with a green accent fill.
 *
 * The app paints each meter (the usage bars, the context ring) in the accent fill below 75 percent, in the warning
 * fill from 75 percent and in the danger fill from 90 percent. With a gold accent, a meter is yellow at each level,
 * so it always reads as a warning. The accent fill takes the success fill of the same theme, with its text color:
 * a meter then goes from green to amber to red. The accent of the text and of the borders stays as it is.
 */
export function greenMeter(theme: ThemeColors): ThemeColors {
  const dark = theme.inputs.dark
  if (dark === undefined) return theme
  const from = dark as Record<string, `#${string}` | undefined>
  const fill = from['role-success-fill']
  const hover = from['role-success-fill-hover']
  const on = from['role-success-on']
  if (fill === undefined || hover === undefined || on === undefined) return theme

  return {
    ...theme,
    inputs: { ...theme.inputs, dark: { ...dark, 'role-accent-fill': fill, 'role-accent-fill-hover': hover, 'role-accent-on': on } },
  }
}
