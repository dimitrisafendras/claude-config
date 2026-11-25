// The Christmas night scene: one SVG, built again when the context fill changes.
// Original art: a moon, stars, snowy pine trees with lights, falling snow and a snow ground.

export const SCENE = 'christmas-night'

const W = 1600
const H = 900

/** The same numbers on each build, so a redraw does not move the trees or the stars. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const clamp = (n: number): number => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0)
const r1 = (n: number): string => (Math.round(n * 10) / 10).toString()

/** The height of the snow ground, in scene units: 40 with an empty context window, 400 with a full one. */
export function groundHeight(percent: number): number {
  return Math.round(40 + clamp(percent) * 3.6)
}

/** How many flakes fall: more as the context window fills. */
export function flakeCount(percent: number): number {
  return 40 + Math.round(clamp(percent) * 0.6)
}

const LIGHTS = ['#ff5d6c', '#ffd166', '#7cc4ff', '#9bf2b4']

function tree(x: number, base: number, h: number, seed: number): string {
  const rand = rng(seed)
  const w = h * 0.58
  const tiers = 4
  let out = `<rect x="${r1(x - h * 0.03)}" y="${r1(base - h * 0.1)}" width="${r1(h * 0.06)}" height="${r1(h * 0.12)}" fill="#2a1a12"/>`
  for (let i = 0; i < tiers; i++) {
    const top = base - h + (i * h * 0.8) / tiers
    const bottom = top + h * 0.42
    const half = (w / 2) * (0.45 + (0.55 * (i + 1)) / tiers)
    out +=
      `<path d="M${r1(x)} ${r1(top)} L${r1(x + half)} ${r1(bottom)} L${r1(x - half)} ${r1(bottom)} Z" fill="${i % 2 ? '#0f3a2c' : '#124535'}"/>` +
      `<path d="M${r1(x - half)} ${r1(bottom)} Q${r1(x - half / 2)} ${r1(bottom - 12)} ${r1(x)} ${r1(bottom - 4)} Q${r1(x + half / 2)} ${r1(bottom - 14)} ${r1(x + half)} ${r1(bottom)} L${r1(x + half - 6)} ${r1(bottom - 8)} Q${r1(x)} ${r1(bottom - 18)} ${r1(x - half + 6)} ${r1(bottom - 8)} Z" fill="#eaf2ff" opacity="0.92"/>`
    const count = 3 + i
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count
      const lx = x - half * 0.85 + half * 1.7 * t
      const ly = bottom - 10 - rand() * h * 0.12
      const hue = LIGHTS[(k + i + seed) % LIGHTS.length]
      const phase = (k + i * 2 + seed) % 4
      out +=
        `<circle class="lg lp${phase}" cx="${r1(lx)}" cy="${r1(ly)}" r="${r1(9 + rand() * 4)}" fill="${hue}" opacity="0.35"/>` +
        `<circle class="l lp${phase}" cx="${r1(lx)}" cy="${r1(ly)}" r="${r1(2.6 + rand() * 1.4)}" fill="${hue}"/>`
    }
  }
  return out
}

function star(x: number, y: number, size: number, phase: number): string {
  const p: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 ? size * 0.45 : size
    p.push(`${r1(x + rr * Math.cos(a))} ${r1(y + rr * Math.sin(a))}`)
  }
  return (
    `<circle class="sg sp${phase % 3}" cx="${r1(x)}" cy="${r1(y)}" r="${r1(size * 2.2)}" fill="#ffd166" opacity="0.3"/>` +
    `<path class="top-star sp${phase % 3}" d="M${p.join(' L')} Z" fill="#ffe08a"/>`
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

function ground(height: number): string {
  const rand = rng(7)
  const top = H - height
  let d = `M0 ${H} L0 ${r1(top + 10)}`
  for (let x = 0; x < W; x += 200) {
    d += ` Q${r1(x + 100)} ${r1(top - 10 - rand() * 18)} ${r1(x + 200)} ${r1(top + 6 + rand() * 10)}`
  }
  d += ` L${W} ${H} Z`
  const sparkle = rng(11)
  let dots = ''
  for (let i = 0; i < 26; i++) {
    dots += `<circle class="g g${i % 3}" cx="${r1(sparkle() * W)}" cy="${r1(top + 18 + sparkle() * Math.max(10, height - 30))}" r="1.6" fill="#ffffff"/>`
  }
  return `<path d="${d}" fill="#7f93b8"/><path d="${d}" transform="translate(0 12)" fill="#9fb2d4"/>${dots}`
}

/** The whole scene for a context fill in percent. */
export function sceneOf(percent: number): string {
  const p = clamp(percent)
  const rand = rng(3)
  let stars = ''
  for (let i = 0; i < 70; i++) {
    stars += `<circle class="s s${i % 3}" cx="${r1(rand() * W)}" cy="${r1(rand() * H * 0.55)}" r="${r1(0.8 + rand() * 1.4)}" fill="#ffffff"/>`
  }
  const base = H - 20
  const TREES: [x: number, dy: number, h: number][] = [[110, 0, 430], [250, 10, 330], [370, 4, 250], [1250, 4, 260], [1370, 10, 360], [1500, 0, 460]]
  let trees = ''
  TREES.forEach(([x, dy, h], i) => {
    trees += tree(x, base + dy, h, i + 1) + star(x, base + dy - h - 6, 7 + h * 0.02, i)
  })
  const many = flakeCount(p)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice">` +
    '<defs><linearGradient id="sky-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#040916"/><stop offset="0.6" stop-color="#0c1a3a"/><stop offset="1" stop-color="#16295a"/></linearGradient>' +
    '<radialGradient id="moon-glow"><stop offset="0" stop-color="#fff6d8" stop-opacity="0.55"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/></radialGradient>' +
    '</defs>' +
    '<style>' +
    '.s{animation:tw 5s ease-in-out infinite}.s1{animation-delay:-1.7s}.s2{animation-delay:-3.3s}' +
    '.l{animation:bulb 2.4s ease-in-out infinite}.lg{animation:halo 2.4s ease-in-out infinite}' +
    '.lp1{animation-delay:-0.6s}.lp2{animation-delay:-1.2s}.lp3{animation-delay:-1.8s}' +
    '.sg{animation:halo 3.6s ease-in-out infinite}.sp1{animation-delay:-1.2s}.sp2{animation-delay:-2.4s}' +
    '.g{animation:tw 4s ease-in-out infinite}.g1{animation-delay:-1.3s}.g2{animation-delay:-2.6s}' +
    '.top-star{animation:shine 3.6s ease-in-out infinite;transform-box:fill-box;transform-origin:center}' +
    '.fall-a{animation:fall 30s linear infinite}.fall-b{animation:fall 46s linear infinite}' +
    '@keyframes tw{0%,100%{opacity:1}50%{opacity:0.45}}' +
    '@keyframes bulb{0%,100%{opacity:1}50%{opacity:0.3}}' +
    '@keyframes halo{0%,100%{opacity:0.4}50%{opacity:0.05}}' +
    '@keyframes shine{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.7;transform:scale(1.18)}}' +
    `@keyframes fall{from{transform:translate(0,0)}to{transform:translate(24px,${H}px)}}` +
    '</style>' +
    `<rect width="${W}" height="${H}" fill="url(#sky-fill)"/>` +
    stars +
    `<svg x="0" y="0" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMaxYMin meet">` +
    '<circle cx="1440" cy="130" r="120" fill="url(#moon-glow)"/><circle cx="1440" cy="130" r="44" fill="#fff6d8"/>' +
    '<circle cx="1424" cy="120" r="7" fill="#efe3bd"/><circle cx="1456" cy="146" r="5" fill="#efe3bd"/></svg>' +
    `<path d="M0 ${H - 150} Q300 ${H - 240} 620 ${H - 170} T1240 ${H - 180} T1600 ${H - 160} L1600 ${H} L0 ${H} Z" fill="#0a1630"/>` +
    trees +
    `<g class="fall-b" fill="#dfe9ff" opacity="0.55">${flakes(Math.round(many * 0.6), 21, 2.2)}</g>` +
    ground(groundHeight(p)) +
    `<g class="fall-a" fill="#ffffff" opacity="0.9">${flakes(many, 13, 3.6)}</g>` +
    '</svg>'
  )
}
