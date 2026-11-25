// The pixel art of the Pixel Blue theme: a night sky with the Orion constellation. All of it is original and drawn
// here, pixel by pixel. The backdrop of the desktop app shows more stars as the context window fills.

export type Pixel = 'd' | 'S' | 'o' | 'r'
export type Dot = { x: number; y: number; p: Pixel }

export const ORION_X = 21
export const ORION: readonly Dot[] = [
  { x: 1, y: 0, p: 'o' }, // left shoulder, orange
  { x: 5, y: 0, p: 'S' }, // right shoulder
  { x: 4, y: 2, p: 'S' }, // belt, top right
  { x: 3, y: 3, p: 'S' }, // belt, middle
  { x: 2, y: 4, p: 'S' }, // belt, bottom left
  { x: 3, y: 5, p: 'd' }, // sword
  { x: 3, y: 6, p: 'd' }, // sword
  { x: 1, y: 7, p: 'S' }, // left foot
  { x: 5, y: 7, p: 'r' }, // right foot, blue-white
]

// The other stars, as [x, y] points. Each one is dim on each third step, so the sky twinkles.
const STARS: readonly (readonly [number, number])[] = [
  [13, 1],
  [17, 2],
  [15, 6],
  [30, 5],
  [33, 1],
  [40, 2],
  [44, 5],
  [46, 0],
]

/**
 * The moving cloud at a step: where it is and its shape, or undefined while there is none.
 * It comes in at the left, goes across the moon, and dissolves before it gets to Orion.
 */
/** The name of the backdrop scene of the desktop app. */
export const SCENE = 'pixel-blue'

/** How many stars the backdrop shows for a context window that is `percent` full: 14 when empty, 64 when full. */
export function starCount(percent: number): number {
  const p = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0))
  return 14 + Math.round(p / 2)
}

// The places of the 64 backdrop stars on a 320 by 200 sky, from a fixed sequence, so the sky is the same each time.
const SKY_STARS: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = []
  let seed = 20261124
  const next = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return Math.floor((seed / 2147483648) * n)
  }
  while (out.length < 64) {
    const x = next(79) * 4 + 2
    const y = next(49) * 4 + 2
    // Keep the top right corner free: Orion is there.
    if (!(x > 230 && y < 80)) out.push([x, y])
  }
  return out
})()

/**
 * The backdrop of the desktop app: a still night sky of pixel stars behind the conversation, with Orion
 * in the top right corner. More stars come out as the context window fills. The colors follow the mode.
 */
export function skyOf(percent: number): string {
  const stars = SKY_STARS.slice(0, starCount(percent)).map(([x, y], i) => {
    const tone = i % 7 === 0 ? 'c' : i % 2 === 0 ? 'b' : 'a'
    // Each fifth star is a plus of five pixels. The others are one pixel.
    return i % 5 === 0
      ? `<path class="${tone}" d="M${x} ${y - 2}h2v2h2v2h-2v2h-2v-2h-2v-2h2z"/>`
      : `<rect class="${tone}" x="${x}" y="${y}" width="2" height="2"/>`
  })
  const orion = ORION.map(d => `<rect class="${d.p === 'd' ? 'b' : 'c'}" x="${44 + d.x * 2}" y="${6 + d.y * 2}" width="1" height="1"/>`)
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges">' +
    '<style>.k{fill:#e9f1fc}.a{fill:#d5e3f8}.b{fill:#c2d6f3}.c{fill:#a9c2ec}' +
    '@media (prefers-color-scheme: dark){.k{fill:#0a1124}.a{fill:#1a2a50}.b{fill:#2a4078}.c{fill:#4a66a8}}</style>' +
    `<rect class="k" width="320" height="200"/>${stars.join('')}` +
    `<svg viewBox="0 0 64 64" preserveAspectRatio="xMaxYMin meet">${orion.join('')}</svg></svg>`
  )
}
