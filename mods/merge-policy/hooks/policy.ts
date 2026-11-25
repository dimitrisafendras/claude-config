// Pure logic of merge-policy: the command parser, the rule-file validator and
// the condition check. No `$` here, so every rule is easy to test and read.
//
// Fail closed: every function answers `undefined` (or an error) on any doubt,
// and the hook then asks a person. Only a fully understood command for a
// configured repo can reach `allow`.

export type Method = 'merge' | 'squash' | 'rebase'

export type RepoRule = {
  method: readonly Method[]
  admin: boolean
  requireApproval: boolean
}

export type Rules = {
  repos: Readonly<Record<string, RepoRule>>
  requireGreen: boolean
  allowAdmin: boolean
}

export type MergeCommand = {
  /** Absolute directory of a leading `cd <dir> &&`, `~` expanded. */
  cdDir?: string
  /** `owner/repo` from `-R/--repo` or from the PR URL. */
  repo?: string
  pr: number
  method?: Method
  admin: boolean
  deleteBranch: boolean
  auto: boolean
}

export type CheckEntry = Record<string, unknown>

/**
 * A `tool.check` answer that only a person can approve (Claude Code 2.1.304):
 * the permission dialog or a host's callback, never the auto-mode classifier.
 * Where nobody can be asked the engine refuses the call with `reason`.
 *
 * Later builds make every ask of a hook a person's ask and read no `decider`,
 * so the field does no harm there and keeps the answer the same on each build
 * from 2.1.304.
 */
export function personAsk(reason: string): { decision: 'ask'; reason: string; decider: 'person' } {
  return { decision: 'ask', reason, decider: 'person' }
}

export type PrView = {
  state: string
  isDraft: boolean
  mergeable: string
  mergeStateStatus: string
  reviewDecision: string
  statusCheckRollup: readonly CheckEntry[]
  baseRefName: string
  headRefName: string
}

const METHODS: readonly Method[] = ['merge', 'squash', 'rebase']
const OWNER_REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/
const PR_NUMBER = /^[1-9][0-9]{0,9}$/
const PR_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/pull\/([1-9][0-9]{0,9})\/?$/
// A gh argument token: no quotes, no shell metacharacters, no `=`, `~` or `#`.
const ARG_TOKEN = /^[A-Za-z0-9._\/:-]+$/
// The leading `cd <dir> &&`. The directory is unquoted (safe characters, `~`
// only as a leading `~` or `~/`), or single or double quoted with safe
// characters and spaces only (no `$`, backtick, backslash, quote or `~`).
const CD_PREFIX =
  /^cd[ \t]+(?:'([A-Za-z0-9._\/+@,: -]+)'|"([A-Za-z0-9._\/+@,: -]+)"|(~|~\/[A-Za-z0-9._\/+@,:-]*|[A-Za-z0-9._\/+@,:-]+))[ \t]*&&[ \t]*/
const GH_PR_MERGE = /^gh[ \t]+pr[ \t]+merge(?=[ \t]|$)/

function isBadRepoName(repo: string): boolean {
  const name = repo.split('/')[1] ?? ''
  return name === '.' || name === '..'
}

/**
 * Parses one Bash command as a single `gh pr merge`, optionally after
 * `cd <dir> &&`. Answers `undefined` for every other shape: pipes, `;`, `&&`
 * with other commands, `$(...)`, backticks, env assignments, redirections,
 * quotes in the gh arguments, flags not on the list, a missing PR number or
 * URL, or a repo that cannot be known without the shell's own cwd.
 */
/** An absolute path: POSIX (`/…`) or a Windows drive with forward slashes (`C:/…`). Nothing else. */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:\//.test(p)
}

export function parseMergeCommand(
  command: string,
  home: string | undefined,
): MergeCommand | undefined {
  if (/[\r\n\0]/.test(command)) return undefined
  let rest = command.replace(/^[ \t]+|[ \t]+$/g, '')

  let cdDir: string | undefined
  const cd = CD_PREFIX.exec(rest)
  if (cd) {
    const quoted = cd[1] ?? cd[2]
    const bare = cd[3]
    if (quoted !== undefined) cdDir = quoted
    else if (bare !== undefined) {
      if (bare === '~' || bare.startsWith('~/')) {
        if (home === undefined || !isAbsolutePath(home)) return undefined
        cdDir = home.replace(/\/+$/, '') + bare.slice(1)
      } else if (bare.includes('~')) return undefined
      else cdDir = bare
    }
    if (cdDir === undefined || !isAbsolutePath(cdDir)) return undefined
    rest = rest.slice(cd[0].length)
  } else if (/^cd[ \t]/.test(rest)) {
    return undefined
  }

  const gh = GH_PR_MERGE.exec(rest)
  if (!gh) return undefined
  const argText = rest.slice(gh[0].length).replace(/^[ \t]+/, '')
  const tokens = argText === '' ? [] : argText.split(/[ \t]+/)

  let repo: string | undefined
  let urlRepo: string | undefined
  let pr: number | undefined
  let method: Method | undefined
  let admin = false
  let deleteBranch = false
  let auto = false

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? ''
    if (!ARG_TOKEN.test(t)) return undefined
    if (t === '-R' || t === '--repo') {
      const value = tokens[i + 1]
      if (repo !== undefined || value === undefined) return undefined
      if (!OWNER_REPO.test(value) || isBadRepoName(value)) return undefined
      repo = value
      i++
    } else if (t === '--merge' || t === '--squash' || t === '--rebase') {
      if (method !== undefined) return undefined
      method = t.slice(2) as Method
    } else if (t === '--admin') {
      if (admin) return undefined
      admin = true
    } else if (t === '--delete-branch') {
      if (deleteBranch) return undefined
      deleteBranch = true
    } else if (t === '--auto') {
      if (auto) return undefined
      auto = true
    } else if (t.startsWith('-')) {
      return undefined
    } else {
      if (pr !== undefined) return undefined
      if (PR_NUMBER.test(t)) pr = Number(t)
      else {
        const url = PR_URL.exec(t)
        if (!url) return undefined
        urlRepo = `${url[1]}/${url[2]}`
        if (isBadRepoName(urlRepo)) return undefined
        pr = Number(url[3])
      }
    }
  }

  if (pr === undefined || !Number.isSafeInteger(pr)) return undefined
  if (repo !== undefined && urlRepo !== undefined && repo.toLowerCase() !== urlRepo.toLowerCase()) {
    return undefined
  }
  const knownRepo = repo ?? urlRepo
  // Without -R or a URL, the repo comes from `gh repo view` in the cd dir.
  // Without a cd dir the repo would depend on the shell's cwd: pass through.
  if (knownRepo === undefined && cdDir === undefined) return undefined

  return {
    ...(cdDir !== undefined ? { cdDir } : {}),
    ...(knownRepo !== undefined ? { repo: knownRepo } : {}),
    pr,
    ...(method !== undefined ? { method } : {}),
    admin,
    deleteBranch,
    auto,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(k => keys.includes(k))
}

/** Validates the rule file's shape strictly; answers the rules or why not. */
export function validateRules(raw: unknown): { rules: Rules } | { error: string } {
  if (!isRecord(raw)) return { error: 'the file is not a JSON object' }
  if (!hasOnlyKeys(raw, ['repos', 'requireGreen', 'allowAdmin'])) {
    return { error: 'unknown top-level key (allowed: repos, requireGreen, allowAdmin)' }
  }
  if (typeof raw.requireGreen !== 'boolean') return { error: 'requireGreen must be true or false' }
  if (typeof raw.allowAdmin !== 'boolean') return { error: 'allowAdmin must be true or false' }
  if (!isRecord(raw.repos)) return { error: 'repos must be an object keyed owner/repo' }

  const repos: Record<string, RepoRule> = {}
  const seen = new Set<string>()
  for (const [key, value] of Object.entries(raw.repos)) {
    if (!OWNER_REPO.test(key) || isBadRepoName(key)) return { error: `repo key "${key}" is not owner/repo` }
    const lower = key.toLowerCase()
    if (seen.has(lower)) return { error: `repo "${key}" is listed twice` }
    seen.add(lower)
    if (!isRecord(value)) return { error: `${key}: the rule must be an object` }
    if (!hasOnlyKeys(value, ['method', 'admin', 'requireApproval'])) {
      return { error: `${key}: unknown key (allowed: method, admin, requireApproval)` }
    }
    const method = value.method
    if (
      !Array.isArray(method) ||
      method.length === 0 ||
      !method.every(m => typeof m === 'string' && (METHODS as readonly string[]).includes(m)) ||
      new Set(method).size !== method.length
    ) {
      return { error: `${key}: method must be a non-empty list of merge, squash, rebase` }
    }
    if (typeof value.admin !== 'boolean') return { error: `${key}: admin must be true or false` }
    if (typeof value.requireApproval !== 'boolean') {
      return { error: `${key}: requireApproval must be true or false` }
    }
    repos[key] = {
      method: method as Method[],
      admin: value.admin,
      requireApproval: value.requireApproval,
    }
  }
  return {
    rules: { repos, requireGreen: raw.requireGreen, allowAdmin: raw.allowAdmin },
  }
}

/** Finds the rule for a repo, case-insensitively; answers the key as written. */
export function findRule(
  rules: Rules,
  repo: string,
): { key: string; rule: RepoRule } | undefined {
  const lower = repo.toLowerCase()
  for (const [key, rule] of Object.entries(rules.repos)) {
    if (key.toLowerCase() === lower) return { key, rule }
  }
  return undefined
}

/** Parses `gh pr view --json ...` output; throws on any unexpected shape. */
export function parsePrView(stdout: string): PrView {
  const raw: unknown = JSON.parse(stdout)
  if (!isRecord(raw)) throw new Error('gh pr view: not an object')
  const str = (k: string): string => {
    const v = raw[k]
    if (typeof v !== 'string') throw new Error(`gh pr view: ${k} is not a string`)
    return v
  }
  if (typeof raw.isDraft !== 'boolean') throw new Error('gh pr view: isDraft is not a boolean')
  const rollup = raw.statusCheckRollup ?? []
  if (!Array.isArray(rollup) || !rollup.every(isRecord)) {
    throw new Error('gh pr view: statusCheckRollup is not a list')
  }
  return {
    state: str('state'),
    isDraft: raw.isDraft,
    mergeable: str('mergeable'),
    mergeStateStatus: str('mergeStateStatus'),
    reviewDecision: raw.reviewDecision == null ? '' : str('reviewDecision'),
    statusCheckRollup: rollup,
    baseRefName: str('baseRefName'),
    headRefName: str('headRefName'),
  }
}

const GREEN_CONCLUSIONS = ['SUCCESS', 'NEUTRAL', 'SKIPPED']

/** Names every check that is not green: pending, failed or of unknown kind. */
export function notGreenChecks(rollup: readonly CheckEntry[]): string[] {
  const bad: string[] = []
  for (const c of rollup) {
    if (c.__typename === 'CheckRun') {
      const name = typeof c.name === 'string' ? c.name : '(unnamed check)'
      if (c.status !== 'COMPLETED') bad.push(`${name} ${String(c.status ?? 'PENDING')}`)
      else if (!GREEN_CONCLUSIONS.includes(String(c.conclusion))) {
        bad.push(`${name} ${String(c.conclusion ?? 'NO_CONCLUSION')}`)
      }
    } else if (c.__typename === 'StatusContext') {
      const name = typeof c.context === 'string' ? c.context : '(unnamed status)'
      if (c.state !== 'SUCCESS') bad.push(`${name} ${String(c.state ?? 'PENDING')}`)
    } else {
      bad.push(`unknown check kind ${String(c.__typename)}`)
    }
  }
  return bad
}

/**
 * The allow conditions. Answers every condition that fails; an empty list
 * means allow. `ignoreMethod` is for the dry run with no method flag.
 */
export function failedConditions(
  rules: Rules,
  rule: RepoRule,
  cmd: MergeCommand,
  pr: PrView,
  options: { ignoreMethod?: boolean } = {},
): string[] {
  const failed: string[] = []
  if (pr.state !== 'OPEN') failed.push(`state is ${pr.state}, not OPEN`)
  if (pr.isDraft) failed.push('PR is a draft')
  if (pr.mergeable !== 'MERGEABLE') failed.push(`mergeable is ${pr.mergeable}, not MERGEABLE`)
  if (rules.requireGreen) {
    if (pr.statusCheckRollup.length === 0) {
      // Fail closed: no checks can also mean they did not start yet.
      failed.push('no checks reported (requireGreen)')
    } else {
      const bad = notGreenChecks(pr.statusCheckRollup)
      if (bad.length > 0) failed.push(`checks not green: ${bad.join(', ')}`)
    }
  }
  if (rule.requireApproval && pr.reviewDecision !== 'APPROVED') {
    failed.push(`reviewDecision is ${pr.reviewDecision || 'none'}, not APPROVED`)
  }
  const allowed = rule.method.map(m => `--${m}`).join(', ')
  if (cmd.method === undefined) {
    if (!options.ignoreMethod) failed.push(`no merge method flag (allowed: ${allowed})`)
  } else if (!rule.method.includes(cmd.method)) {
    failed.push(`--${cmd.method} not allowed (allowed: ${allowed})`)
  }
  if (cmd.admin && !(rules.allowAdmin && rule.admin)) {
    failed.push('--admin not allowed (needs allowAdmin and the repo admin both true)')
  }
  return failed
}
