// The pixel art of the Pokémon Pixel theme: a sunny route of the handheld era, drawn here pixel by pixel on a
// 320 by 180 grid. All of the art is original, in the style of the first handheld games: round trees, tall grass,
// a small town, a pond, and three wild creatures of our own that come out of the grass as the context fills.
// The context window is the HP bar of a battle box: full at the start, empty when the window is full.

/** The name of the backdrop scene of the desktop app. */
export const SCENE = 'pokemon-pixel'

const W = 320
const H = 180

type Pal = Readonly<Record<string, string>>

const clamp = (n: number): number => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0))

/** The health that is left in a battle box: 100 for an empty context window, 0 for a full one. */
export function hpLeft(percent: number): number {
  return 100 - Math.round(clamp(percent))
}

/** The bar color: green, yellow under half, red under a fifth, as in the games. */
export function hpColor(hp: number): string {
  return hp > 50 ? '#40c850' : hp > 20 ? '#f8c820' : '#f04838'
}

/** How many wild creatures stand in the grass: one at the start, two from 35 percent, three from 70 percent. */
export function creatureCount(percent: number): number {
  const p = clamp(percent)
  return p >= 70 ? 3 : p >= 35 ? 2 : 1
}

/** One line for the alt text of the scene. */
export function altOf(percent: number): string {
  return `A pixel art route of a handheld monster game: round trees, tall grass, a small town and ${creatureCount(percent)} wild creatures, with a battle box that shows ${hpLeft(percent)} of 100 health for the context window`
}

/** A sprite as merged paths, one for each color: the scene has no `<use>`, since the renderer takes no href. */
function paths(rows: readonly string[], pal: Pal): string {
  const byColor = new Map<string, string>()
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const c = row[x] as string
      let n = 1
      while (row[x + n] === c) n += 1
      const fill = pal[c]
      if (fill !== undefined) byColor.set(fill, `${byColor.get(fill) ?? ''}M${x} ${y}h${n}v1h${-n}z`)
      x += n
    }
  })
  return [...byColor].map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`).join('')
}

const SPRITES = new Map<string, string>()
/** Registers a sprite by name. It returns nothing to draw: `put` draws it. */
const def = (id: string, rows: readonly string[], pal: Pal): string => {
  if (!SPRITES.has(id)) SPRITES.set(id, paths(rows, pal))
  return ''
}
/** One sprite at a place. A class goes on an inner group, since an animation of the class would replace the place. */
const put = (id: string, x: number, y: number, cls = ''): string => {
  const body = SPRITES.get(id) ?? ''
  return `<g transform="translate(${x} ${y})">${cls === '' ? body : `<g class="${cls}">${body}</g>`}</g>`
}
const sprite = (id: string): string => SPRITES.get(id) ?? ''
/** Many same-colored small rects as one path: far smaller than one rect element for each. */
const dots = (fill: string, list: readonly (readonly [number, number, number, number])[]): string =>
  `<path fill="${fill}" d="${list.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}z`).join('')}"/>`
const box = (x: number, y: number, w: number, h: number, fill: string): string => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`
// ---- sprites -------------------------------------------------------------------------------------------------

const TREE: readonly string[] = [
  '.....kkkkkkk....',
  '...kkggggggkk...',
  '..kgggghgggggk..',
  '.kggghggggggggk.',
  '.kgggggggGgggGk.',
  'kgghgggggggggGGk',
  'kggggggGgggggGGk',
  'kgggGgggggggGGGk',
  'kggggggggggGGGGk',
  '.kgggggggGGGGGk.',
  '.kgggGGGGGGGGGk.',
  '..kkGGGGGGGGkk..',
  '....kkkkkkkk....',
  '......ktTk......',
  '......ktTk......',
  '.....kkkkkk.....',
]
const TREE_PAL: Pal = { k: '#1c3a28', g: '#3aa050', h: '#7ce070', G: '#2a7a40', t: '#a06a30', T: '#7a4a20' }

const TUFT: readonly string[] = [
  '...g....g...',
  '..gG..g.gG..',
  '.gGg.gGgGg..',
  'gGgGgGGGgGg.',
  'GGGGGGGGGGGG',
]
const TUFT_PAL: Pal = { g: '#58c860', G: '#2f9a48' }

const FLOWER_A: readonly string[] = ['.r.', 'rYr', '.r.', '.g.']
const FLOWER_B: readonly string[] = ['...', '.r.', '.Y.', '.g.']
const FLOWER_PAL: Pal = { r: '#f05068', Y: '#f8e030', g: '#2f9a48' }

const BALL: readonly string[] = ['..kkkk..', '.krrrrk.', 'krrrrrrk', 'kkkwwkkk', 'kwwkkwwk', 'kwwwwwwk', '.kwwwwk.', '..kkkk..']
const BALL_PAL: Pal = { k: '#202028', r: '#e8403a', w: '#f8f8f8' }

const CLOUD: readonly string[] = [
  '.........wwww...............',
  '......wwwwwwwwww....wwww....',
  '....wwwwwwwwwwwwwwwwwwwwww..',
  '..wwwwwwwwwwwwwwwwwwwwwwwww.',
  '.wwwwwwwwwwwwwwwwwwwwwwwwwww',
  'wwssssssssssssssssssssssssww',
]
const CLOUD_PAL: Pal = { w: '#ffffff', s: '#d4e6f8' }

// Three wild creatures, original designs, built from ellipses by a small rasterizer: it outlines the shape,
// shades the lower edge and lights the upper edge, so each sprite has the look of hand-made pixel art. Each faces right.
type Part = { e: readonly [number, number, number, number]; c: string } | { r: readonly [number, number, number, number]; c: string }

function raster(w: number, h: number, parts: readonly Part[], dots: readonly (readonly [number, number, string])[], shade: Record<string, string>, light: Record<string, string>): string[] {
  const g: string[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => '.'))
  for (const part of parts) {
    if ('e' in part) {
      const [cx, cy, rx, ry] = part.e
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) (g[y] as string[])[x] = part.c
    } else {
      const [x0, y0, ww, hh] = part.r
      for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + ww; x++) if (g[y]?.[x] !== undefined) (g[y] as string[])[x] = part.c
    }
  }
  const at = (x: number, y: number): string => g[y]?.[x] ?? '.'
  const out: string[][] = g.map(row => [...row])
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = at(x, y)
      if (c === '.') continue
      if (shade[c] !== undefined && (at(x, y + 1) === '.' || at(x + 1, y + 1) === '.' || (at(x, y + 2) === '.' && at(x + 1, y) === '.'))) (out[y] as string[])[x] = shade[c] as string
      else if (light[c] !== undefined && at(x, y - 1) === '.' && at(x - 1, y) !== '.' ) (out[y] as string[])[x] = light[c] as string
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y) === '.' && (at(x - 1, y) !== '.' || at(x + 1, y) !== '.' || at(x, y - 1) !== '.' || at(x, y + 1) !== '.')) (out[y] as string[])[x] = 'k'
  for (const [x, y, c] of dots) if (out[y]?.[x] !== undefined) (out[y] as string[])[x] = c
  return out.map(r => r.join(''))
}

const EMBER: readonly string[] = raster(
  28,
  26,
  [
    { e: [8, 19, 3.2, 2.2], c: 'o' }, { e: [5, 17, 2.4, 2.2], c: 'o' }, { e: [3.5, 14, 2, 2.4], c: 'o' },
    { e: [3, 9, 3.2, 4.8], c: 'r' }, { e: [3, 10, 1.8, 3.2], c: 'f' },
    { e: [13, 17, 6.5, 5], c: 'o' }, { e: [15.5, 18, 3.8, 4], c: 'y' },
    { r: [8, 21, 4, 4], c: 'o' }, { r: [16, 21, 4, 4], c: 'o' },
    { e: [18, 9, 6, 5.2], c: 'o' }, { e: [23, 11, 3.2, 2.6], c: 'o' },
    { e: [16.5, 4, 1.6, 2.2], c: 'O' },
    { e: [17, 15, 1.8, 2.6], c: 'o' },
  ],
  [[20, 7, 'w'], [21, 7, 'w'], [20, 8, 'w'], [21, 8, 'k'], [22, 13, 'k'], [23, 13, 'k'], [24, 11, 'k'], [19, 11, 'R'], [12, 22, 'k'], [20, 22, 'k'], [12, 23, 'k'], [20, 23, 'k']],
  { o: 'O', y: 'Y' },
  { o: 'L' },
)
const EMBER_PAL: Pal = { k: '#2a1810', o: '#f58a3a', O: '#c85a1a', L: '#fbb060', y: '#fbd890', Y: '#e8b868', w: '#ffffff', r: '#e83a20', f: '#fbe040', R: '#e86050' }

const SPROUT: readonly string[] = raster(
  28,
  26,
  [
    { r: [7, 20, 4, 5], c: 'a' }, { r: [12, 20, 4, 5], c: 'a' }, { r: [18, 20, 4, 5], c: 'a' }, { r: [23, 20, 3, 5], c: 'a' },
    { e: [14, 16, 9.5, 5.5], c: 'a' },
    { e: [23, 14, 4.2, 3.8], c: 'a' }, { e: [21, 10, 1.6, 2.4], c: 'a' }, { e: [25, 10, 1.4, 2], c: 'a' },
    { e: [12, 9, 5.4, 4.6], c: 'G' }, { e: [12, 4, 1.6, 3], c: 'h' }, { e: [8.5, 5.5, 2.4, 1.4], c: 'h' }, { e: [15.5, 5.5, 2.4, 1.4], c: 'h' },
  ],
  [[24, 12, 'w'], [25, 12, 'w'], [24, 13, 'k'], [25, 13, 'R'], [9, 14, 'D'], [10, 14, 'D'], [15, 18, 'D'], [16, 18, 'D'], [19, 15, 'D'], [26, 17, 'k'], [27, 16, 'k'], [12, 7, 'h'], [11, 8, 'h'], [14, 10, 'g'], [10, 11, 'g'], [26, 15, 'D']],
  { a: 'D', G: 'g' },
  { a: 'A', G: 'h' },
)
const SPROUT_PAL: Pal = { k: '#10281c', a: '#58b89a', D: '#2f8a6e', A: '#8adcbc', G: '#4cc048', g: '#2c8c34', h: '#9cec78', w: '#ffffff', R: '#e03030' }

const SPLASH: readonly string[] = raster(
  28,
  26,
  [
    { e: [5, 19, 3.2, 1.8], c: 'b' }, { e: [3, 17, 2, 1.8], c: 'b' },
    { e: [13, 16, 8.5, 6], c: 'b' },
    { r: [8, 21, 4, 4], c: 'b' }, { r: [17, 21, 4, 4], c: 'b' },
    { e: [11, 14, 7, 5.6], c: 'n' },
    { e: [16, 19, 4.5, 3], c: 'y' },
    { e: [22, 11, 4.8, 4.2], c: 'b' }, { e: [26, 13, 2, 1.6], c: 'b' },
    { e: [20.5, 7, 1.4, 2], c: 'b' },
  ],
  [[22, 9, 'w'], [23, 9, 'w'], [22, 10, 'k'], [23, 10, 'k'], [26, 13, 'k'], [25, 14, 'k'], [8, 12, 'N'], [9, 12, 'N'], [10, 12, 'N'], [13, 12, 'N'], [14, 12, 'N'], [7, 15, 'N'], [8, 15, 'N'], [13, 15, 'N'], [14, 15, 'N'], [15, 15, 'N'], [10, 9, 'h'], [11, 9, 'h']],
  { b: 'B', n: 'N', y: 'Y' },
  { b: 'l', n: 'M' },
)
const SPLASH_PAL: Pal = { k: '#101c38', b: '#58a8f0', B: '#2c6cc0', l: '#90ccff', n: '#b07838', N: '#7a4a20', M: '#d09858', y: '#f8e8b0', Y: '#d8c488', w: '#ffffff', h: '#e8b878' }

const CREATURES: readonly { id: string; x: number; y: number }[] = [
  { id: 'ember', x: 58, y: 134 },
  { id: 'splash', x: 232, y: 132 },
  { id: 'sprout', x: 128, y: 138 },
]

// ---- generated parts -----------------------------------------------------------------------------------------

/** A house with a red roof: the roof grows in steps, then the wall with a door and two windows. */
function house(): string {
  const rows: string[] = []
  const w = 36
  for (let i = 0; i < 9; i++) {
    const half = 4 + i * 2
    const left = Math.floor(w / 2) - half
    rows.push('.'.repeat(Math.max(0, left)) + (i % 3 === 2 ? 'R'.repeat(half * 2) : 'r'.repeat(half * 2)) + '.'.repeat(Math.max(0, w - left - half * 2)))
  }
  rows.push('.' + 'D'.repeat(w - 2) + '.')
  for (let i = 0; i < 14; i++) {
    const row = ['.', ...'w'.repeat(w - 2), '.']
    if (i >= 2 && i <= 5) for (const c of [4, 5, 6, 7, 8, 27, 28, 29, 30, 31]) row[c] = 'b'
    if (i === 3 || i === 4) for (const c of [6, 29]) row[c] = 'k'
    if (i >= 5) for (const c of [15, 16, 17, 18, 19, 20]) row[c] = i === 5 ? 'k' : 'd'
    if (i === 9) row[18] = 'y'
    rows.push(row.join(''))
  }
  rows.push('.' + 'k'.repeat(w - 2) + '.')
  return def('house', rows, { r: '#e04838', R: '#c03020', D: '#7a1c14', w: '#f8f0d8', b: '#78b8f8', k: '#4a3020', d: '#9a6030', y: '#f8e030' })
}

/** A picket fence of `n` posts. */
function fence(n: number): string {
  const top = Array.from({ length: n }, () => 'ww.').join('')
  const rows = [top, top, 'w'.repeat(n * 3), top, top]
  return def(`fence${n}`, rows, { w: '#f4ecd8' })
}

/** The mountains: two layers of columns from a few sine waves, with snow caps on the high peaks. */
function mountains(): string {
  let out = ''
  for (let x = 0; x < W; x += 4) {
    const a = 20 + Math.sin(x / 31) * 9 + Math.sin(x / 13 + 1) * 4
    const b = 12 + Math.sin(x / 23 + 2) * 8 + Math.sin(x / 9) * 3
    const ya = Math.round(86 - a)
    const yb = Math.round(86 - b)
    out += box(x, ya, 4, 90 - ya, '#7898d8') + box(x, yb, 4, 90 - yb, '#5f7fc4')
    if (a > 25) out += box(x, ya, 4, 3, '#f0f6ff') + box(x + (x % 8 === 0 ? 0 : 0), ya + 3, 4, 1, '#c8d8f4')
  }
  return out
}

/** The sky in bands, with the dither line between two bands. */
function sky(): string {
  const bands = ['#58a8f0', '#70b8f4', '#88c8f8', '#a0d8fa', '#b8e4fc', '#d0f0fe']
  let out = ''
  const own: [number, number, number, number][][] = bands.map(() => [])
  bands.forEach((c, i) => {
    out += box(0, i * 14, W, 14, c)
    if (i > 0) {
      for (let x = (i % 2) * 2; x < W; x += 4) {
        ;(own[i] as [number, number, number, number][]).push([x, i * 14 - 1, 2, 1])
        ;(own[i - 1] as [number, number, number, number][]).push([x + 2, i * 14, 2, 1])
      }
    }
  })
  return out + bands.map((c, i) => dots(c, own[i] as [number, number, number, number][])).join('')
}

/** The ground: grass with a pixel checker, a sand path that widens to the front, and a pond at the right. */
function ground(): string {
  let out = box(0, 84, W, H - 84, '#5cc060')
  const check: [number, number, number, number][] = []
  for (let y = 84; y < H; y += 4) for (let x = ((y / 4) % 2) * 4; x < W; x += 8) check.push([x, y, 4, 4])
  out += dots('#52b658', check)
  const sand: [number, number, number, number][] = []
  const edge: [number, number, number, number][] = []
  const speck: [number, number, number, number][] = []
  for (let y = 88; y < H; y += 2) {
    const half = 8 + Math.round((y - 88) * 0.42)
    const cx = 160 + Math.round(Math.sin(y / 26) * 14)
    sand.push([cx - half, y, half * 2, 2])
    edge.push([cx - half, y, 2, 2], [cx + half - 2, y, 2, 2])
    if (y % 8 === 0) speck.push([Math.round(cx - half / 2), y, 2, 2], [Math.round(cx + half / 3), y, 2, 2])
  }
  return out + dots('#ecd8a0', sand) + dots('#c8ae74', edge) + dots('#d8c088', speck)
}

function pond(x: number, y: number): string {
  const rows = [
    '....kkkkkkkkkkkk....',
    '..kkbbbbbbbbbbbbkk..',
    '.kbbbbwwbbbbbbbbbbk.',
    'kbbbbbbbbbbbwwbbbbbk',
    'kbbwwbbbbbbbbbbbbbbk',
    'kbbbbbbbbbbbbwwbbbbk',
    '.kbbbbbbwwbbbbbbbbk.',
    '..kkbbbbbbbbbbbbkk..',
    '....kkkkkkkkkkkk....',
  ]
  const ripple = [x + 4, y + 2, x + 13, y + 3, x + 3, y + 5]
  const dots = [0, 1, 2].map(i => `<rect class="rp rp${i}" x="${ripple[i * 2]}" y="${ripple[i * 2 + 1]}" width="3" height="1" fill="#ffffff"/>`).join('')
  return `<g transform="translate(${x} ${y})">${paths(rows, { k: '#2c5aa8', b: '#4c98f0', w: '#a8d4fc' })}</g>${dots}`
}

/** The sign of the route: a post with a board and two lines of text. */
function sign(x: number, y: number): string {
  return (
    box(x + 7, y + 10, 3, 10, '#7a4a20') +
    box(x, y, 17, 11, '#2a1810') +
    box(x + 1, y + 1, 15, 9, '#e8c078') +
    `<text x="${x + 8.5}" y="${y + 7.5}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="3.6" font-weight="700" fill="#2a1810">ROUTE 1</text>`
  )
}

/** A cut-corner box in the style of the games: a dark border, a light fill. */
function frame(x: number, y: number, w: number, h: number, border: string, fill: string): string {
  const cut = (dx: number, dy: number, ww: number, hh: number, c: string) => box(x + dx, y + dy, ww, hh, c)
  return cut(2, 0, w - 4, h, border) + cut(0, 2, w, h - 4, border) + cut(3, 1, w - 6, h - 2, fill) + cut(1, 3, w, h - 6, fill).replace(`width="${w}"`, `width="${w - 2}"`)
}

/** The battle box in the top right: the name, the level of the window, and the HP bar of the context. */
function battleBox(percent: number): string {
  const hp = hpLeft(percent)
  const bx = 190
  const by = 9
  const bar = 54
  const filled = Math.max(hp === 0 ? 0 : 1, Math.round((bar * hp) / 100))
  const low = hp <= 20 ? ' class="low"' : ''
  return (
    frame(bx, by, 80, 30, '#2a2a34', '#f8f8e0') +
    box(bx + 3, by + 3, 74, 1, '#b8b8a0') +
    `<text x="${bx + 7}" y="${by + 13}" font-family="ui-monospace,Menlo,monospace" font-size="7.5" font-weight="700" fill="#202028">CONTEXT</text>` +
    `<text x="${bx + 74}" y="${by + 13}" text-anchor="end" font-family="ui-monospace,Menlo,monospace" font-size="7" font-weight="700" fill="#202028">:L${Math.max(1, Math.round(clamp(percent)))}</text>` +
    box(bx + 7, by + 17, 11, 7, '#e87820') +
    `<text x="${bx + 12.5}" y="${by + 22.8}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="5.5" font-weight="700" fill="#fff8e0">HP</text>` +
    box(bx + 19, by + 17, bar + 2, 7, '#2a2a34') +
    box(bx + 20, by + 18, bar, 5, '#586070') +
    `<g${low}>${box(bx + 20, by + 18, filled, 5, hpColor(hp))}${box(bx + 20, by + 18, filled, 1, '#ffffff55')}</g>` +
    `<text x="${bx + 74}" y="${by + 28}" text-anchor="end" font-family="ui-monospace,Menlo,monospace" font-size="4.6" font-weight="700" fill="#585860">${hp}/100</text>`
  )
}

function flowers(): string {
  const spots: readonly (readonly [number, number])[] = [[46, 100], [54, 108], [96, 112], [110, 100], [212, 102], [268, 118], [282, 104], [40, 128], [292, 134], [60, 152], [262, 150], [30, 110]]
  return spots.map(([x, y], i) => put(i % 2 === 0 ? 'flowerA' : 'flowerB', x, y, `fl${i % 2}`)).join('')
}

/** The treeline along the horizon, two rows, each one a pattern of two or three trees. */
function treeline(): string {
  const one = `<pattern id="row1" x="-6" y="70" width="45" height="20" patternUnits="userSpaceOnUse">${put('tree', 0, 0)}${put('tree', 15, 2)}${put('tree', 30, 4)}</pattern>`
  const two = `<pattern id="row2" x="2" y="84" width="60" height="19" patternUnits="userSpaceOnUse">${put('tree', 0, 0)}${put('tree', 30, 3)}</pattern>`
  return `${one}${two}<rect x="0" y="70" width="${W}" height="20" fill="url(#row1)"/><rect x="0" y="84" width="${W}" height="19" fill="url(#row2)"/>`
}

/** A tree at a place, drawn from the sprite. */
const tree = (x: number, y: number): string => put('tree', x, y)

/** The tall grass: a pattern of tufts on the front rows, and some single tufts that sway. */
function tallGrass(): string {
  const tile = `<pattern id="grass" width="14" height="14" patternUnits="userSpaceOnUse">${`<g transform="translate(1 1)">${sprite('tuft')}</g><g transform="translate(8 8)">${sprite('tuft')}</g>`}</pattern>`
  let out = ''
  // The upper rows leave the sand path free: a left and a right strip for each row of 14.
  for (let y = 128; y < 150; y += 14) {
    const cx = 160 + Math.round(Math.sin(y / 26) * 14)
    const half = 8 + Math.round((y - 88) * 0.42)
    out += `<rect x="0" y="${y}" width="${cx - half}" height="14" fill="url(#grass)"/><rect x="${cx + half}" y="${y}" width="${W - cx - half}" height="14" fill="url(#grass)"/>`
  }
  out += `<rect x="0" y="150" width="${W}" height="${H - 150}" fill="url(#grass)"/>`
  for (const [x, y, c] of [[30, 134, 'sw'], [90, 146, 'sw sw2'], [210, 142, 'sw'], [290, 150, 'sw sw2'], [160, 160, 'sw'], [110, 170, 'sw sw2'], [250, 168, 'sw']] as const) out += put('tuft', x, y, c)
  return tile + out
}

/** The whole scene for a context fill in percent. */
export function sceneOf(percent: number): string {
  const p = clamp(percent)
  const count = creatureCount(p)
  const wild = CREATURES.slice(0, count)
    .map((c, i) => `<g id="wild-${c.id}">${put(c.id, c.x, c.y, `cr cr${i}`)}</g>` + (i === count - 1 && count > 1 ? `<text class="bang" x="${c.x + 6}" y="${c.y - 3}" font-family="ui-monospace,Menlo,monospace" font-size="9" font-weight="900" fill="#e83a20" stroke="#202028" stroke-width="0.6">!</text>` : ''))
    .join('')
  // Each creature stands in front of a tuft row: the grass over its feet.
  const cover = CREATURES.slice(0, count)
    .map(c => put('tuft', c.x + 2, c.y + 21) + put('tuft', c.x + 12, c.y + 22) + put('tuft', c.x + 21, c.y + 21))
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges">` +
    '<defs>' +
    def('tree', TREE, TREE_PAL) +
    def('tuft', TUFT, TUFT_PAL) +
    def('flowerA', FLOWER_A, FLOWER_PAL) +
    def('flowerB', FLOWER_B, FLOWER_PAL) +
    def('ball', BALL, BALL_PAL) +
    def('cloud', CLOUD, CLOUD_PAL) +
    def('ember', EMBER, EMBER_PAL) +
    def('sprout', SPROUT, SPROUT_PAL) +
    def('splash', SPLASH, SPLASH_PAL) +
    house() +
    fence(4) +
    fence(6) +
    '</defs>' +
    '<style>' +
    '.cl{animation:drift 140s linear infinite}.cl1{animation-duration:190s;animation-delay:-70s}.cl2{animation-duration:230s;animation-delay:-150s}' +
    '@keyframes drift{from{transform:translateX(-60px)}to{transform:translateX(380px)}}' +
    '.sw{animation:sway 1.2s steps(1) infinite}.sw2{animation-delay:-.6s}' +
    '@keyframes sway{0%{transform:translateY(0)}50%{transform:translateY(1px)}}' +
    '.fl0{animation:flip 1.6s steps(1) infinite}.fl1{animation:flip 1.6s steps(1) infinite;animation-delay:-.8s}' +
    '@keyframes flip{0%{opacity:1}50%{opacity:.55}}' +
    '.rp{animation:rip 2.4s steps(1) infinite}.rp1{animation-delay:-.8s}.rp2{animation-delay:-1.6s}' +
    '@keyframes rip{0%{opacity:1}60%{opacity:0}}' +
    '.cr{animation:bob 1s steps(1) infinite}.cr1{animation-delay:-.5s}.cr2{animation-delay:-.25s}' +
    '@keyframes bob{0%{transform:translateY(0)}50%{transform:translateY(-1px)}}' +
    '.bang{animation:blink .8s steps(1) infinite}@keyframes blink{50%{opacity:0}}' +
    '.low{animation:blink 1s steps(1) infinite}' +
    '</style>' +
    sky() +
    `<g class="cl">${put('cloud', 20, 14)}</g><g class="cl cl1">${put('cloud', 110, 34)}</g><g class="cl cl2">${put('cloud', 60, 8)}</g>` +
    mountains() +
    ground() +
    // The treeline along the horizon, two rows.
    treeline() +
    // The town at the left.
    put('house', 42, 76) +
    put('fence4', 38, 112) +
    put('fence6', 78, 112) +
    put('ball', 52, 122) +
    // The pond, the sign and two trees at the right.
    pond(240, 96) +
    sign(222, 88) +
    tree(284, 98) +
    tree(268, 108) +
    flowers() +
    put('ball', 200, 132) +
    tallGrass() +
    wild +
    cover +
    battleBox(p) +
    '</svg>'
  )
}
