import type { EngineInterface, Register } from 'claude-code'

type $ = EngineInterface

/** One known browser failure: `id` names it in the counts, `test` reads the text, `hint` is the one line the model reads. */
export type BrowserPattern = { id: string; test: (text: string) => boolean; hint: string }

export const BROWSER_PREFIXES = [
  'mcp__claude-in-chrome__',
  'mcp__Claude_Browser__',
  'mcp__chrome-devtools__',
  'mcp__plugin_playwright_playwright__',
] as const

/** The first pattern that matches wins. Add a row to teach the mod a new failure. */
export const PATTERNS: readonly BrowserPattern[] = [
  {
    id: 'tab-group',
    test: t => /not in Claude'?s tab group|tab group/i.test(t),
    hint: 'Call tabs_context first, then work in a tab from that list or create a new tab; do not reuse a stale tabId.',
  },
  {
    id: 'domain-change',
    test: t => /navigated to a different domain|different domain/i.test(t),
    hint: 'The page changed site. Take a new snapshot/screenshot and get fresh refs before the next click.',
  },
  {
    id: 'no-preview',
    test: t => /No preview is open|browser is not open/i.test(t),
    hint: 'Open the page first (preview_start with a url, or navigate).',
  },
  {
    id: 'policy-wait',
    test: t => /Policy check in progress/i.test(t),
    hint: 'Wait a few seconds, then retry the same call once.',
  },
  {
    id: 'extension-down',
    test: t => /extension/i.test(t) && /not connected|disconnected/i.test(t),
    hint: 'The Chrome extension bridge is down: ask the person to open Chrome and the Claude extension; do not retry in a loop.',
  },
  {
    id: 'tab-gone',
    test: t => /No tab with id|tab not found|tab[^.\n]{0,40}\bclosed\b|target closed|page closed/i.test(t),
    hint: 'The tab is gone: list the tabs again and pick a live one.',
  },
  {
    id: 'cdp-timeout',
    test: t => /\bCDP\b|timed out|timeout/i.test(t),
    hint: 'Retry once; if it fails again read the page as text instead of a screenshot.',
  },
]

const SIGN_IN_HINT =
  'This is a sign-in page. Stop. Ask the person to sign in on this page; do not type credentials; continue when they say it is done.'
const LOOP_HINT = 'the same call failed 3 times; stop retrying and report the error to the person.'
const NOTIFY_EVERY_MS = 10 * 60_000
const LOOP_WINDOW_MS = 2 * 60_000
const LOOP_LIMIT = 3
const MAX_SCAN = 20_000
const ERRORISH = /\b(error|failed|failure|not connected|disconnected|timed out|no preview|policy check)\b/i
const READ_TOOLS = /navigate|read_page|get_page_text|snapshot/i
const SIGN_IN_URL = /login|log-in|signin|sign-in|accounts\.google\.com|login\.microsoftonline\.com|auth0|okta|(^|[^a-z])sso([^a-z]|$)/
const SIGN_IN_TITLE = /title["':=\s]+[^\n]{0,80}?(log[ -]?in|sign[ -]?in)/i

const mem = {
  enabled: true,
  notified: new Map<string, number>(),
  fails: new Map<string, { sig: string; times: number[] }>(),
}

export function isBrowserTool(tool: string): boolean {
  return BROWSER_PREFIXES.some(p => tool.startsWith(p))
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

/** The first pattern the error text matches, or undefined. */
export function findPattern(text: string): BrowserPattern | undefined {
  const tail = text.length > MAX_SCAN ? text.slice(-MAX_SCAN) : text
  return PATTERNS.find(p => p.test(tail))
}

/** The host of the first URL in the text, its host and path lowercased, or undefined. */
export function firstUrl(text: string): { host: string; hostPath: string } | undefined {
  const m = /https?:\/\/([^\s"'<>)\]\\/?#]+)([^\s"'<>)\]\\?#]*)/i.exec(text)
  if (m === null) return undefined
  const host = (m[1] ?? '').toLowerCase()
  return { host, hostPath: host + (m[2] ?? '').toLowerCase() }
}

/** localhost, 127.0.0.1 or a name that ends in .localhost, with any port. Never a staging or public host. */
const LOCAL_DEV_HOST = /^(localhost|127\.0\.0\.1|[a-z0-9-]+(\.[a-z0-9-]+)*\.localhost)(:\d+)?$/

/** The host a sign-in page lives on (or 'this page'), or undefined when the text shows no sign-in page. */
export function signInHost(text: string): string | undefined {
  const url = firstUrl(text)
  const byUrl = url !== undefined && SIGN_IN_URL.test(url.hostPath)
  const byTitle = SIGN_IN_TITLE.test(text)
  const byText = /sign[ -]?in|log[ -]?in/i.test(text) && /password/i.test(text)
  if (!byUrl && !byTitle && !byText) return undefined
  // A local development host serves the person's own app with seeded test accounts, so no stop there.
  if (url !== undefined && LOCAL_DEV_HOST.test(url.host)) return undefined
  return url?.host ?? 'this page'
}

function signature(text: string): string {
  return text.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 120)
}

async function count($: $, id: string): Promise<void> {
  try {
    const counts = (((await $.store.get('counts')) as Record<string, number> | undefined) ?? {})
    counts[id] = (counts[id] ?? 0) + 1
    await $.store.set('counts', counts)
  } catch {
    // Counting is best effort.
  }
}

/** True once the same tool failed with the same error LOOP_LIMIT times in a row within the window. */
function isLoop(tool: string, text: string, now: number): boolean {
  const sig = signature(text)
  const prev = mem.fails.get(tool)
  const times = prev !== undefined && prev.sig === sig ? prev.times : []
  times.push(now)
  const recent = times.filter(t => now - t <= LOOP_WINDOW_MS)
  mem.fails.set(tool, { sig, times: recent })
  return recent.length >= LOOP_LIMIT
}

/** The hint for one finished browser call, or undefined. Updates the loop state and the sign-in throttle. */
async function hintFor($: $, tool: string, ran: { isError?: boolean; text?: string; result?: unknown }): Promise<{ id: string; hint: string } | undefined> {
  const text = ran.text ?? asText(ran.result)
  const now = await $.clock.now()
  const isFailure = ran.isError === true || (text.length < 600 && ERRORISH.test(text))

  if (!isFailure) {
    mem.fails.delete(tool)
    if (!READ_TOOLS.test(tool)) return undefined
    const host = signInHost(text)
    if (host === undefined) return undefined
    const last = mem.notified.get(host)
    if (last === undefined || now - last >= NOTIFY_EVERY_MS) {
      mem.notified.set(host, now)
      try {
        await $.ui.notify(`browser-keeper: ${host} needs your sign-in`)
      } catch {
        // The notification is optional.
      }
    }
    return { id: 'sign-in', hint: SIGN_IN_HINT }
  }

  if (isLoop(tool, text, now)) return { id: 'loop-guard', hint: LOOP_HINT }
  const found = findPattern(text)
  return found === undefined ? undefined : { id: found.id, hint: found.hint }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      mem.notified = new Map()
      mem.fails = new Map()
      mem.enabled = (await $.store.get('enabled')) !== false
      await $.command.register({
        name: 'browser-keeper',
        description: 'Browser keeper: status (hint counts), on, off.',
        argumentHint: 'status|on|off',
      })
    } catch {
      // The command is optional; the hints still work without it.
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      const tool = String(e.tool)
      if (!mem.enabled || !isBrowserTool(tool) || ran.deny !== undefined) return ran
      const found = await hintFor($, tool, ran)
      if (found === undefined) return ran
      await count($, found.id)
      return { ...ran, context: [...(ran.context ?? []), `browser-keeper: ${found.hint}`] }
    } catch {
      return ran
    }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'browser-keeper' }, async ($, e) => {
    try {
      const sub = e.args.trim().split(/\s+/)[0] ?? ''
      if (sub === 'on' || sub === 'off') {
        mem.enabled = sub === 'on'
        await $.store.set('enabled', mem.enabled)
        return { text: `browser-keeper: ${sub}.`, isTextDisplayOnly: true }
      }
      if (sub !== '' && sub !== 'status') {
        return { text: 'browser-keeper: use /browser-keeper status, on or off.', isTextDisplayOnly: true }
      }
      const counts = ((await $.store.get('counts')) as Record<string, number> | undefined) ?? {}
      const ids = [...PATTERNS.map(p => p.id), 'sign-in', 'loop-guard']
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      const rows = ids.map(id => `${String(counts[id] ?? 0).padStart(4)}  ${id}`)
      return { text: `browser-keeper: ${mem.enabled ? 'on' : 'off'}, ${total} hints given.\n${rows.join('\n')}`, isTextDisplayOnly: true }
    } catch {
      return { text: 'browser-keeper: the status could not be read.', isTextDisplayOnly: true }
    }
  })
}
