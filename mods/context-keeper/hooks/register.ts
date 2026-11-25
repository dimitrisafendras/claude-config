import type { EngineInterface, Register } from 'claude-code'

import type { ContextKeeperItem, ContextKeeperRecord } from '../types'

type $ = EngineInterface

const RECORD = { plugin: 'context-keeper', key: 'record' } as const
const PENDING = { plugin: 'context-keeper', key: 'isPending' } as const

const MAX_DECISIONS = 15
const MAX_PRS = 10
const MAX_ITEMS = 30
const MAX_LINE = 240
const MAX_SCAN = 50_000
const MAX_SESSIONS = 40

const DECISION =
  /\b(always|never|don'?t|do not|we work in|use \S+(?: \S+)? (?:not|instead of) \S+)\b/i
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g

const empty = (): ContextKeeperRecord => ({ prs: [], items: [], decisions: [] })

const clip = (s: string) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s)

function pushNewest(list: string[], value: string, max: number): string[] {
  const out = list.filter(v => v !== value)
  out.push(value)
  return out.slice(-max)
}

/** The lines of a prompt that state a rule: "always", "never", "use X not Y". */
export function decisionsIn(text: string): string[] {
  const found: string[] = []
  for (const line of text.slice(0, MAX_SCAN).split(/\n|(?<=[.!?])\s+/)) {
    const s = line.trim().replace(/^[-*>\d.)\s]+/, '')
    if (s.length < 8 || s.startsWith('```')) continue
    if (DECISION.test(s)) found.push(clip(s))
    if (found.length >= MAX_DECISIONS) break
  }
  return found
}

/** The record as the block the summarizer keeps and the model reads. */
export function blockOf(r: ContextKeeperRecord): string {
  const lines = ['<context-keeper task-state>']
  if (r.repoRoot) lines.push(`repo: ${r.repoRoot}`)
  if (r.branch) lines.push(`branch: ${r.branch}`)
  if (r.worktree) lines.push(`worktree: ${r.worktree}`)
  if (r.prs.length > 0) lines.push(`PRs: ${r.prs.join(', ')}`)
  if (r.items.length > 0) {
    lines.push('plan:')
    for (const i of r.items) lines.push(`- [${i.status}] ${i.content}`)
  }
  if (r.decisions.length > 0) {
    lines.push("decisions (the person's own words):")
    for (const d of r.decisions) lines.push(`- ${d}`)
  }
  lines.push('</context-keeper>')
  return lines.join('\n')
}

const isEmpty = (r: ContextKeeperRecord) =>
  !r.repoRoot && !r.branch && !r.worktree && r.prs.length === 0 && r.items.length === 0 && r.decisions.length === 0

async function readRecord($: $): Promise<ContextKeeperRecord> {
  const { value } = await $.state.get(RECORD)
  return value ?? empty()
}

/** Writes the record to `$.state` and its copy to `$.store`, when it changed. */
async function writeRecord($: $, before: ContextKeeperRecord, after: ContextKeeperRecord) {
  if (JSON.stringify(before) === JSON.stringify(after)) return
  await $.state.set(RECORD, after)
  try {
    const id = await $.session.id()
    await $.store.set(`session:${id}`, after)
    const index = ((await $.store.get('index')) ?? []) as string[]
    const next = pushNewest(index, id, MAX_SESSIONS)
    if (next.length !== index.length || index[index.length - 1] !== id) {
      for (const old of index.filter(k => !next.includes(k))) await $.store.delete(`session:${old}`)
      await $.store.set('index', next)
    }
  } catch {
    // The copy is for resume; the live record still stands.
  }
}

function itemsFrom(list: unknown): ContextKeeperItem[] | undefined {
  if (!Array.isArray(list)) return undefined
  const out: ContextKeeperItem[] = []
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue
    const o = raw as Record<string, unknown>
    const content = typeof o.content === 'string' ? o.content : typeof o.subject === 'string' ? o.subject : undefined
    if (content === undefined) continue
    out.push({ content: clip(content), status: typeof o.status === 'string' ? o.status : 'pending' })
  }
  return out.slice(0, MAX_ITEMS)
}

/** Folds one finished tool call into the record: string work only. */
export function fold(
  r: ContextKeeperRecord,
  tool: string,
  input: Record<string, unknown>,
  text: string,
): ContextKeeperRecord {
  const out: ContextKeeperRecord = { ...r, prs: [...r.prs], items: [...r.items], decisions: [...r.decisions] }
  const scan = text.length > MAX_SCAN ? text.slice(0, MAX_SCAN) : text

  for (const url of scan.match(PR_URL) ?? []) out.prs = pushNewest(out.prs, url, MAX_PRS)

  if (tool === 'Bash' && typeof input.command === 'string') {
    const cmd = input.command
    const first = scan.split('\n')[0]?.trim() ?? ''
    if (/\bgit\b.*\brev-parse\b.*--show-toplevel\b/.test(cmd) && first.startsWith('/')) out.repoRoot = first
    if (/\bgit\b.*\bbranch\b.*--show-current\b/.test(cmd) && /^[\w./-]+$/.test(first)) out.branch = first
    const onBranch = /^On branch (\S+)/m.exec(scan)
    if (/\bgit\b.*\bstatus\b/.test(cmd) && onBranch?.[1]) out.branch = onBranch[1]
    const made = /\bgit\b.*\b(?:checkout\s+-[bB]|switch\s+-[cC])\s+(\S+)/.exec(cmd)
    if (made?.[1]) out.branch = made[1]
    const wt = /\bgit\b.*\bworktree\s+add\s+(?:-[bB]\s+(\S+)\s+)?("[^"]+"|\S+)(?:\s+-[bB]\s+(\S+))?/.exec(cmd)
    if (wt?.[2]) {
      out.worktree = wt[2].replace(/^"|"$/g, '')
      const br = wt[1] ?? wt[3]
      if (br) out.branch = br
    }
    const pr = /\bgh\s+pr\s+(?:view|checks|merge|edit|ready|review|comment|diff|checkout)\s+#?(\d+)\b/.exec(cmd)
    if (pr?.[1]) out.prs = pushNewest(out.prs, `#${pr[1]}`, MAX_PRS)
  }

  if (tool === 'EnterWorktree') {
    const path = /(\/[^\s'"`]*worktrees?\/[^\s'"`]+)/.exec(scan)
    if (path?.[1]) out.worktree = path[1].replace(/[.,;:]$/, '')
  }

  if (tool === 'TodoWrite') {
    const items = itemsFrom(input.todos)
    if (items) out.items = items
  }

  if (tool === 'TaskCreate' && typeof input.subject === 'string') {
    const id = /#(\d+)/.exec(scan)?.[1] ?? /\b(?:id|task)\D{0,3}(\d+)/i.exec(scan)?.[1]
    out.items = [...out.items.filter(i => i.id === undefined || i.id !== id), { content: clip(input.subject), status: 'pending', ...(id ? { id } : {}) }].slice(-MAX_ITEMS)
  }

  if (tool === 'TaskUpdate' && typeof input.taskId === 'string') {
    const id = input.taskId.replace(/^#/, '')
    out.items = out.items
      .map(i => (i.id === id ? { ...i, status: typeof input.status === 'string' ? input.status : i.status, content: typeof input.subject === 'string' ? clip(input.subject) : i.content } : i))
      .filter(i => i.status !== 'deleted')
  }

  if (/update_plan$/.test(tool)) {
    const items = itemsFrom(input.items)
    if (items) out.items = items
  }

  return out
}

/** Reads the repo facts once, for the compaction (not a hot path). */
async function refreshRepo($: $, r: ContextKeeperRecord): Promise<ContextKeeperRecord> {
  try {
    const cwd = await $.session.cwd()
    const top = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], { timeoutMs: 3_000 })
    if (top.exitCode !== 0) return r
    const br = await $.process.run(['git', '-C', cwd, 'branch', '--show-current'], { timeoutMs: 3_000 })
    const root = top.stdout.trim()
    const out = { ...r, repoRoot: root, branch: br.stdout.trim() || r.branch }
    if (cwd !== root || /\/worktrees?\//.test(root)) out.worktree = root
    return out
  } catch {
    return r
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'keep',
        description: 'context-keeper: show the task state, add a decision, or clear it.',
        argumentHint: 'show | add <decision> | clear',
      })
      const current = await readRecord($)
      if (isEmpty(current)) {
        const saved = await $.store.get(`session:${await $.session.id()}`)
        if (saved && typeof saved === 'object') await $.state.set(RECORD, { ...empty(), ...(saved as ContextKeeperRecord) })
      }
    } catch {
      // A missing command or copy never stops the session.
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      if (e.agentId !== undefined || ran.deny !== undefined || ran.isError === true) return ran
      const tool = String(e.tool)
      const text = ran.text ?? ''
      const isGitLike = tool === 'Bash' && /\b(git|gh)\b/.test(String((e as { command?: unknown }).command ?? ''))
      const isPlan = /^(TodoWrite|TaskCreate|TaskUpdate|EnterWorktree)$|update_plan$/.test(tool)
      if (!isGitLike && !isPlan && !text.includes('/pull/')) return ran
      const before = await readRecord($)
      await writeRecord($, before, fold(before, tool, e as unknown as Record<string, unknown>, text))
    } catch {
      // The record is best effort; the result goes on untouched.
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    let context = e.context
    try {
      if (e.command === undefined && e.isMeta !== true) {
        const before = await readRecord($)
        let after = before
        for (const d of decisionsIn(e.text)) after = { ...after, decisions: pushNewest(after.decisions, d, MAX_DECISIONS) }
        await writeRecord($, before, after)

        const { value: isPending } = await $.state.get(PENDING)
        if (isPending === true) {
          await $.state.set(PENDING, false)
          if (!isEmpty(after)) {
            context = [...(e.context ?? []), `The conversation was compacted. The task state before it:\n${blockOf(after)}`]
          }
        }
      }
    } catch {
      context = e.context
    }
    return next(context === e.context ? e : { ...e, context })
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined || e.trigger === 'precompute') return next(e)
    let instructions = e.instructions
    try {
      const before = await readRecord($)
      const r = await refreshRepo($, before)
      await writeRecord($, before, r)
      if (!isEmpty(r)) {
        const own = e.instructions?.trim()
        instructions = [
          own ? `${own}\n` : '',
          'Keep the task-state block below verbatim in the summary, under the heading "Task state".',
          'Keep every instruction the person gave in their own words (always / never / do not / use X not Y).',
          '',
          blockOf(r),
        ].join('\n').trim()
      }
    } catch {
      instructions = e.instructions
    }
    const result = await next(instructions === e.instructions ? e : { ...e, instructions })
    try {
      if (result.skip === undefined) await $.state.set(PENDING, true)
    } catch {
      // The block is still in the summary.
    }
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'keep' }, async ($, e) => {
    try {
      const args = e.args.trim()
      const sub = args.split(/\s+/)[0] || 'show'
      const before = await readRecord($)
      if (sub === 'add') {
        const line = clip(args.slice(3).trim())
        if (line === '') return { text: 'keep: write the decision after "add".', isTextDisplayOnly: true }
        await writeRecord($, before, { ...before, decisions: pushNewest(before.decisions, line, MAX_DECISIONS) })
        return { text: `keep: added "${line}".`, isTextDisplayOnly: true }
      }
      if (sub === 'clear') {
        await writeRecord($, before, empty())
        await $.state.set(PENDING, false)
        return { text: 'keep: the task state is clear.', isTextDisplayOnly: true }
      }
      if (sub !== 'show') return { text: 'keep: use show, add <decision> or clear.', isTextDisplayOnly: true }
      return { text: isEmpty(before) ? 'keep: no task state yet.' : blockOf(before), isTextDisplayOnly: true }
    } catch {
      return { text: 'keep: the task state could not be read.' }
    }
  })
}
