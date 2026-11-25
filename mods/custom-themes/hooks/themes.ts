// The themes of this mod, one row each. A theme is a whole look for $.theme.set (colors, glass, message cards)
// and a scene that the Backdrop hook draws. A scene may follow the context fill: the hook gives it the percent.
import type { ThemeSetArgs } from 'claude-code'

import { LOOK as CHRISTMAS_LOOK, PROBLEMS as CHRISTMAS_PROBLEMS } from './christmas-night-look'
import { SCENE as CHRISTMAS_SCENE, flakeCount, sceneOf as christmasScene } from './christmas-night-scene'
import { SCENE as PIXEL_SCENE, skyOf, starCount } from './pixel-blue-art'
import { LOOK as PIXEL_LOOK, PROBLEMS as PIXEL_PROBLEMS } from './pixel-blue-look'

export type Theme = {
  /** The name to type: letters, digits and hyphens. It is also the scene name in the look. */
  id: string
  title: string
  blurb: string
  /** Which window the look is made for. */
  window: 'light' | 'dark' | 'both'
  /** The whole look. Its backdrop scene is `id`. */
  look: ThemeSetArgs
  /** The scene for a context fill in percent. */
  scene: (percent: number) => string
  /** One line for the alt text of the scene. */
  alt: (percent: number) => string
  /** Contrast notes of the colors; a line that starts "Desktop won't paint" stops the whole theme. */
  problems: readonly string[]
}

export const THEMES: readonly Theme[] = [
  {
    id: CHRISTMAS_SCENE,
    title: 'Christmas Night',
    blurb: 'Snowy pine trees with lights and a star on each top, a moon, falling snow. The snow ground rises as the context fills and falls after /compact or /clear.',
    window: 'dark',
    look: CHRISTMAS_LOOK,
    scene: christmasScene,
    alt: percent => `A Christmas night: snowy pine trees with lights under a moon, ${flakeCount(percent)} falling flakes, and snow on the ground at ${percent} percent of the context window`,
    problems: CHRISTMAS_PROBLEMS,
  },
  {
    id: PIXEL_SCENE,
    title: 'Pixel Blue',
    blurb: 'A pixel night sky with Orion: more stars as the context fills, fewer after /compact. Deep blue colors for dark and light mode, square messages.',
    window: 'both',
    look: PIXEL_LOOK,
    scene: skyOf,
    alt: percent => `A night sky of ${starCount(percent)} pixel stars with the Orion constellation`,
    problems: PIXEL_PROBLEMS,
  },
]

export function themeOf(id: string | undefined): Theme | undefined {
  if (id === undefined) return undefined
  const key = id.trim().toLowerCase()
  return THEMES.find(t => t.id === key || t.title.toLowerCase() === key)
}
