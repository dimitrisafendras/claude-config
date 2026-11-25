import type { EngineInterface, Register } from 'claude-code'

// session-relay: tells the person at once when a message to another session was
// not delivered, or when a hook call timed out; and tells the model, so it does
// not assume the message was read or the call ran.

type $T = EngineInterface

const NOTIFY_THROTTLE_MS = 2 * 60_000
const TOAST_THROTTLE_MS = 60_000
const MAX_EVENTS = 50
const MAX_DAYS = 30
// A status line from a messaging tool is short. A long non-error result is
// content (for example an echoed message), so it is not scanned.
const MAX_SCAN_OK = 600
const COUNTS_KEY = 'counts'
const EVENTS_KEY = 'events'

/** A failure of a message to another session. "queued for delivery" is normal and is not listed. */
export const FAIL_PATTERNS: readonly RegExp[] = [
  /could not be delivered/i,
  /not delivered/i,
  /no such session/i,
  /session not found/i,
  /is not running/i,
  /refused/i,
  /host client may be unreachable/i,
  /timed out/i,
]

export type Kind = 'undelivered' | 'hook-timeout'
export type RelayEvent = { at: number; kind: Kind; tool: string; to?: string; reason: string }
type Counts = Record<string, { undelivered: number; hookTimeouts: number }>

export const isMessagingTool = (tool: string): boolean =>
  tool === 'SendMessage' || tool.endsWith('__send_message') || tool.endsWith('__start_session')

/** The matched phrase of a message failure, or undefined. */
export function findFailure(text: string): string | undefined {
  for (const p of FAIL_PATTERNS) {
    const m = p.exec(text)
    if (m !== null) return m[0].toLowerCase()
  }
  return undefined
}

/** A hook timeout shows the hook event name and a timeout or an unreachable host. */
export function isHookTimeout(text: string): boolean {
  return /PreToolUse/i.test(text) && /timed out|host client may be unreachable/i.test(text)
}

const TO_KEYS = ['to', 'session_id', 'sessionId', 'target', 'recipient', 'name', 'title']

/** Who the message went to: from the tool input, else from the result text. */
export function recipientOf(input: Record<string, unknown>, text: string): string {
  for (const k of TO_KEYS) {
    const v = input[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim().slice(0, 80)
  }
  const m = /(?:to|session)\s+["'`]?([\w:.-]{3,60})["'`]?/i.exec(text)
  return m?.[1] ?? 'unknown recipient'
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 120)

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

function textOf(ran: { text?: string; result?: unknown; deny?: string }): string {
  if (typeof ran.deny === 'string') return ran.deny
  if (typeof ran.text === 'string') return ran.text
  if (typeof ran.result === 'string') return ran.result
  return ''
}

async function log($: $T, ev: RelayEvent): Promise<void> {
  try {
    const events = (((await $.store.get(EVENTS_KEY)) as RelayEvent[] | undefined) ?? []).concat(ev).slice(-MAX_EVENTS)
    await $.store.set(EVENTS_KEY, events)
    const counts = ((await $.store.get(COUNTS_KEY)) as Counts | undefined) ?? {}
    const d = day(ev.at)
    const row = counts[d] ?? { undelivered: 0, hookTimeouts: 0 }
    if (ev.kind === 'undelivered') row.undelivered += 1
    else row.hookTimeouts += 1
    counts[d] = row
    const keep = Object.keys(counts).sort().slice(-MAX_DAYS)
    const trimmed: Counts = {}
    for (const k of keep) trimmed[k] = counts[k]!
    await $.store.set(COUNTS_KEY, trimmed)
  } catch {
    // Counting is best effort.
  }
}

export const register: Register = on => {
  const lastNotify = new Map<string, number>()
  let lastHookToast = -Infinity

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'relay-status',
        description: 'Show the last 10 undelivered messages and hook timeouts, and the counts by day.',
        argumentHint: '',
      })
    } catch {
      // The command is optional; the alerts still work without it.
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      const tool = String(e.tool)
      const text = textOf(ran)
      if (text === '') return ran
      const now = await $.clock.now()

      // 1. A hook call that timed out: any tool, any result.
      const isScannable = ran.isError === true || ran.deny !== undefined || text.length <= MAX_SCAN_OK
      if (isScannable && isHookTimeout(text)) {
        await log($, { at: now, kind: 'hook-timeout', tool, reason: oneLine(text) })
        if (now - lastHookToast >= TOAST_THROTTLE_MS) {
          lastHookToast = now
          $.ui.toast(`session-relay: a hook call timed out on ${tool}`)
        }
        if (ran.deny !== undefined) return ran
        return { ...ran, context: [...(ran.context ?? []), 'session-relay: the call did not run; retry once.'] }
      }

      // 2. A message to another session that did not arrive.
      if (!isMessagingTool(tool) || ran.deny !== undefined) return ran
      if (ran.isError !== true && text.length > MAX_SCAN_OK) return ran
      const reason = findFailure(text)
      if (reason === undefined) return ran

      const input = e as unknown as Record<string, unknown>
      const to = recipientOf(input, text)
      await log($, { at: now, kind: 'undelivered', tool, to, reason })

      const prev = lastNotify.get(to)
      if (prev === undefined || now - prev >= NOTIFY_THROTTLE_MS) {
        lastNotify.set(to, now)
        const line = `session-relay: the message to ${to} did not arrive (${reason}).`
        $.ui.toast(line)
        void $.ui.notify(line, { title: 'session-relay' }).catch(() => undefined)
      }
      return {
        ...ran,
        context: [
          ...(ran.context ?? []),
          `session-relay: the message to ${to} did not arrive (${reason}). Check the recipient with the session list before you resend; do not assume it was read.`,
        ],
      }
    } catch {
      return ran
    }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'relay-status' }, async $ => {
    try {
      const events = ((await $.store.get(EVENTS_KEY)) as RelayEvent[] | undefined) ?? []
      const counts = ((await $.store.get(COUNTS_KEY)) as Counts | undefined) ?? {}
      const days = Object.keys(counts).sort()
      let u = 0
      let h = 0
      for (const d of days) {
        u += counts[d]!.undelivered
        h += counts[d]!.hookTimeouts
      }
      const last = events.slice(-10).reverse()
      const rows = last.map(
        ev =>
          `${new Date(ev.at).toISOString().slice(0, 16).replace('T', ' ')}  ${ev.kind === 'undelivered' ? `undelivered to ${ev.to ?? '?'}` : `hook timeout on ${ev.tool}`}  (${oneLine(ev.reason).slice(0, 60)})`,
      )
      const byDay = days.slice(-7).map(d => `${d}: ${counts[d]!.undelivered} undelivered, ${counts[d]!.hookTimeouts} hook timeouts`)
      return {
        text:
          `session-relay: ${u} undelivered, ${h} hook timeouts (last ${days.length} days).\n` +
          (byDay.length > 0 ? `${byDay.join('\n')}\n` : '') +
          (rows.length > 0 ? `Last ${rows.length} events:\n${rows.join('\n')}` : 'No events yet.'),
        isTextDisplayOnly: true,
      }
    } catch {
      return { text: 'session-relay: the status could not be read.', isTextDisplayOnly: true }
    }
  })
}
