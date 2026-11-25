import type { EngineInterface, Register } from 'claude-code'

// memory-governor: reads ~/.claude/mem-budget.sh every minute and refuses new
// agents and heavy Bash jobs while the machine has no room for them.
//
// mem-budget.sh prints one line:
//   free=41% total=24576MB heavy_procs=2 room_for_heavy_jobs=0 (floor 30%, ~3500MB/job)
// and exits 0 when there is room for another heavy job, 1 when not.
// MEM_FLOOR_PCT and MEM_JOB_MB in the environment tune it.

type Reading = {
  at: number
  freePct: number
  totalMb: number
  heavyProcs: number
  room: number
  floorPct: number
  exitCode: number
  line: string
}

const PERIOD_MS = 60_000
const STALE_MS = 3 * 60_000
// Agent types that read and search only: never refused.
const LIGHT_AGENTS = new Set(['Explore'])

// Heavy Bash jobs. Conservative: the segment must START with one of these.
const HEAVY: readonly RegExp[] = [
  /^(npm)\s+(ci|install|i)(\s|$)/,
  /^(pnpm)\s+(install|i)(\s|$)/,
  /^(npx\s+)?expo\s+run(:ios|:android)?(\s|$)/,
  /^npx\s+expo\s+start(\s|$)/,
  /^xcodebuild(\s|$)/,
]
// A full vitest run: `npx vitest run` (or pnpm/yarn) with flags only, no path.
const VITEST = /^(npx|pnpm(\s+exec)?|yarn)\s+vitest\s+run((\s+--?[\w-]+(=\S+)?)*)\s*$/

let enabled = true
let scriptPath: string | undefined
let last: Reading | undefined
let lastError: string | undefined
let isBelowFloor = false
let denies = 0
let timer: { cancel: () => void } | undefined

export function parseReading(stdout: string, exitCode: number, at: number): Reading | undefined {
  const line = stdout.trim().split('\n').pop() ?? ''
  const free = /free=(\d+)%/.exec(line)
  const room = /room_for_heavy_jobs=(\d+)/.exec(line)
  if (!free || !room) return undefined
  const num = (re: RegExp, d: number) => {
    const m = re.exec(line)
    return m?.[1] !== undefined ? Number(m[1]) : d
  }
  return {
    at,
    freePct: Number(free[1]),
    totalMb: num(/total=(\d+)MB/, 0),
    heavyProcs: num(/heavy_procs=(\d+)/, 0),
    room: Number(room[1]),
    floorPct: num(/floor (\d+)%/, 30),
    exitCode,
    line,
  }
}

const hasRoom = (r: Reading) => r.room > 0 && r.exitCode === 0

// Strip `cd x &&`, `FOO=1` prefixes; test each `&&`, `||`, `;`, `|` segment.
export function heavyJob(command: string): string | undefined {
  for (const raw of command.split(/&&|\|\||;|\||\n/)) {
    let seg = raw.trim()
    while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(seg)) seg = seg.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '')
    if (seg.length === 0 || seg.startsWith('cd ')) continue
    if (HEAVY.some(re => re.test(seg)) || VITEST.test(seg)) return seg.split(/\s+/).slice(0, 3).join(' ')
  }
  return undefined
}

function show($: EngineInterface) {
  try {
    if (!enabled) return $.ui.status('mem: governor off')
    if (!last) return $.ui.status(lastError ? 'mem: no reading' : undefined)
    $.ui.status(`mem ${last.freePct}% · room ${last.room}`)
  } catch {
    // status is cosmetic
  }
}

async function heavyList($: EngineInterface): Promise<string> {
  try {
    const ps = await $.process.run(['ps', '-axo', 'rss=,comm='], { timeoutMs: 5_000 })
    const rows = ps.stdout
      .split('\n')
      .map(l => l.trim())
      .filter(l => /vitest|jest|npm|node|vite|tsc|nx|expo|metro|xcodebuild|claude/i.test(l))
      .map(l => {
        const [rss = '0', ...cmd] = l.split(/\s+/)
        const name = (cmd.join(' ').split('/').pop() ?? '').slice(0, 30)
        return { mb: Math.round(Number(rss) / 1024), name }
      })
      .sort((a, b) => b.mb - a.mb)
      .slice(0, 5)
    return rows.map(r => `${r.name} ${r.mb}MB`).join(', ')
  } catch {
    return ''
  }
}

async function measure($: EngineInterface): Promise<Reading | undefined> {
  try {
    if (scriptPath === undefined) {
      // Windows apps have no HOME, so USERPROFILE stands in.
      const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
      if (!home) throw new Error('HOME and USERPROFILE are not set')
      scriptPath = `${home.replace(/\\/g, '/')}/.claude/mem-budget.sh`
    }
    const ran = await $.process.run(['bash', scriptPath], { timeoutMs: 20_000 })
    const r = parseReading(ran.stdout, ran.exitCode, await $.clock.now())
    if (!r) {
      lastError = `unreadable output: ${(ran.stdout + ran.stderr).trim().slice(0, 120)}`
      return last
    }
    last = r
    lastError = undefined
    show($)
    // Notify once on the way below the floor; re-arm when back above it.
    if (r.freePct < r.floorPct) {
      if (!isBelowFloor) {
        isBelowFloor = true
        const procs = await heavyList($)
        const text = `Free memory ${r.freePct}% is below the ${r.floorPct}% floor (${r.heavyProcs} heavy jobs). ${procs ? `Top: ${procs}.` : ''}`
        void $.ui.notify(text, { title: 'memory-governor' }).catch(() => {})
      }
    } else {
      isBelowFloor = false
    }
    return r
  } catch (err) {
    lastError = String(err)
    return last
  }
}

// The reading to decide on: refreshed first when it is older than 3 minutes.
async function current($: EngineInterface): Promise<Reading | undefined> {
  const now = await $.clock.now()
  if (!last || now - last.at > STALE_MS) return measure($)
  return last
}

const reason = (r: Reading, what: string) =>
  `memory-governor: free memory is ${r.freePct}% (floor ${r.floorPct}%, ${r.heavyProcs} heavy jobs running), no room for ${what}; wait or stop one; /memgov off to disable.`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const stored = await $.store.get('enabled')
      enabled = stored !== false
      denies = Number((await $.store.get('denies')) ?? 0) || 0
      await $.command.register({
        name: 'memgov',
        description: 'Memory governor: on, off, status',
        argumentHint: 'on | off | status',
        immediate: true,
      })
      timer?.cancel()
      timer = $.clock.every(PERIOD_MS, () => {
        void measure($)
      })
      void measure($)
    } catch {
      // never block the session start
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    try {
      if (!enabled || e.resume !== undefined) return next(e)
      if (LIGHT_AGENTS.has(e.subagentType) || /haiku/i.test(e.model ?? '')) return next(e)
      const r = await current($)
      if (!r || hasRoom(r)) return next(e)
      denies += 1
      void $.store.set('denies', denies).catch(() => {})
      return { deny: reason(r, 'another agent') }
    } catch {
      return next(e)
    }
    // Fails open: a broken governor must not stop the work.
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    try {
      if (!enabled) return next(e)
      const job = heavyJob(e.command)
      if (job === undefined) return next(e)
      const r = await current($)
      if (!r || hasRoom(r)) return next(e)
      denies += 1
      void $.store.set('denies', denies).catch(() => {})
      return { deny: reason(r, `a heavy job (${job})`) }
    } catch {
      return next(e)
    }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'memgov' }, async ($, e) => {
    try {
      const sub = e.args.trim().split(/\s+/)[0] || 'status'
      if (sub === 'on') {
        enabled = true
        await $.store.set('enabled', true)
        await measure($)
        show($)
        return { text: 'memory-governor is on.' }
      }
      if (sub === 'off') {
        enabled = false
        await $.store.set('enabled', false)
        show($)
        return { text: 'memory-governor is off. Agents and heavy jobs are not checked.' }
      }
      const r = await current($)
      const now = await $.clock.now()
      const age = r ? `${Math.round((now - r.at) / 1000)} s ago (${new Date(r.at).toISOString()})` : '-'
      return {
        text: [
          `memory-governor is ${enabled ? 'on' : 'off'}.`,
          r
            ? `Last reading: free ${r.freePct}%, room ${r.room}, heavy jobs ${r.heavyProcs}, floor ${r.floorPct}%, exit ${r.exitCode}.`
            : 'Last reading: none.',
          `Taken: ${age}.`,
          ...(lastError ? [`Last error: ${lastError}`] : []),
          `Denies made: ${denies}.`,
        ].join('\n'),
      }
    } catch (err) {
      return { text: `memory-governor: the command failed (${String(err)}).` }
    }
  })
}
