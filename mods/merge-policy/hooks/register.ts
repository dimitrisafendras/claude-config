// merge-policy: answers permission checks (`tool.check`) for PR merges.
//
// It grants permission, so it is narrow, deterministic and fails closed:
// - Only a single `gh pr merge` command (optionally after `cd <dir> &&`) with
//   a short list of flags can get `allow` or `deny` from the rule file.
// - A command with no `gh pr merge` in it passes through with `next(e)`: this
//   mod never allows, never denies and never asks about it.
// - Without ~/.claude/merge-policy.json the mod is inert: it writes nothing
//   and passes every check through.
// - With a rule file, every other `gh pr merge` needs a person: a repo that
//   is not in the file, a command shape that is not on the list, a bad rule
//   file, or an error (gh fails, bad JSON, a timeout past 15 s). Where the
//   verdict beneath is `ask`, the mod answers `ask` with `decider: "person"`
//   (Claude Code 2.1.304): only the permission dialog or a host's callback can
//   approve, so the auto-mode classifier cannot approve a merge alone, and
//   where nobody can be asked the call is refused with the mod's reason.
//   Doubt never becomes `allow`.
// - An `allow` beneath (the person's own allow rule, a mode that allows all)
//   and a `deny` beneath (a deny rule, a PreToolUse hook) stand as they are.
//
// What the types (claude-code.d.ts, ToolCheckResult and ToolCheckInput) say a
// hook's `allow` does NOT do:
// - For a tool that requires the person (a question put to them, a plan to
//   approve) a hook only tightens: its `allow` does not dismiss the dialog.
// - In plan mode a hook only tightens a call not shown to be a read. A merge
//   is a write, so in plan mode this `allow` does not let it run.
// - The organization's `ceiling` caps every verdict for the tool: the engine
//   sets it, a hook's own `ceiling` is dropped, and an `allow` above the
//   ceiling is held to it.
// - Plugins in a managed (organization) seat sit above this one and answer
//   after it: "the last word up the chain is the decision".
// - A failed hook is skipped and the verdict beneath stands (the `.catch`
//   below says the same on purpose): failure is never an `allow`.

import type { EngineInterface, Register } from 'claude-code'
import {
  failedConditions,
  findRule,
  parseMergeCommand,
  parsePrView,
  validateRules,
  personAsk,
  type MergeCommand,
  type Rules,
} from './policy.js'

const RULE_FILE = '.claude/merge-policy.json'
const LOG_KEY = 'decisions'
const LOG_LIMIT = 100
const GH_TIMEOUT_MS = 15_000
const PR_FIELDS =
  'state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,baseRefName,headRefName'

type $ = EngineInterface

type Decision = 'allow' | 'deny' | 'ask'

type LogEntry = {
  time: string
  repo: string
  pr: number
  decision: Decision
  reason: string
}

type Verdict =
  | { kind: 'pass'; why: string }
  // A merge that the rule file does not settle: a person must approve it.
  | { kind: 'ask'; why: string; repo?: string; pr?: number }
  | { kind: 'allow' | 'deny'; repo: string; pr: number; reason: string }

type RulesLoad =
  | { kind: 'missing'; path?: string }
  | { kind: 'bad'; path: string; error: string }
  | { kind: 'ok'; path: string; rules: Rules }

// One toast per distinct problem per load of the module.
const toasted = new Set<string>()

async function rulePath($: $): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  if (home === undefined || !home.startsWith('/')) return undefined
  return `${home.replace(/\/+$/, '')}/${RULE_FILE}`
}

/** Reads the rule file on every check, so an edit applies at once. */
async function loadRules($: $, options: { toast: boolean }): Promise<RulesLoad> {
  const path = await rulePath($)
  if (path === undefined) return { kind: 'missing' }
  let exists: boolean
  try {
    exists = await $.fs.exists(path)
  } catch {
    exists = false
  }
  if (!exists) return { kind: 'missing', path }

  let error: string
  try {
    const checked = validateRules(JSON.parse(await $.fs.read(path)))
    if ('rules' in checked) return { kind: 'ok', path, rules: checked.rules }
    error = checked.error
  } catch (err) {
    error = err instanceof SyntaxError ? 'not valid JSON' : 'cannot read the file'
  }
  if (options.toast && !toasted.has(error)) {
    toasted.add(error)
    $.ui.toast('merge-policy: bad rule file')
  }
  return { kind: 'bad', path, error }
}

async function gh($: $, argv: readonly string[], cwd?: string): Promise<string> {
  const run = await $.process.run(['gh', ...argv], {
    timeoutMs: GH_TIMEOUT_MS,
    ...(cwd !== undefined ? { cwd } : {}),
  })
  if (run.exitCode !== 0) throw new Error(`gh exited ${run.exitCode}`)
  if (run.isStdoutTruncated) throw new Error('gh output was cut')
  return run.stdout
}

async function resolveRepo($: $, cmd: MergeCommand): Promise<string> {
  if (cmd.repo !== undefined) return cmd.repo
  if (cmd.cdDir === undefined) throw new Error('no repo')
  const out: unknown = JSON.parse(await gh($, ['repo', 'view', '--json', 'nameWithOwner'], cmd.cdDir))
  const name =
    typeof out === 'object' && out !== null ? (out as { nameWithOwner?: unknown }).nameWithOwner : undefined
  if (typeof name !== 'string' || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error('gh repo view: no nameWithOwner')
  }
  return name
}

/**
 * Decides one command. Shared by the hook and the `/merge-policy test` dry
 * run. Runs only read-only gh commands (`gh repo view`, `gh pr view`).
 */
async function judge(
  $: $,
  command: string,
  options: { toast: boolean; dryRun: boolean },
): Promise<Verdict> {
  // Cheap first gate: most Bash commands never reach the file system.
  if (!/\bgh[ \t]+pr[ \t]+merge\b/.test(command)) return { kind: 'pass', why: 'not a gh pr merge command' }

  // No rule file: inert. From here on, no doubt passes through.
  const load = await loadRules($, { toast: options.toast })
  if (load.kind === 'missing') return { kind: 'pass', why: 'no rule file' }
  if (load.kind === 'bad') return { kind: 'ask', why: `bad rule file: ${load.error}` }

  const cmd = parseMergeCommand(command, await $.env.get('HOME'))
  if (cmd === undefined) return { kind: 'ask', why: 'the command shape is not on the allowed list' }

  let repo: string
  try {
    repo = await resolveRepo($, cmd)
  } catch {
    return { kind: 'ask', why: 'cannot resolve the repo', pr: cmd.pr }
  }
  const found = findRule(load.rules, repo)
  if (found === undefined) return { kind: 'ask', why: `${repo} is not in the rule file`, repo, pr: cmd.pr }

  let view
  try {
    view = parsePrView(
      await gh($, ['pr', 'view', String(cmd.pr), '-R', found.key, '--json', PR_FIELDS]),
    )
  } catch {
    return { kind: 'ask', why: 'gh pr view failed', repo: found.key, pr: cmd.pr }
  }

  const failed = failedConditions(load.rules, found.rule, cmd, view, {
    ignoreMethod: options.dryRun && cmd.method === undefined,
  })
  const ref = `${found.key}#${cmd.pr}`
  return failed.length === 0
    ? { kind: 'allow', repo: found.key, pr: cmd.pr, reason: `merge-policy: ${ref} green, mergeable, rule ${found.key}` }
    : { kind: 'deny', repo: found.key, pr: cmd.pr, reason: `merge-policy: ${ref} not merged: ${failed.join('; ')}` }
}

async function log($: $, entry: Omit<LogEntry, 'time'>): Promise<void> {
  try {
    const now = await $.clock.now()
    const old = await $.store.get(LOG_KEY)
    const list = Array.isArray(old) ? (old as LogEntry[]) : []
    const next = [...list, { time: new Date(now).toISOString(), ...entry }].slice(-LOG_LIMIT)
    await $.store.set(LOG_KEY, next)
  } catch {
    // The log is for reading only: a store failure never changes a decision.
  }
}

async function recentDecisions($: $, count: number): Promise<LogEntry[]> {
  try {
    const old = await $.store.get(LOG_KEY)
    return Array.isArray(old) ? (old as LogEntry[]).slice(-count) : []
  } catch {
    return []
  }
}

function commandOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const command = (input as { command?: unknown }).command
  return typeof command === 'string' ? command : undefined
}

async function statusText($: $): Promise<string> {
  const load = await loadRules($, { toast: false })
  const path = load.path ?? `~/${RULE_FILE}`
  const lines = [`merge-policy rule file: ${path}`]
  if (load.kind === 'missing') lines.push('State: no rule file. The mod is inert (every check passes through).')
  else if (load.kind === 'bad') lines.push(`State: bad rule file (${load.error}). Every \`gh pr merge\` needs a person.`)
  else {
    const { rules } = load
    lines.push(`State: active. requireGreen=${rules.requireGreen}, allowAdmin=${rules.allowAdmin}`)
    const repos = Object.entries(rules.repos)
    if (repos.length === 0) lines.push('Repos: none')
    for (const [key, r] of repos) {
      lines.push(`- ${key}: method ${r.method.join('/')}, admin ${r.admin}, requireApproval ${r.requireApproval}`)
    }
  }
  const last = await recentDecisions($, 10)
  lines.push(last.length === 0 ? 'Last decisions: none' : 'Last decisions:')
  for (const d of last) lines.push(`- ${d.time} ${d.repo}#${d.pr} ${d.decision}: ${d.reason}`)
  return lines.join('\n')
}

async function testText($: $, args: string): Promise<string> {
  const rest = args.trim()
  if (rest === '') return 'Usage: /merge-policy test <pr-url> [--merge|--squash|--rebase] [--admin] [-R owner/repo]'
  const command = `gh pr merge ${rest}`
  const v = await judge($, command, { toast: false, dryRun: true })
  const head = `Dry run (nothing is merged): ${command}`
  if (v.kind === 'pass') return `${head}\nWould pass through to the normal decider: ${v.why}.`
  if (v.kind === 'ask') return `${head}\nWould ask a person (auto mode cannot approve it): ${v.why}.`
  const note =
    v.kind === 'allow' && parseMergeCommand(command, await $.env.get('HOME'))?.method === undefined
      ? '\nNote: give a method flag allowed by the rule, or the real check denies.'
      : ''
  return `${head}\nWould ${v.kind}: ${v.reason}${note}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'merge-policy',
        description: 'merge-policy: show the rules and last decisions, or dry-run a PR merge check',
        argumentHint: 'status | test <pr-url> [flags]',
      })
    } catch {
      // Without the command the hook still works.
    }
    return next(e)
  })

  on('command.run', { command: 'merge-policy' }, async ($, e) => {
    const [sub = 'status', ...rest] = e.args.trim().split(/\s+/)
    if (sub === 'status' || sub === '') return { text: await statusText($) }
    if (sub === 'test') return { text: await testText($, rest.join(' ')) }
    return { text: 'Usage: /merge-policy status | /merge-policy test <pr-url> [flags]' }
  })

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const command = commandOf(e.input)
    if (command === undefined) return next(e)

    const v = await judge($, command, { toast: true, dryRun: false })
    if (v.kind === 'pass') return next(e)

    const below = await next(e)
    if (v.kind === 'ask') {
      // Only an ask changes hands: an allow and a deny beneath stand.
      if (below.decision !== 'ask') return below
      const reason = `merge-policy: ${v.why}. A person must approve this merge.`
      if (v.repo !== undefined && v.pr !== undefined) {
        await log($, { repo: v.repo, pr: v.pr, decision: 'ask', reason })
      }
      return personAsk(reason)
    }
    if (below.decision === 'deny' && v.kind === 'allow') {
      // Never weaken a deny from a rule or a hook beneath.
      await log($, { repo: v.repo, pr: v.pr, decision: 'deny', reason: `kept the deny beneath: ${below.reason ?? 'no reason'}` })
      return below
    }
    await log($, { repo: v.repo, pr: v.pr, decision: v.kind, reason: v.reason })
    return { decision: v.kind, reason: v.reason }
  }).catch(($, e, next) => next(e))
}
