// The Christmas night scene: one SVG, built again when the context fill changes.
// Original art in a flat, soft style: an indigo sky with a faint aurora, a full moon, mountains with snow caps,
// two forest ridges, a small village, snowy pines in three depths, a decorated tree with gifts and a snowman,
// an A-frame cabin with string lights and chimney smoke, a robin on a hanging wood sign that shows the
// context fill, and falling snow. As the context fills, more snow lies on the trees and roofs, and the drifts
// rise and cover the village.

export const SCENE = 'christmas-night'

const W = 1600
const H = 900

/** The same numbers on each build, so a redraw does not move the stars or the flakes. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const clamp = (n: number): number => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0)
const r1 = (n: number): string => (Math.round(n * 10) / 10).toString()
/** A list of numbers for a path. */
const P = (...v: number[]): string => v.map(r1).join(' ')

/** The height of the snow ground, in scene units: 40 with an empty context window, 300 with a full one. */
export function groundHeight(percent: number): number {
  return Math.round(40 + clamp(percent) * 2.6)
}

/** How many flakes fall: more as the context window fills. */
export function flakeCount(percent: number): number {
  return 40 + Math.round(clamp(percent) * 0.6)
}

type Tone = { fill: string; shade?: string; snow: string; trunk: string }
const NEAR: Tone = { fill: '#1d7358', shade: '#0e4a3b', snow: '#f6f9ff', trunk: '#3a2418' }
const MID: Tone = { fill: '#1e5663', shade: '#143d4e', snow: '#dde6ff', trunk: '#2a2030' }
const FAR: Tone = { fill: '#2a3a84', snow: '#b7c3ef', trunk: '#222a66' }

const BULBS = ['#ff6b7a', '#ffd166', '#7cc4ff', '#9bf2b4', '#ff9f5a']
const SNOW = '#f6f9ff'
const SNOW_SHADE = '#c5cff2'

/**
 * One bough of a pine: curved sides, a scalloped bottom edge, a shadow on the side away from the moon, needle
 * marks, and a snow cap. `m` is the size of the cap: 0.7 with little snow, 1.2 with much snow.
 */
function bough(x: number, top: number, th: number, half: number, tone: Tone, m: number): string {
  const b = top + th
  let out =
    `<path d="M${P(x, top)} C${P(x + half * 0.22, top + th * 0.5, x + half * 0.68, b - th * 0.22, x + half, b)}` +
    ` Q${P(x + half * 0.66, b + th * 0.12, x + half * 0.34, b - th * 0.03)} Q${P(x, b + th * 0.16, x - half * 0.34, b - th * 0.03)}` +
    ` Q${P(x - half * 0.66, b + th * 0.12, x - half, b)} C${P(x - half * 0.68, b - th * 0.22, x - half * 0.22, top + th * 0.5, x, top)} Z" fill="${tone.fill}"/>`
  if (tone.shade !== undefined) {
    out +=
      `<path d="M${P(x, top)} C${P(x - half * 0.22, top + th * 0.5, x - half * 0.68, b - th * 0.22, x - half, b)}` +
      ` Q${P(x - half * 0.66, b + th * 0.12, x - half * 0.34, b - th * 0.03)} Q${P(x - half * 0.2, b + th * 0.1, x - half * 0.06, b + th * 0.05)}` +
      ` C${P(x - half * 0.3, b - th * 0.4, x - half * 0.1, top + th * 0.4, x, top)} Z" fill="${tone.shade}" opacity="0.6"/>` +
      `<path d="M${P(x + half * 0.14, b - th * 0.1)} q${P(half * 0.1, th * 0.07, half * 0.2, 0)} M${P(x + half * 0.46, b - th * 0.07)} q${P(half * 0.1, th * 0.07, half * 0.2, 0)} M${P(x - half * 0.3, b - th * 0.1)} q${P(half * 0.1, th * 0.07, half * 0.2, 0)} M${P(x - half * 0.66, b - th * 0.06)} q${P(half * 0.1, th * 0.07, half * 0.2, 0)}" fill="none" stroke="${tone.shade}" stroke-width="2" stroke-linecap="round"/>`
  }
  const hx = half * m
  const ty = th * m
  return (
    out +
    `<path d="M${P(x, top - th * 0.04)} C${P(x + hx * 0.2, top + ty * 0.38, x + hx * 0.46, top + ty * 0.6, x + hx * 0.6, top + ty * 0.72)}` +
    ` Q${P(x + hx * 0.47, top + ty * 0.88, x + hx * 0.32, top + ty * 0.7)} Q${P(x + hx * 0.14, top + ty * 0.94, x - hx * 0.04, top + ty * 0.68)}` +
    ` Q${P(x - hx * 0.24, top + ty * 0.9, x - hx * 0.4, top + ty * 0.71)} Q${P(x - hx * 0.53, top + ty * 0.86, x - hx * 0.6, top + ty * 0.72)}` +
    ` C${P(x - hx * 0.46, top + ty * 0.6, x - hx * 0.2, top + ty * 0.38, x, top - th * 0.04)} Z" fill="${tone.snow}"/>`
  )
}

/**
 * A snowy pine. The moon is on the right, so the shadow on the snow goes to the left.
 * `snow` is 0 to 1: how much snow lies on it. `lights` adds bulbs, baubles and a star.
 */
function pine(x: number, base: number, h: number, tone: Tone, tiers: number, snow: number, lights = false): string {
  const step = (h * 0.9) / (tiers + 0.8)
  const th = step * 1.8
  const wide = h * 0.3
  const m = 0.7 + 0.5 * snow
  let out =
    `<ellipse cx="${r1(x - wide * 0.7)}" cy="${r1(base + 2)}" rx="${r1(wide * 1.1)}" ry="${r1(h * 0.028)}" fill="#5b69b4" opacity="0.35"/>` +
    `<rect x="${r1(x - h * 0.03)}" y="${r1(base - h * 0.13)}" width="${r1(h * 0.06)}" height="${r1(h * 0.14)}" fill="${tone.trunk}"/>`
  const rand = rng(Math.round(x))
  for (let i = tiers - 1; i >= 0; i--) {
    const top = base - h + i * step
    const half = wide * (0.38 + (0.62 * (i + 1)) / tiers)
    out += bough(x, top, th, half, tone, m)
    if (!lights) continue
    const count = 3 + i
    for (let k = 0; k < count; k++) {
      const u = (2 * (k + 0.5)) / count - 1
      const bx = x + half * 0.72 * u
      const by = top + th * (0.78 + 0.12 * (1 - u * u)) + rand() * 4
      const hue = BULBS[(k + i * 2) % BULBS.length]
      if (k % 2 === 1) {
        const ox = bx - half * 0.14
        const oy = by - th * 0.2
        out +=
          `<path d="M${P(ox, oy - 12)} L${P(ox, oy - 7)}" stroke="#ffe08a" stroke-width="1.5"/>` +
          `<circle cx="${r1(ox)}" cy="${r1(oy)}" r="7" fill="${k % 4 === 1 ? '#d63a45' : '#e2b44a'}"/><circle cx="${r1(ox - 2)}" cy="${r1(oy - 2.4)}" r="2" fill="#ffffff" opacity="0.7"/>`
      }
      out +=
        `<circle class="lg lp${(k + i) % 4}" cx="${r1(bx)}" cy="${r1(by)}" r="13" fill="${hue}" opacity="0.32"/>` +
        `<circle class="l lp${(k + i) % 4}" cx="${r1(bx)}" cy="${r1(by)}" r="4.4" fill="${hue}"/>` +
        `<circle cx="${r1(bx - 1.2)}" cy="${r1(by - 1.4)}" r="1.3" fill="#ffffff" opacity="0.8"/>`
    }
  }
  out += `<ellipse cx="${r1(x)}" cy="${r1(base + 3)}" rx="${r1(wide * (0.6 + 0.4 * snow))}" ry="${r1(h * (0.025 + 0.03 * snow))}" fill="${tone.snow}"/>`
  if (!lights) return out
  const sy = base - h - 10
  const p: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 ? 9 : 21
    p.push(P(x + rr * Math.cos(a), sy + rr * Math.sin(a)))
  }
  return out + `<circle class="sg" cx="${r1(x)}" cy="${r1(sy)}" r="46" fill="url(#star-glow)"/><path class="top-star" d="M${p.join(' L')} Z" fill="#ffe08a"/>`
}

/** Gifts under the tree. */
function gift(x: number, base: number, w: number, h: number, box: string, ribbon: string): string {
  return (
    `<rect x="${r1(x)}" y="${r1(base - h)}" width="${r1(w)}" height="${r1(h)}" rx="3" fill="${box}"/>` +
    `<rect x="${r1(x)}" y="${r1(base - h)}" width="${r1(w * 0.3)}" height="${r1(h)}" rx="3" fill="#000000" opacity="0.14"/>` +
    `<rect x="${r1(x + w / 2 - 3)}" y="${r1(base - h)}" width="6" height="${r1(h)}" fill="${ribbon}"/>` +
    `<rect x="${r1(x - 2)}" y="${r1(base - h - 5)}" width="${r1(w + 4)}" height="8" rx="3" fill="${ribbon}"/>` +
    `<path d="M${P(x + w / 2, base - h - 5)} q-12 -14 -3 -15 q7 0 3 15 q12 -14 3 -15 q-7 0 -3 15 Z" fill="${ribbon}"/>` +
    `<ellipse cx="${r1(x + w / 2)}" cy="${r1(base + 1)}" rx="${r1(w * 0.7)}" ry="5" fill="${SNOW}"/>`
  )
}

function snowman(x: number, base: number): string {
  return (
    `<ellipse cx="${r1(x - 34)}" cy="${r1(base + 2)}" rx="52" ry="8" fill="#5b69b4" opacity="0.35"/>` +
    `<path d="M${P(x - 24, base - 66)} L${P(x - 52, base - 88)} M${P(x - 44, base - 82)} L${P(x - 56, base - 76)} M${P(x + 24, base - 66)} L${P(x + 54, base - 92)} M${P(x + 44, base - 85)} L${P(x + 50, base - 100)}" stroke="#4a2f20" stroke-width="3.5" stroke-linecap="round" fill="none"/>` +
    `<circle cx="${r1(x)}" cy="${r1(base - 28)}" r="34" fill="${SNOW}"/><circle cx="${r1(x)}" cy="${r1(base - 76)}" r="25" fill="${SNOW}"/><circle cx="${r1(x)}" cy="${r1(base - 114)}" r="19" fill="${SNOW}"/>` +
    `<path d="M${P(x - 30, base - 12)} A34 34 0 0 1 ${P(x - 26, base - 50)} A40 40 0 0 0 ${P(x - 6, base + 4)} Z" fill="${SNOW_SHADE}"/>` +
    `<path d="M${P(x - 22, base - 66)} A25 25 0 0 1 ${P(x - 18, base - 93)} A30 30 0 0 0 ${P(x - 6, base - 52)} Z" fill="${SNOW_SHADE}"/>` +
    `<path d="M${P(x - 22, base - 96)} Q${P(x, base - 86, x + 22, base - 96)} L${P(x + 20, base - 88)} Q${P(x, base - 78, x - 20, base - 88)} Z" fill="#d63a45"/>` +
    `<path d="M${P(x + 10, base - 90)} L${P(x + 20, base - 62)} L${P(x + 8, base - 62)} Z" fill="#b82c38"/>` +
    `<circle cx="${r1(x + 2)}" cy="${r1(base - 118)}" r="2.6" fill="#1c1c24"/><circle cx="${r1(x + 12)}" cy="${r1(base - 117)}" r="2.6" fill="#1c1c24"/>` +
    `<path d="M${P(x + 8, base - 112)} L${P(x + 28, base - 108)} L${P(x + 8, base - 106)} Z" fill="#ff9f43"/>` +
    `<path d="M${P(x - 2, base - 104)} q8 6 16 1" fill="none" stroke="#1c1c24" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 4"/>` +
    `<circle cx="${r1(x + 2)}" cy="${r1(base - 74)}" r="2.6" fill="#1c1c24"/><circle cx="${r1(x + 3)}" cy="${r1(base - 60)}" r="2.6" fill="#1c1c24"/><circle cx="${r1(x + 3)}" cy="${r1(base - 36)}" r="2.6" fill="#1c1c24"/>` +
    `<rect x="${r1(x - 20)}" y="${r1(base - 134)}" width="40" height="6" rx="3" fill="#1b1f3d"/><rect x="${r1(x - 13)}" y="${r1(base - 158)}" width="26" height="26" rx="3" fill="#1b1f3d"/>` +
    `<rect x="${r1(x - 13)}" y="${r1(base - 142)}" width="26" height="5" fill="#d63a45"/>` +
    `<ellipse cx="${r1(x)}" cy="${r1(base - 158)}" rx="14" ry="4" fill="${SNOW}"/>`
  )
}

/** Three puffs of smoke that go up from a chimney. */
function smoke(x: number, y: number, r: number): string {
  return `<circle class="sm" cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="#c9d2f5"/><circle class="sm sm1" cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="#c9d2f5"/><circle class="sm sm2" cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="#c9d2f5"/>`
}

/**
 * The A-frame cabin: a snow roof with string lights and icicles, a lit window with a wreath, a door,
 * a chimney with smoke, and light on the snow. `snow` is 0 to 1: how thick the snow on the roof is.
 */
function cabin(x: number, base: number, w: number, h: number, snow: number): string {
  const l = x - w / 2
  const r = x + w / 2
  const top = base - h
  const cx = x + w * 0.27
  const cy = top + h * 0.1
  const thick = 8 + 16 * snow
  let lights = ''
  let ice = ''
  for (let i = 1; i <= 6; i++) {
    const t = i / 7
    for (const s of [-1, 1]) {
      const bx = x + s * (w / 2 + 2) * t
      const by = top + (h + 4) * t + 10 + thick / 2
      const hue = BULBS[(i + (s > 0 ? 2 : 0)) % BULBS.length]
      lights +=
        `<circle class="lg lp${(i + s + 4) % 4}" cx="${r1(bx)}" cy="${r1(by)}" r="10" fill="${hue}" opacity="0.3"/>` +
        `<circle class="l lp${(i + s + 4) % 4}" cx="${r1(bx)}" cy="${r1(by)}" r="3.6" fill="${hue}"/>`
      const ix = x + s * (w / 2 - 6) * (t + 0.07)
      const iy = top + h * (t + 0.07) + thick / 2 + 2
      ice += `M${P(ix - 3, iy)} L${P(ix, iy + 9 + ((i * 5) % 9) + 8 * snow)} L${P(ix + 3, iy)} Z`
    }
  }
  return (
    `<ellipse cx="${r1(x - 20)}" cy="${r1(base + 26)}" rx="${r1(w * 0.95)}" ry="46" fill="url(#spill)"/>` +
    smoke(cx, cy - 14 - 10 * snow, 13) +
    `<rect x="${r1(cx - w * 0.07)}" y="${r1(cy)}" width="${r1(w * 0.14)}" height="${r1(h * 0.34)}" fill="#59618c"/>` +
    `<rect x="${r1(cx - w * 0.07)}" y="${r1(cy)}" width="${r1(w * 0.05)}" height="${r1(h * 0.34)}" fill="#474e78"/>` +
    `<path d="M${P(cx - w * 0.07, cy + 16)} h${r1(w * 0.14)} M${P(cx - w * 0.07, cy + 32)} h${r1(w * 0.14)} M${P(cx, cy + 16)} v16" stroke="#474e78" stroke-width="1.5"/>` +
    `<rect x="${r1(cx - w * 0.09)}" y="${r1(cy - 8 - 10 * snow)}" width="${r1(w * 0.18)}" height="${r1(12 + 10 * snow)}" rx="6" fill="${SNOW}"/>` +
    `<path d="M${P(x, top)} L${P(r, base)} L${P(l, base)} Z" fill="#6f4126"/>` +
    `<path d="M${P(x, top)} L${P(x, base)} L${P(l, base)} Z" fill="#573019"/>` +
    `<path d="M${P(x - w * 0.36, base - h * 0.14)} L${P(x + w * 0.36, base - h * 0.14)} M${P(x - w * 0.42, base - h * 0.05)} L${P(x + w * 0.42, base - h * 0.05)}" stroke="#462612" stroke-width="2.5"/>` +
    `<path class="win" d="M${P(x, top + h * 0.24)} L${P(x + w * 0.25, base - h * 0.2)} L${P(x - w * 0.25, base - h * 0.2)} Z" fill="url(#window)"/>` +
    `<path d="M${P(x, top + h * 0.24)} L${P(x, base - h * 0.2)} M${P(x - w * 0.15, base - h * 0.44)} L${P(x + w * 0.15, base - h * 0.44)}" stroke="#573019" stroke-width="4"/>` +
    `<path d="M${P(x, top + h * 0.24)} L${P(x + w * 0.25, base - h * 0.2)} L${P(x - w * 0.25, base - h * 0.2)} Z" fill="none" stroke="#573019" stroke-width="5" stroke-linejoin="round"/>` +
    `<circle cx="${r1(x)}" cy="${r1(base - h * 0.44)}" r="13" fill="none" stroke="#1d7358" stroke-width="7"/><circle cx="${r1(x)}" cy="${r1(base - h * 0.44 + 12)}" r="4" fill="#d63a45"/>` +
    `<rect x="${r1(x + w * 0.1)}" y="${r1(base - h * 0.17)}" width="${r1(w * 0.14)}" height="${r1(h * 0.17)}" rx="3" fill="#3b1f10"/><circle cx="${r1(x + w * 0.13)}" cy="${r1(base - h * 0.08)}" r="2.2" fill="#ffd166"/>` +
    `<path d="M${P(x, top - 12)} L${P(r + 18, base + 4)} L${P(r - 8, base + 4)} L${P(x, top + h * 0.12)} L${P(l + 8, base + 4)} L${P(l - 18, base + 4)} Z" fill="${SNOW}" stroke="${SNOW}" stroke-width="${r1(thick)}" stroke-linejoin="round"/>` +
    `<path d="M${P(x, top + h * 0.12)} L${P(l + 8, base + 4)} L${P(l + 22, base + 4)} L${P(x, top + h * 0.2)} Z" fill="${SNOW_SHADE}"/>` +
    `<ellipse cx="${r1(x)}" cy="${r1(top - 8 - 8 * snow)}" rx="${r1(16 + 22 * snow)}" ry="${r1(8 + 12 * snow)}" fill="${SNOW}"/>` +
    `<path d="${ice}" fill="#dfe8ff"/>` +
    lights +
    `<ellipse cx="${r1(l)}" cy="${r1(base + 4)}" rx="${r1(40 + 26 * snow)}" ry="${r1(11 + 9 * snow)}" fill="${SNOW}"/><ellipse cx="${r1(r)}" cy="${r1(base + 4)}" rx="${r1(40 + 26 * snow)}" ry="${r1(11 + 9 * snow)}" fill="${SNOW}"/>`
  )
}

/** A small house of the village: lit windows, a door, a chimney with smoke, and a snow roof that gets thicker. */
function cottage(x: number, base: number, w: number, h: number, snow: number, wall: string, dark: string): string {
  const l = x - w / 2
  const r = x + w / 2
  const eave = base - h
  const top = eave - h * 0.72
  const thick = 5 + 13 * snow
  const ww = w * 0.2
  const wh = h * 0.34
  const win = (wx: number): string =>
    `<rect class="win" x="${r1(wx)}" y="${r1(eave + h * 0.22)}" width="${r1(ww)}" height="${r1(wh)}" rx="2" fill="url(#window)"/>` +
    `<path d="M${P(wx + ww / 2, eave + h * 0.22)} v${r1(wh)} M${P(wx, eave + h * 0.22 + wh / 2)} h${r1(ww)}" stroke="${dark}" stroke-width="2"/>` +
    `<rect x="${r1(wx - 2)}" y="${r1(eave + h * 0.22 + wh)}" width="${r1(ww + 4)}" height="4" rx="2" fill="${SNOW}"/>`
  return (
    `<ellipse cx="${r1(x)}" cy="${r1(base + 10)}" rx="${r1(w * 0.8)}" ry="16" fill="url(#spill)"/>` +
    smoke(x + w * 0.24, top + h * 0.18, 7) +
    `<rect x="${r1(x + w * 0.18)}" y="${r1(top + h * 0.26)}" width="${r1(w * 0.12)}" height="${r1(h * 0.5)}" fill="${dark}"/>` +
    `<rect x="${r1(x + w * 0.16)}" y="${r1(top + h * 0.2 - 5 * snow)}" width="${r1(w * 0.16)}" height="${r1(7 + 5 * snow)}" rx="3.5" fill="${SNOW}"/>` +
    `<path d="M${P(l, base)} L${P(l, eave)} L${P(x, top)} L${P(r, eave)} L${P(r, base)} Z" fill="${wall}"/>` +
    `<path d="M${P(l, base)} L${P(l, eave)} L${P(x, top)} L${P(x, base)} Z" fill="${dark}" opacity="0.45"/>` +
    win(l + w * 0.12) +
    win(r - w * 0.12 - ww) +
    `<circle class="win" cx="${r1(x)}" cy="${r1(eave - h * 0.22)}" r="${r1(w * 0.07)}" fill="url(#window)"/>` +
    `<rect x="${r1(x - w * 0.09)}" y="${r1(base - h * 0.5)}" width="${r1(w * 0.18)}" height="${r1(h * 0.5)}" rx="2" fill="${dark}"/><circle cx="${r1(x + w * 0.05)}" cy="${r1(base - h * 0.24)}" r="1.6" fill="#ffd166"/>` +
    `<path d="M${P(l - 10, eave + 4)} L${P(x, top - 4)} L${P(r + 10, eave + 4)}" fill="none" stroke="${SNOW}" stroke-width="${r1(thick)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<ellipse cx="${r1(x)}" cy="${r1(base + 2)}" rx="${r1(w * (0.62 + 0.2 * snow))}" ry="${r1(5 + 6 * snow)}" fill="${SNOW}"/>`
  )
}

/** A street lamp with a warm light and a snow cap. */
function lamp(x: number, base: number, h: number): string {
  const y = base - h
  return (
    `<circle class="sg" cx="${r1(x)}" cy="${r1(y + 10)}" r="60" fill="url(#star-glow)"/>` +
    `<rect x="${r1(x - 3)}" y="${r1(y + 22)}" width="6" height="${r1(h - 22)}" fill="#1b1f3d"/><rect x="${r1(x - 7)}" y="${r1(base - 12)}" width="14" height="12" rx="2" fill="#1b1f3d"/>` +
    `<path d="M${P(x - 9, y)} L${P(x + 9, y)} L${P(x + 6, y + 22)} L${P(x - 6, y + 22)} Z" fill="#ffe3a0"/>` +
    `<path d="M${P(x - 9, y)} L${P(x + 9, y)} L${P(x + 6, y + 22)} L${P(x - 6, y + 22)} Z M${P(x, y)} v22" fill="none" stroke="#1b1f3d" stroke-width="2"/>` +
    `<path d="M${P(x - 13, y)} L${P(x, y - 11)} L${P(x + 13, y)} Z" fill="#1b1f3d"/><ellipse cx="${r1(x)}" cy="${r1(y - 9)}" rx="12" ry="5" fill="${SNOW}"/>`
  )
}

/** A wood fence with snow on the posts and on the top rail. */
function fence(x0: number, x1: number, base: number): string {
  let out = `<path d="M${P(x0, base - 30)} L${P(x1, base - 30)} M${P(x0, base - 14)} L${P(x1, base - 14)}" stroke="#5d3b22" stroke-width="5"/><path d="M${P(x0, base - 33)} L${P(x1, base - 33)}" stroke="${SNOW}" stroke-width="3" stroke-linecap="round"/>`
  for (let x = x0; x <= x1; x += 36) {
    out += `<rect x="${r1(x - 4)}" y="${r1(base - 42)}" width="8" height="44" rx="2" fill="#6f4126"/><ellipse cx="${r1(x)}" cy="${r1(base - 42)}" rx="7" ry="4.5" fill="${SNOW}"/>`
  }
  return out
}

/** The robin on top of the hanging sign, with a Santa hat. */
function robin(x: number, y: number): string {
  return (
    `<path d="M${P(x - 22, y + 2)} L${P(x - 44, y + 10)} L${P(x - 24, y + 14)} Z" fill="#5d4336"/>` +
    `<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="26" ry="22" fill="#7a5a48"/>` +
    `<ellipse cx="${r1(x - 8)}" cy="${r1(y + 4)}" rx="13" ry="10" fill="#5d4336"/>` +
    `<ellipse cx="${r1(x + 6)}" cy="${r1(y + 8)}" rx="16" ry="13" fill="#f0845e"/>` +
    `<circle cx="${r1(x + 10)}" cy="${r1(y - 7)}" r="3.2" fill="#1c1c24"/><circle cx="${r1(x + 11)}" cy="${r1(y - 8)}" r="1" fill="#ffffff"/>` +
    `<path d="M${P(x + 22, y - 5)} L${P(x + 35, y - 1)} L${P(x + 22, y + 3)} Z" fill="#ffc15a"/>` +
    `<path d="M${P(x - 14, y - 16)} Q${P(x - 6, y - 46, x + 16, y - 36)} L${P(x + 16, y - 16)} Z" fill="#d63a45"/>` +
    `<rect x="${r1(x - 17)}" y="${r1(y - 21)}" width="36" height="9" rx="4.5" fill="${SNOW}"/>` +
    `<circle cx="${r1(x + 18)}" cy="${r1(y - 37)}" r="5.5" fill="${SNOW}"/>`
  )
}

/** The hanging wood sign: the context fill in percent. The ropes go up out of the scene. */
function sign(x: number, y: number, percent: number): string {
  return (
    `<path d="M${P(x - 56, y)} L${P(x - 56, -10)} M${P(x + 56, y)} L${P(x + 56, -10)}" stroke="#8a6a4c" stroke-width="4" fill="none"/>` +
    `<ellipse cx="${r1(x)}" cy="${r1(y + 3)}" rx="80" ry="15" fill="${SNOW}"/><ellipse cx="${r1(x - 40)}" cy="${r1(y + 8)}" rx="34" ry="11" fill="${SNOW}"/><ellipse cx="${r1(x + 46)}" cy="${r1(y + 8)}" rx="30" ry="10" fill="${SNOW}"/>` +
    robin(x - 4, y - 24) +
    `<rect x="${r1(x - 84)}" y="${r1(y + 6)}" width="168" height="98" rx="12" fill="#5d3b22"/>` +
    `<rect x="${r1(x - 78)}" y="${r1(y + 12)}" width="156" height="86" rx="9" fill="#8a5a36"/>` +
    `<path d="M${P(x - 70, y + 40)} L${P(x + 70, y + 40)} M${P(x - 70, y + 70)} L${P(x + 70, y + 70)}" stroke="#7a4e2e" stroke-width="2"/>` +
    `<circle cx="${r1(x - 68)}" cy="${r1(y + 22)}" r="3" fill="#5d3b22"/><circle cx="${r1(x + 68)}" cy="${r1(y + 22)}" r="3" fill="#5d3b22"/>` +
    `<text x="${r1(x)}" y="${r1(y + 64)}" text-anchor="middle" font-family="ui-rounded,system-ui,sans-serif" font-size="46" font-weight="700" fill="#fff0c8">${Math.round(percent)}%</text>` +
    `<text x="${r1(x)}" y="${r1(y + 87)}" text-anchor="middle" font-family="ui-rounded,system-ui,sans-serif" font-size="17" fill="#f3d9a8">context</text>` +
    `<path d="M${P(x - 60, y + 104)} l5 14 l5 -14 M${P(x - 20, y + 104)} l4 10 l4 -10 M${P(x + 40, y + 104)} l5 16 l5 -16" fill="#dfe8ff"/>`
  )
}

function flakes(count: number, seed: number, size: number): string {
  const rand = rng(seed)
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = rand() * W
    const y = rand() * H
    const r = r1(size * (0.6 + rand() * 0.8))
    // Each flake twice, one scene height apart, so the layer can loop with no jump.
    out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}"/><circle cx="${r1(x)}" cy="${r1(y - H)}" r="${r}"/>`
  }
  return out
}

/** One snow drift across the scene, with a light rim on its top edge. */
function drift(y: number, color: string, seed: number): string {
  const rand = rng(seed)
  let edge = `M-40 ${r1(y + 8)}`
  for (let x = -40; x < W + 40; x += 280) {
    edge += ` Q${P(x + 140, y - 18 - rand() * 24, x + 280, y + 2 + rand() * 14)}`
  }
  return `<path d="${edge} L${W + 40} ${H + 40} L-40 ${H + 40} Z" fill="${color}"/><path d="${edge}" fill="none" stroke="#eef2ff" stroke-width="3" opacity="0.55"/>`
}

/** A forest ridge far away: a hill with a row of small pine shapes on its edge. */
function ridge(y: number, hill: string, trees: string, seed: number): string {
  const rand = rng(seed)
  const at = (x: number): number => y + 26 * Math.sin(x / 210 + seed) + 12 * Math.sin(x / 83 + seed * 2)
  let d = `M0 ${H} L0 ${r1(at(0))}`
  for (let x = 80; x <= W; x += 80) d += ` L${P(x, at(x))}`
  let t = ''
  for (let x = 8; x < W; x += 20 + rand() * 22) {
    const h = 26 + rand() * 40
    const b = at(x) + 5
    t += `M${P(x, b - h)} L${P(x + h * 0.26, b)} L${P(x - h * 0.26, b)} Z`
  }
  return `<path d="${d} L${W} ${H} Z" fill="${hill}"/><path d="${t}" fill="${trees}"/>`
}

/** The whole scene for a context fill in percent. */
export function sceneOf(percent: number): string {
  const p = clamp(percent)
  const snow = p / 100
  const rand = rng(3)
  let stars = ''
  for (let i = 0; i < 70; i++) {
    stars += `<circle class="s s${i % 3}" cx="${r1(rand() * W)}" cy="${r1(rand() * H * 0.5)}" r="${r1(0.7 + rand() * 1.3)}" fill="#dfe6ff"/>`
  }
  for (const [x, y, s] of [[360, 110, 9], [760, 70, 7], [1040, 190, 8], [560, 250, 6], [1180, 80, 6], [90, 300, 6]] as const) {
    stars += `<path class="s s${s % 3}" d="M${P(x, y - s)} Q${P(x, y, x + s, y)} Q${P(x, y, x, y + s)} Q${P(x, y, x - s, y)} Q${P(x, y, x, y - s)} Z" fill="#ffffff"/>`
  }
  const many = flakeCount(p)
  const height = groundHeight(p)
  // The trees, the houses and the snowman stay in position. The drifts rise in front of them and cover them:
  // first the gifts and the fence, then the snowman and the small houses. The large tree and the cabin stay in view.
  const top = H - height
  const sparkle = rng(11)
  let dots = ''
  for (let i = 0; i < 30; i++) {
    dots += `<circle class="g g${i % 3}" cx="${r1(sparkle() * W)}" cy="${r1(top + 10 + sparkle() * Math.max(10, height - 14))}" r="1.8" fill="#ffffff"/>`
  }
  let steps = ''
  for (let i = 0; i < 7; i++) {
    steps += `<ellipse cx="${r1(1400 - i * 34)}" cy="${r1(890 + i * 4 + (i % 2) * 5)}" rx="8" ry="3.5" fill="#8f9cd6"/>`
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice">` +
    '<defs>' +
    '<linearGradient id="sky-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e1036"/><stop offset="0.55" stop-color="#1b2160"/><stop offset="1" stop-color="#36418f"/></linearGradient>' +
    '<linearGradient id="aurora" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#63e6be" stop-opacity="0"/><stop offset="0.45" stop-color="#63e6be" stop-opacity="0.55"/><stop offset="0.75" stop-color="#8f7bf0" stop-opacity="0.3"/><stop offset="1" stop-color="#8f7bf0" stop-opacity="0"/></linearGradient>' +
    '<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a57a8" stop-opacity="0"/><stop offset="1" stop-color="#4a57a8" stop-opacity="0.55"/></linearGradient>' +
    '<linearGradient id="window" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffbe5c"/><stop offset="1" stop-color="#fff0b8"/></linearGradient>' +
    '<radialGradient id="moon-glow"><stop offset="0" stop-color="#fff3d0" stop-opacity="0.5"/><stop offset="0.4" stop-color="#fff3d0" stop-opacity="0.14"/><stop offset="1" stop-color="#fff3d0" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="star-glow"><stop offset="0" stop-color="#ffd166" stop-opacity="0.6"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="spill"><stop offset="0" stop-color="#ffd98a" stop-opacity="0.5"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>' +
    '</defs>' +
    '<style>' +
    '.s{animation:tw 5s ease-in-out infinite}.s1{animation-delay:-1.7s}.s2{animation-delay:-3.3s}' +
    '.l{animation:bulb 2.6s ease-in-out infinite}.lg{animation:halo 2.6s ease-in-out infinite}' +
    '.lp1{animation-delay:-0.65s}.lp2{animation-delay:-1.3s}.lp3{animation-delay:-1.95s}' +
    '.sg{animation:pulse 3.6s ease-in-out infinite}' +
    '.win{animation:glow 4.4s ease-in-out infinite}' +
    '.g{animation:tw 4s ease-in-out infinite}.g1{animation-delay:-1.3s}.g2{animation-delay:-2.6s}' +
    '.top-star{animation:shine 3.6s ease-in-out infinite;transform-box:fill-box;transform-origin:center}' +
    '.au{animation:sway 22s ease-in-out infinite}.au1{animation-duration:31s;animation-delay:-9s}' +
    '.cl{animation:drift 90s linear infinite}.cl1{animation-duration:130s;animation-delay:-40s}' +
    '.sm{animation:smoke 7s ease-out infinite;transform-box:fill-box;transform-origin:center;opacity:0}.sm1{animation-delay:-2.3s}.sm2{animation-delay:-4.6s}' +
    '.shoot{animation:shoot 14s linear infinite;opacity:0}' +
    '.fall-a{animation:fall 30s linear infinite}.fall-b{animation:fall 46s linear infinite}' +
    '@keyframes tw{0%,100%{opacity:1}50%{opacity:0.4}}' +
    '@keyframes bulb{0%,100%{opacity:1}50%{opacity:0.4}}' +
    '@keyframes halo{0%,100%{opacity:0.4}50%{opacity:0.08}}' +
    '@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}' +
    '@keyframes glow{0%,100%{opacity:1}50%{opacity:0.85}}' +
    '@keyframes shine{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.8;transform:scale(1.14)}}' +
    '@keyframes sway{0%,100%{transform:translate(-40px,0);opacity:0.5}50%{transform:translate(40px,-12px);opacity:1}}' +
    '@keyframes drift{from{transform:translate(-200px,0)}to{transform:translate(200px,0)}}' +
    '@keyframes smoke{0%{transform:translate(0,0) scale(0.5);opacity:0}15%{opacity:0.45}100%{transform:translate(46px,-150px) scale(2.2);opacity:0}}' +
    '@keyframes shoot{0%,90%{transform:translate(0,0);opacity:0}91%{opacity:0.9}97%{transform:translate(-300px,110px);opacity:0}100%{transform:translate(-300px,110px);opacity:0}}' +
    `@keyframes fall{from{transform:translate(0,0)}to{transform:translate(24px,${H}px)}}` +
    '</style>' +
    `<rect width="${W}" height="${H}" fill="url(#sky-fill)"/>` +
    '<path class="au" d="M-80 250 Q260 90 620 210 T1250 170 T1700 230 L1700 380 Q1300 300 980 350 T300 340 T-80 400 Z" fill="url(#aurora)" opacity="0.22"/>' +
    '<path class="au au1" d="M-80 180 Q380 60 800 150 T1700 110 L1700 240 Q1200 200 800 260 T-80 290 Z" fill="url(#aurora)" opacity="0.14"/>' +
    stars +
    '<path class="shoot" d="M940 96 L1020 66" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/>' +
    '<circle cx="1400" cy="150" r="190" fill="url(#moon-glow)"/><circle cx="1400" cy="150" r="54" fill="#f4edd2"/>' +
    '<path d="M1400 96 A54 54 0 0 0 1400 204 A66 66 0 0 1 1400 96 Z" fill="#e3d9b6" opacity="0.7"/>' +
    '<circle cx="1384" cy="134" r="9" fill="#ddd3b0"/><circle cx="1420" cy="172" r="7" fill="#ddd3b0"/><circle cx="1424" cy="128" r="5" fill="#e4dbbb"/><circle cx="1396" cy="180" r="4" fill="#ddd3b0"/>' +
    '<g class="cl" fill="#5361b0" opacity="0.35"><ellipse cx="420" cy="330" rx="150" ry="14"/><ellipse cx="500" cy="318" rx="90" ry="12"/><ellipse cx="1240" cy="250" rx="170" ry="13"/><ellipse cx="1150" cy="262" rx="100" ry="10"/></g>' +
    '<g class="cl cl1" fill="#5361b0" opacity="0.25"><ellipse cx="860" cy="400" rx="200" ry="12"/><ellipse cx="180" cy="430" rx="140" ry="10"/></g>' +
    `<path d="M0 ${H - 230} L170 ${H - 400} L300 ${H - 300} L470 ${H - 450} L640 ${H - 310} L800 ${H - 380} L980 ${H - 280} L1160 ${H - 430} L1330 ${H - 310} L1480 ${H - 370} L1600 ${H - 290} L1600 ${H} L0 ${H} Z" fill="#303b86"/>` +
    `<path d="M170 ${H - 400} L300 ${H - 300} L210 ${H - 200} Z M470 ${H - 450} L640 ${H - 310} L520 ${H - 200} Z M800 ${H - 380} L980 ${H - 280} L850 ${H - 200} Z M1160 ${H - 430} L1330 ${H - 310} L1210 ${H - 200} Z M1480 ${H - 370} L1600 ${H - 290} L1520 ${H - 200} Z" fill="#283279"/>` +
    `<path d="M170 ${H - 400} l34 26 l-16 6 l-12 -12 l-14 20 l-12 -14 l-22 16 Z M470 ${H - 450} l44 36 l-20 2 l-14 -14 l-16 26 l-16 -20 l-26 14 Z M800 ${H - 380} l36 16 l-22 6 l-14 -10 l-16 18 l-22 -6 Z M1160 ${H - 430} l42 30 l-18 4 l-16 -14 l-14 24 l-16 -18 l-24 12 Z M1480 ${H - 370} l30 20 l-18 2 l-12 -8 l-14 14 l-22 -6 Z" fill="#c3cdf6" opacity="0.85"/>` +
    `<path d="M0 ${H - 200} L220 ${H - 310} L400 ${H - 230} L600 ${H - 330} L820 ${H - 220} L1040 ${H - 310} L1240 ${H - 225} L1440 ${H - 300} L1600 ${H - 220} L1600 ${H} L0 ${H} Z" fill="#273079"/>` +
    `<path d="M220 ${H - 310} l26 12 l-14 4 l-10 -8 l-12 12 l-16 -4 Z M600 ${H - 330} l28 14 l-16 4 l-10 -8 l-12 14 l-18 -6 Z M1040 ${H - 310} l26 12 l-14 4 l-10 -8 l-12 12 l-16 -4 Z M1440 ${H - 300} l24 12 l-14 2 l-8 -6 l-12 10 l-14 -4 Z" fill="#aab6ea" opacity="0.7"/>` +
    `<rect y="${H - 420}" width="${W}" height="300" fill="url(#haze)"/>` +
    ridge(H - 190, '#212a70', '#1c2466', 2) +
    ridge(H - 140, '#1a2160', '#151b52', 5) +
    `<g class="fall-b" fill="#dfe9ff" opacity="0.5">${flakes(Math.round(many * 0.6), 21, 2.4)}</g>` +
    '<g>' +
    pine(40, 846, 190, FAR, 3, snow) +
    pine(560, 842, 130, FAR, 3, snow) +
    pine(640, 848, 180, FAR, 3, snow) +
    cottage(730, 850, 96, 62, snow, '#5a4a86', '#3a2f66') +
    pine(800, 844, 120, FAR, 3, snow) +
    cottage(880, 846, 78, 52, snow, '#63508a', '#3a2f66') +
    pine(950, 846, 160, FAR, 3, snow) +
    cottage(1020, 852, 104, 66, snow, '#5a4a86', '#3a2f66') +
    pine(1090, 842, 125, FAR, 3, snow) +
    pine(1160, 848, 200, FAR, 3, snow) +
    pine(1590, 846, 210, FAR, 3, snow) +
    '</g>' +
    drift(top, '#c4cdf3', 7) +
    '<g>' +
    pine(100, 866, 360, MID, 5, snow) +
    pine(470, 864, 270, MID, 4, snow) +
    cottage(590, 874, 150, 96, snow, '#8a5234', '#573019') +
    fence(500, 700, 884) +
    pine(1180, 864, 340, MID, 5, snow) +
    pine(1540, 866, 430, MID, 5, snow) +
    steps +
    cabin(1380, 872, 290, 390, snow) +
    lamp(1130, 884, 130) +
    pine(1060, 882, 160, NEAR, 4, snow) +
    pine(1560, 884, 170, NEAR, 4, snow) +
    pine(250, 874, 520, NEAR, 6, snow, true) +
    gift(292, 880, 34, 28, '#d63a45', '#ffd166') +
    gift(330, 882, 26, 20, '#3f7fd6', '#f6f9ff') +
    gift(176, 882, 30, 24, '#2f9e6e', '#ff6b7a') +
    snowman(400, 884) +
    pine(20, 892, 150, NEAR, 4, snow) +
    pine(720, 892, 110, NEAR, 4, snow) +
    '</g>' +
    drift(top + 44, '#aab6e8', 9) +
    drift(top + 96, '#929fda', 12) +
    dots +
    sign(180, 96, p) +
    `<g class="fall-a" fill="#ffffff" opacity="0.9">${flakes(many, 13, 3.4)}</g>` +
    '</svg>'
  )
}
