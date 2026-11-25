import type { EngineInterface, PromptSubmitInput, Register } from 'claude-code'

/** One indexed skill: its name, a one-line summary and its quoted trigger phrases. */
export type SkillEntry = { name: string; summary: string; phrases: string[] }

type Decision = { at: number; prompt: string; how: string; skill?: string; detail?: string }
type Stats = { suggested: number; accepted: number }

const REFRESH_MS = 10 * 60_000
const CLASSIFY_TIMEOUT_MS = 4000
const MIN_LENGTH = 12
const CLASSIFY_MIN_LENGTH = 40
const RECENT_PROMPTS = 3
const CACHE_LIMIT = 200
const ACK = /^(y(es|ep|eah|up)?|ok(ay)?|sure|continue|go( on| ahead)?|proceed|thanks?( you)?|thx|do it|sounds good|lgtm|yes please|please do|next|keep going|carry on|fine|great|cool|done|no|nope)[\s.!?]*$/i
const TYPED = new Set(['composer', 'bridge', 'sdk'])

// Index and session memory. Reset at session.start.
const mem = {
  enabled: true,
  index: [] as SkillEntry[],
  indexedAt: 0,
  seq: 0,
  suggestedAt: new Map<string, number>(),
  invoked: new Set<string>(),
  pending: undefined as string | undefined,
  cache: new Map<string, string>(),
  last: undefined as Decision | undefined,
  stats: { suggested: 0, accepted: 0 } as Stats,
  timer: undefined as { cancel: () => void } | undefined,
  cwd: '',
}

/** Strip a plugin prefix and a leading slash: `plugin:name` and `/name` both give `name`. */
export function bareName(name: string): string {
  const n = name.trim().replace(/^\//, '')
  const i = n.lastIndexOf(':')
  return (i >= 0 ? n.slice(i + 1) : n).toLowerCase()
}

/** A small stable hash of the prompt (FNV-1a) for the classify cache. */
export function hashOf(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16) + ':' + text.length
}

/** The frontmatter keys of a SKILL.md as plain strings (folded and block scalars joined). */
export function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out: Record<string, string> = {}
  if (m === null) return out
  const lines = (m[1] ?? '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i] ?? '')
    if (kv === null) continue
    const key = kv[1] as string
    let value = (kv[2] ?? '').trim()
    const isBlock = /^[>|][+-]?$/.test(value)
    const parts: string[] = isBlock ? [] : [value]
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] ?? '')) {
      parts.push((lines[i + 1] ?? '').trim())
      i++
    }
    value = parts.join(' ').trim()
    if (/^".*"$/s.test(value)) value = value.slice(1, -1).replace(/\\"/g, '"')
    else if (/^'.*'$/s.test(value)) value = value.slice(1, -1).replace(/''/g, "'")
    out[key] = value
  }
  return out
}

/** The quoted phrases ("...") of a description, the cheap keys. */
export function phrasesOf(description: string): string[] {
  const found = new Set<string>()
  for (const m of description.matchAll(/["“]([^"”\n]{4,80})["”]/g)) {
    const p = (m[1] ?? '').trim().toLowerCase()
    if (p.length >= 4) found.add(p)
  }
  return [...found]
}

function summaryOf(description: string): string {
  const first = description.split(/(?<=[.!?])\s/)[0] ?? description
  return first.length > 140 ? first.slice(0, 137) + '...' : first
}

/** One SKILL.md as an index entry, or undefined when it opts out of model invocation. */
export function entryOf(dirName: string, text: string): SkillEntry | undefined {
  const fm = parseFrontmatter(text)
  if (/^true$/i.test(fm['disable-model-invocation'] ?? '')) return undefined
  const name = (fm.name ?? '').trim() || dirName
  const description = fm.description ?? ''
  return { name, summary: summaryOf(description), phrases: phrasesOf(description) }
}

async function scanDir($: $, dir: string): Promise<SkillEntry[]> {
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return []
  }
  const found = await Promise.all(
    entries
      .filter(x => x.kind === 'dir' || x.isLink === true)
      .map(async x => {
        try {
          const text = await $.fs.read(`${dir}/${x.name}/SKILL.md`)
          return typeof text === 'string' ? entryOf(x.name, text) : undefined
        } catch {
          return undefined
        }
      }),
  )
  return found.filter((x): x is SkillEntry => x !== undefined)
}

async function refresh($: $): Promise<number> {
  // Windows apps have no HOME, so USERPROFILE stands in.
  const home = ((await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '').replace(/\\/g, '/')
  const byName = new Map<string, SkillEntry>()
  const user = home === '' ? [] : await scanDir($, `${home}/.claude/skills`)
  const project = mem.cwd === '' ? [] : await scanDir($, `${mem.cwd}/.claude/skills`)
  for (const s of [...user, ...project]) byName.set(bareName(s.name), s)
  mem.index = [...byName.values()]
  mem.indexedAt = await $.clock.now()
  return mem.index.length
}

type $ = EngineInterface

function skipReason(e: { text: string; command?: unknown; isMeta?: true; origin: { kind: string } }): string | undefined {
  if (e.command !== undefined) return 'slash command'
  if (e.isMeta === true) return 'meta prompt'
  if (!TYPED.has(e.origin.kind)) return `origin ${e.origin.kind}`
  const t = e.text.trim()
  if (t.length < MIN_LENGTH) return 'short prompt'
  if (ACK.test(t)) return 'acknowledgement'
  return undefined
}

function withTimeout<T>($: $, work: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise(resolve => {
    const timer = $.clock.after(ms, () => resolve(undefined))
    work.then(
      v => {
        timer.cancel()
        resolve(v)
      },
      () => {
        timer.cancel()
        resolve(undefined)
      },
    )
  })
}

type Pick = { skill: SkillEntry; how: string; detail: string }

async function choose($: $, text: string, pool: SkillEntry[]): Promise<{ pick?: Pick; how: string; detail?: string }> {
  if (pool.length === 0) return { how: 'no skills to suggest' }
  const lower = text.toLowerCase()
  const hits = pool
    .map(s => ({ s, phrase: s.phrases.filter(p => lower.includes(p)).sort((a, b) => b.length - a.length)[0] }))
    .filter((h): h is { s: SkillEntry; phrase: string } => h.phrase !== undefined)
  if (hits.length === 1) {
    const h = hits[0] as { s: SkillEntry; phrase: string }
    return { pick: { skill: h.s, how: 'trigger', detail: `the prompt contains the trigger phrase "${h.phrase}"` }, how: 'trigger' }
  }
  if (text.trim().length <= CLASSIFY_MIN_LENGTH) return { how: hits.length > 1 ? 'ambiguous trigger, prompt too short to classify' : 'no trigger hit, prompt too short to classify' }

  const candidates = hits.length > 1 ? hits.map(h => h.s) : pool
  const key = hashOf(text) + ':' + candidates.map(c => c.name).join(',')
  let label = mem.cache.get(key)
  let how = 'cache'
  if (label === undefined) {
    how = 'classify'
    const list = candidates.map(c => `- ${c.name}: ${c.summary}`).join('\n')
    const body = `Pick the skill that fits this request best, or none.\nSkills:\n${list}\n\nRequest:\n${text.slice(0, 1500)}`
    const labels = [...candidates.map(c => c.name), 'none']
    const got = await withTimeout($, $.model.classify(body, labels, { model: 'haiku' }), CLASSIFY_TIMEOUT_MS)
    label = got === undefined ? 'none' : got.trim()
    if (got !== undefined) {
      if (mem.cache.size >= CACHE_LIMIT) mem.cache.delete(mem.cache.keys().next().value as string)
      mem.cache.set(key, label)
    }
    if (got === undefined) how = 'classify (no answer or timeout)'
  }
  const skill = candidates.find(c => bareName(c.name) === bareName(label as string))
  if (skill === undefined) return { how: `${how}: none` }
  return { pick: { skill, how, detail: `its description fits: ${skill.summary}` }, how }
}

async function saveStats($: $): Promise<void> {
  try {
    await $.store.set('stats', mem.stats)
  } catch {
    // Counting is best effort.
  }
}

async function onPrompt($: $, e: PromptSubmitInput): Promise<string | undefined> {
  if (!mem.enabled) return undefined
  mem.seq += 1
  const snippet = e.text.trim().slice(0, 60)
  const at = await $.clock.now()
  const skip = skipReason(e)
  if (skip !== undefined) {
    mem.last = { at, prompt: snippet, how: `skipped: ${skip}` }
    return undefined
  }
  const pool = mem.index.filter(s => {
    const n = bareName(s.name)
    const seen = mem.suggestedAt.get(n)
    return !mem.invoked.has(n) && (seen === undefined || mem.seq - seen > RECENT_PROMPTS)
  })
  const r = await choose($, e.text, pool)
  if (r.pick === undefined) {
    mem.last = { at, prompt: snippet, how: r.how }
    return undefined
  }
  const name = r.pick.skill.name
  mem.suggestedAt.set(bareName(name), mem.seq)
  mem.pending = bareName(name)
  mem.stats.suggested += 1
  mem.last = { at, prompt: snippet, how: r.pick.how, skill: name, detail: r.pick.detail }
  await saveStats($)
  return `skill-router: this request matches the skill "${name}" (${r.pick.detail}). Load it with the Skill tool before you act, unless it is already loaded or clearly does not fit.`
}

async function noteInvoked($: $, raw: unknown): Promise<void> {
  if (typeof raw !== 'string' || raw === '') return
  const n = bareName(raw)
  mem.invoked.add(n)
  if (mem.pending === n) {
    mem.pending = undefined
    mem.stats.accepted += 1
    await saveStats($)
  }
}

function statusText(): string {
  const { suggested, accepted } = mem.stats
  const rate = suggested === 0 ? 'n/a' : `${Math.round((accepted / suggested) * 100)}%`
  return [
    `skill-router: ${mem.enabled ? 'on' : 'off'}. ${mem.index.length} skills indexed, ${mem.index.reduce((n, s) => n + s.phrases.length, 0)} trigger phrases.`,
    `Suggested ${suggested}, accepted ${accepted} (${rate}). ${mem.invoked.size} skills invoked this session.`,
  ].join('\n')
}

function whyText(): string {
  const l = mem.last
  if (l === undefined) return 'skill-router: no decision yet.'
  const out = [`skill-router: last prompt "${l.prompt}"`, `How: ${l.how}.`]
  if (l.skill !== undefined) out.push(`Suggested: ${l.skill} (${l.detail ?? ''}).`)
  else out.push('Suggested: nothing.')
  return out.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      mem.index = []
      mem.seq = 0
      mem.suggestedAt = new Map()
      mem.invoked = new Set()
      mem.pending = undefined
      mem.cache = new Map()
      mem.last = undefined
      mem.cwd = e.cwd
      const saved = (await $.store.get('stats')) as Stats | undefined
      mem.stats = { suggested: saved?.suggested ?? 0, accepted: saved?.accepted ?? 0 }
      const off = await $.store.get('enabled')
      mem.enabled = off !== false
      await $.command.register({
        name: 'skill-router',
        description: 'Skill router: status, on, off, reload (rebuild the skill index), why (last decision).',
        argumentHint: 'status|on|off|reload|why',
      })
      mem.timer?.cancel()
      mem.timer = $.clock.every(REFRESH_MS, () => {
        void refresh($).catch(() => undefined)
      })
      await refresh($)
    } catch {
      // The router is optional; the session starts without it.
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    let line: string | undefined
    try {
      line = await onPrompt($, e)
    } catch {
      line = undefined
    }
    return next(line === undefined ? e : { ...e, context: [...(e.context ?? []), line] })
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    try {
      await noteInvoked($, (e as { skill?: unknown }).skill)
    } catch {
      // Tracking is best effort.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    try {
      await noteInvoked($, e.skill)
    } catch {
      // Tracking is best effort.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'skill-router' }, async ($, e) => {
    try {
      const sub = e.args.trim().split(/\s+/)[0] ?? ''
      if (sub === '' || sub === 'status') return { text: statusText(), isTextDisplayOnly: true }
      if (sub === 'why') return { text: whyText(), isTextDisplayOnly: true }
      if (sub === 'on' || sub === 'off') {
        mem.enabled = sub === 'on'
        await $.store.set('enabled', mem.enabled)
        return { text: `skill-router: ${sub}.`, isTextDisplayOnly: true }
      }
      if (sub === 'reload') {
        const n = await refresh($)
        return { text: `skill-router: index rebuilt, ${n} skills.`, isTextDisplayOnly: true }
      }
      return { text: 'skill-router: use /skill-router status, on, off, reload or why.', isTextDisplayOnly: true }
    } catch {
      return { text: 'skill-router: the command failed.', isTextDisplayOnly: true }
    }
  })
}
