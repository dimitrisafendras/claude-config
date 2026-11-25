import type { Register } from 'claude-code'

/**
 * One known failure: `id` names it in the stats, `match` reads the error
 * text, `hint` is the one line the model reads after the failed result.
 * Add a row here to teach the mod a new failure. The first match wins.
 */
export type FailPattern = { id: string; match: RegExp; hint: string }

export const PATTERNS: readonly FailPattern[] = [
  {
    id: 'worktree-in-use',
    match: /is already used by worktree|already checked out at/i,
    hint: "Use that worktree's path, or `git worktree list` to find it; do not force.",
  },
  {
    id: 'missing-revision',
    match: /Needed a single revision|unknown revision|ambiguous argument '?origin\//i,
    hint: 'Run `git fetch origin` first, then retry.',
  },
  {
    id: 'github-rate-limit',
    match: /API rate limit exceeded|secondary rate limit|HTTP 429|HTTP 403[^\n]*rate limit/i,
    hint: 'GitHub rate limit: wait until the reset time (`gh api rate_limit`); do not poll.',
  },
  {
    id: 'bsd-sed',
    match: /sed: \d+: .*(invalid command code|extra characters|unterminated)|sed: -i may not be used|sed: -e: No such file/i,
    hint: "macOS sed: use `sed -i ''` or a short python script.",
  },
  {
    id: 'file-not-read',
    match: /File has not been read yet/i,
    hint: 'Read the file first, then edit.',
  },
  {
    id: 'string-not-found',
    match: /String to replace not found/i,
    hint: 'Read the current text of the file; it changed.',
  },
  {
    id: 'disk-full',
    match: /ENOSPC|No space left on device/i,
    hint: 'Disk is full: run /cleanup.',
  },
  {
    id: 'port-in-use',
    match: /EADDRINUSE|address already in use/i,
    hint: 'A server already uses that port: find it with `lsof -i :<port>`; reuse it.',
  },
  {
    id: 'npm-eresolve',
    match: /npm (ERR!|error) code ERESOLVE/i,
    hint: 'Do not use --force; check the lockfile and peer versions.',
  },
  {
    id: 'gh-auth',
    match: /gh: [^\n]*not logged|not logged in(to)? (any|to)? ?(GitHub|github\.com)|gh auth login|authentication (failed|required)|HTTP 401/i,
    hint: 'Run `gh auth status`; ask the person to sign in.',
  },
  {
    id: 'ssh-publickey',
    match: /Permission denied \(publickey/i,
    hint: 'SSH key problem: use the https remote or ask the person.',
  },
]

const STATS_KEY = 'stats'
const MAX_SCAN = 20_000

/** The first pattern the text matches, or undefined. */
export function findHint(text: string): FailPattern | undefined {
  const tail = text.length > MAX_SCAN ? text.slice(-MAX_SCAN) : text
  return PATTERNS.find(p => p.match.test(tail))
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

type Stats = Record<string, number>

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'fail-hints',
        description: 'Show how often each fail-hints pattern matched (stats), or reset the counts (reset).',
        argumentHint: 'stats|reset',
      })
    } catch {
      // The command is optional; the hints still work without it.
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      if (ran.deny !== undefined) return ran
      const text = ran.text ?? asText(ran.result)
      const isBashFail = String(e.tool) === 'Bash' && /exit code [1-9]\d*/i.test(text)
      if (ran.isError !== true && !isBashFail) return ran

      const found = findHint(text)
      if (found === undefined) return ran

      try {
        const stats = ((await $.store.get(STATS_KEY)) ?? {}) as Stats
        stats[found.id] = (stats[found.id] ?? 0) + 1
        await $.store.set(STATS_KEY, stats)
      } catch {
        // Counting is best effort.
      }

      return { ...ran, context: [...(ran.context ?? []), `fail-hints: ${found.hint}`] }
    } catch {
      return ran
    }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'fail-hints' }, async ($, e) => {
    try {
      const sub = e.args.trim().split(/\s+/)[0] ?? ''
      if (sub === 'reset') {
        await $.store.delete(STATS_KEY)
        return { text: 'fail-hints: the counts are reset.', isTextDisplayOnly: true }
      }
      if (sub !== '' && sub !== 'stats') {
        return { text: 'fail-hints: use /fail-hints stats or /fail-hints reset.', isTextDisplayOnly: true }
      }
      const stats = ((await $.store.get(STATS_KEY)) ?? {}) as Stats
      const rows = PATTERNS.map(p => `${String(stats[p.id] ?? 0).padStart(4)}  ${p.id}`)
      const total = Object.values(stats).reduce((a, b) => a + b, 0)
      return { text: `fail-hints: ${total} hints given.\n${rows.join('\n')}`, isTextDisplayOnly: true }
    } catch {
      return { text: 'fail-hints: the stats could not be read.' }
    }
  })
}
