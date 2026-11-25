import type { EngineInterface, Register } from 'claude-code'

type $ = EngineInterface

/** What the guard knows of one repository, read with git (never changed). */
type Facts = {
  root: string
  branch: string
  defaultBranch: string
  isMainCheckout: boolean
  isDirty: boolean
  /** Commits on origin/<default> that HEAD lacks; undefined when unknown. */
  behind: number | undefined
  at: number
}

const FACTS_TTL_MS = 60_000
const FETCH_EVERY_MS = 10 * 60_000
const BEHIND_LIMIT = 20
const PROTECTED_BRANCHES = ['main', 'master', 'dev', 'develop']
const RULE_FILES = ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md']

const dirname = (p: string) => {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

async function git($: $, dir: string, args: string[], timeoutMs = 5_000) {
  const r = await $.process.run(['git', '-C', dir, ...args], { timeoutMs })
  return { ok: r.exitCode === 0, out: r.stdout.trim() }
}

// Module memory: lost at a reload, which only means a warning may repeat.
const factsCache = new Map<string, Facts>()
const rootOfDir = new Map<string, { root: string | null; at: number }>()
const lastFetch = new Map<string, number>()
const ruleCache = new Map<string, { line: string | null; at: number }>()
const warned = new Set<string>()
const checkedThisTurn = new Set<string>()
const mem: { pendingPromptWarning: string | undefined; isOff: boolean } = { pendingPromptWarning: undefined, isOff: false }

async function rootOf($: $, dir: string): Promise<string | null> {
  const now = await $.clock.now()
  const hit = rootOfDir.get(dir)
  if (hit && now - hit.at < FACTS_TTL_MS) return hit.root
  const r = await git($, dir, ['rev-parse', '--show-toplevel'])
  const root = r.ok && r.out !== '' ? r.out : null
  rootOfDir.set(dir, { root, at: now })
  return root
}

async function defaultBranchOf($: $, root: string): Promise<string> {
  const head = await git($, root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (head.ok && head.out.startsWith('origin/')) return head.out.slice('origin/'.length)
  for (const b of ['main', 'master', 'dev']) {
    const r = await git($, root, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${b}`])
    if (r.ok) return b
  }
  return 'main'
}

async function maybeFetch($: $, root: string) {
  const now = await $.clock.now()
  let last = lastFetch.get(root)
  if (last === undefined) {
    const stored = await $.store.get(`fetch:${root}`)
    last = typeof stored === 'number' ? stored : 0
  }
  if (now - last < FETCH_EVERY_MS) return
  lastFetch.set(root, now)
  await $.store.set(`fetch:${root}`, now)
  // The one network call: a plain fetch, which merges nothing.
  await git($, root, ['fetch', '-q', 'origin'], 20_000).catch(() => undefined)
}

async function factsOf($: $, dir: string): Promise<Facts | null> {
  const root = await rootOf($, dir)
  if (root === null) return null
  const now = await $.clock.now()
  const hit = factsCache.get(root)
  if (hit && now - hit.at < FACTS_TTL_MS) return hit

  await maybeFetch($, root)
  const branch = (await git($, root, ['branch', '--show-current'])).out
  const defaultBranch = await defaultBranchOf($, root)
  const dirs = await git($, root, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'])
  const [gitDir, commonDir] = dirs.out.split('\n')
  const isMainCheckout = gitDir !== undefined && gitDir === commonDir
  const isDirty = (await git($, root, ['status', '--porcelain', '--untracked-files=no'])).out !== ''
  const count = await git($, root, ['rev-list', '--left-right', '--count', `HEAD...origin/${defaultBranch}`])
  const behindText = count.ok ? count.out.split(/\s+/)[1] : undefined
  const behind = behindText !== undefined && /^\d+$/.test(behindText) ? Number(behindText) : undefined

  const facts: Facts = { root, branch, defaultBranch, isMainCheckout, isDirty, behind, at: now }
  factsCache.set(root, facts)
  return facts
}

function warningFor(f: Facts): string | undefined {
  const name = f.root.split('/').pop() ?? f.root
  if (f.behind !== undefined && f.behind > BEHIND_LIMIT) {
    return `repo-guard: ${name} branch ${f.branch || '(detached)'} is ${f.behind} commits behind origin/${f.defaultBranch}; rebase or merge ${f.defaultBranch} before more edits.`
  }
  if (f.isMainCheckout && f.branch === f.defaultBranch && f.isDirty) {
    return `repo-guard: ${name} is the main checkout on ${f.defaultBranch} with uncommitted changes; make a branch or worktree before more edits.`
  }
  return undefined
}

/** The warning for `dir`, once per repo per session; undefined otherwise. */
async function warnOnce($: $, dir: string): Promise<string | undefined> {
  const f = await factsOf($, dir)
  if (f === null || warned.has(f.root)) return undefined
  const w = warningFor(f)
  if (w !== undefined) warned.add(f.root)
  return w
}

async function ruleLine($: $, root: string): Promise<string | null> {
  const now = await $.clock.now()
  const hit = ruleCache.get(root)
  if (hit && now - hit.at < FACTS_TTL_MS) return hit.line
  let line: string | null = null
  for (const file of RULE_FILES) {
    try {
      const text = await $.fs.read(`${root}/${file}`)
      const found = text.split('\n').find(l => /agent-branded/i.test(l))
      if (found !== undefined) {
        line = `${file}: ${found.trim()}`
        break
      }
    } catch {
      // No such file.
    }
  }
  ruleCache.set(root, { line, at: now })
  return line
}

/** Why this Bash command must not run, or undefined. */
async function judgeBash($: $, command: string, cwd: string): Promise<string | undefined> {
  if (!/\bgit\b/.test(command)) return undefined
  let dir = cwd
  let madeBranch = false
  for (const raw of command.split(/&&|\|\||;|\n|\|/)) {
    const seg = raw.trim()
    const cd = /^cd\s+("[^"]+"|'[^']+'|\S+)/.exec(seg)
    if (cd?.[1]) {
      const target = cd[1].replace(/^["']|["']$/g, '')
      dir = target.startsWith('/') ? target : `${dir}/${target}`
      continue
    }
    const m = /^(?:\S+=\S+\s+)*git\s+((?:-C\s+("[^"]+"|'[^']+'|\S+)\s+|-c\s+\S+\s+)*)(\S+)(.*)$/.exec(seg)
    if (!m) continue
    const cDir = m[2]?.replace(/^["']|["']$/g, '')
    const segDir = cDir === undefined ? dir : cDir.startsWith('/') ? cDir : `${dir}/${cDir}`
    const sub = m[3] ?? ''
    const rest = m[4] ?? ''
    if ((sub === 'checkout' && /\s-[bB]\s/.test(`${rest} `)) || (sub === 'switch' && /\s-[cC]\s/.test(`${rest} `)) || sub === 'worktree') {
      madeBranch = true
      continue
    }
    if (sub === 'commit' && !madeBranch) {
      const root = await rootOf($, segDir)
      if (root === null) continue
      const branch = (await git($, root, ['branch', '--show-current'])).out
      if (branch === '') continue
      const f = await factsOf($, root)
      if (branch === f?.defaultBranch || PROTECTED_BRANCHES.includes(branch)) {
        return `repo-guard: do not commit on ${branch}; create a branch first`
      }
    }
    if (sub === 'push') {
      const words = rest.trim().split(/\s+/).filter(w => w !== '')
      const positional = words.filter(w => !w.startsWith('-'))
      let ref = positional[1]
      const root = await rootOf($, segDir)
      if (root === null) continue
      if (ref === undefined || ref.split(':')[0] === 'HEAD') {
        ref = (await git($, root, ['branch', '--show-current'])).out
      }
      const src = (ref.split(':')[0] ?? '').replace(/^\+/, '').replace(/^refs\/heads\//, '')
      const dst = (ref.split(':')[1] ?? '').replace(/^refs\/heads\//, '')
      if (!src.startsWith('claude/') && !dst.startsWith('claude/')) continue
      const rule = await ruleLine($, root)
      if (rule !== null) {
        return `repo-guard: this repo forbids agent-branded branch names; rename the branch before the push. Rule: ${rule}`
      }
    }
  }
  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      mem.isOff = (await $.store.get('off')) === true
      await $.command.register({
        name: 'repo-guard',
        description: 'repo-guard: status shows the repo facts; off and on switch the guard.',
        argumentHint: 'status|off|on',
      })
      if (!mem.isOff) mem.pendingPromptWarning = await warnOnce($, e.cwd)
    } catch {
      // Never stop a session from starting.
    }
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) checkedThisTurn.clear()
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (mem.pendingPromptWarning === undefined || e.command !== undefined || e.isMeta) return next(e)
    const w = mem.pendingPromptWarning
    mem.pendingPromptWarning = undefined
    return next({ ...e, context: [...(e.context ?? []), w] })
  }).catch(($, e, next) => next(e))

  // Edits: never blocked; the warning rides on the first edit's result.
  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    let warning: string | undefined
    try {
      const path = 'file_path' in e && typeof e.file_path === 'string'
        ? e.file_path
        : 'notebook_path' in e && typeof e.notebook_path === 'string' ? e.notebook_path : undefined
      if (!mem.isOff && path !== undefined && path.startsWith('/')) {
        const dir = dirname(path)
        const root = await rootOf($, dir)
        if (root !== null && !checkedThisTurn.has(root)) {
          checkedThisTurn.add(root)
          warning = await warnOnce($, dir)
        }
      }
    } catch {
      warning = undefined
    }
    const ran = await next(e)
    if (warning === undefined || ran.deny !== undefined) return ran
    return { ...ran, context: [...(ran.context ?? []), warning] }
  }).catch(($, e, next) => next(e))

  // Commits and pushes: the one place the guard refuses.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (mem.isOff) return next(e)
    const reason = await judgeBash($, e.command, await $.session.cwd())
    return reason === undefined ? next(e) : { deny: reason }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'repo-guard' }, async ($, e) => {
    try {
      const sub = e.args.trim().split(/\s+/)[0] || 'status'
      if (sub === 'off' || sub === 'on') {
        mem.isOff = sub === 'off'
        await $.store.set('off', mem.isOff)
        return { text: `repo-guard is ${mem.isOff ? 'off' : 'on'}.`, isTextDisplayOnly: true }
      }
      if (sub !== 'status') return { text: 'repo-guard: use status, off or on.', isTextDisplayOnly: true }
      const f = await factsOf($, await $.session.cwd())
      if (f === null) return { text: `repo-guard is ${mem.isOff ? 'off' : 'on'}; the session directory is not in a git repo.`, isTextDisplayOnly: true }
      const lines = [
        `repo-guard is ${mem.isOff ? 'off' : 'on'}.`,
        `repo: ${f.root}`,
        `branch: ${f.branch || '(detached)'} (default ${f.defaultBranch})`,
        `behind origin/${f.defaultBranch}: ${f.behind ?? 'unknown'}`,
        `main checkout: ${f.isMainCheckout ? 'yes' : 'no'}; uncommitted changes: ${f.isDirty ? 'yes' : 'no'}`,
        warningFor(f) ?? 'No warning.',
      ]
      return { text: lines.join('\n'), isTextDisplayOnly: true }
    } catch {
      return { text: 'repo-guard: the status could not be read.' }
    }
  })
}
