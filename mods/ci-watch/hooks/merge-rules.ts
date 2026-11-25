// Pure logic of the ci-watch auto-merge: may ci-watch merge this green PR by itself?
// No `$` here, so every rule is easy to test and read.
//
// The rule file is the one of the merge-policy mod (~/.claude/merge-policy.json). A mod cannot
// import a file outside its own folder, so `validateRules`, `findRule` and `notGreenChecks` are
// copies of the functions in mods/merge-policy/hooks/policy.ts. Keep them the same: change both,
// never make this copy weaker. merge-policy still answers the permission check of the real
// `gh pr merge` call, so this check is a second gate in front of it, never a replacement.
//
// Fail closed: any doubt (no rule file, a bad file, a field gh did not give) is a hold.

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

/** The merge-policy rule file as ci-watch read it. */
export type PolicyLoad = { kind: 'missing' } | { kind: 'bad'; error: string } | { kind: 'ok'; rules: Rules }

export type CheckEntry = Record<string, unknown>

/** The fields of `gh pr view --json` that the decision reads. */
export type MergePr = {
  state?: string
  isDraft?: boolean
  mergeable?: string
  mergeStateStatus?: string
  reviewDecision?: string | null
  statusCheckRollup?: readonly CheckEntry[] | null
  baseRefName?: string
  headRefName?: string
  title?: string
  author?: { login?: string } | null
  labels?: readonly { name?: string }[] | null
}

export type MergeInput = {
  /** The repo as owner/repo. */
  repo: string
  pr: MergePr
  /** True when ~/.claude/autonomy.off exists (or the check failed). */
  killSwitch: boolean
  /** The GitHub login of the user (`gh api user`), undefined when unknown. */
  me: string | undefined
  policy: PolicyLoad
}

export type MergeDecision = { merge: true; method: Method } | { merge: false; reasons: string[] }

const METHODS: readonly Method[] = ['merge', 'squash', 'rebase']
const OWNER_REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(k => keys.includes(k))
}

function isBadRepoName(repo: string): boolean {
  const name = repo.split('/')[1] ?? ''
  return name === '.' || name === '..'
}

/** Validates the rule file's shape strictly (a copy of merge-policy's `validateRules`). */
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
    repos[key] = { method: method as Method[], admin: value.admin, requireApproval: value.requireApproval }
  }
  return { rules: { repos, requireGreen: raw.requireGreen, allowAdmin: raw.allowAdmin } }
}

/** Finds the rule for a repo, case-insensitively (a copy of merge-policy's `findRule`). */
export function findRule(rules: Rules, repo: string): { key: string; rule: RepoRule } | undefined {
  const lower = repo.toLowerCase()
  for (const [key, rule] of Object.entries(rules.repos)) {
    if (key.toLowerCase() === lower) return { key, rule }
  }
  return undefined
}

const GREEN_CONCLUSIONS = ['SUCCESS', 'NEUTRAL', 'SKIPPED']

/** Names every check that is not green (a copy of merge-policy's `notGreenChecks`). */
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

const PROD_BRANCH = /^(prod|production|release|releases|live|stable)([/_-].*)?$/i
const RELEASE_HEAD = /^(release|prod|production)[/_-]/i
const RELEASE_TITLE = /^\s*(\[?release\]?(\s|:|$)|chore\(release\))|\b(production release|release to (prod|production)|deploy to (prod|production))\b/i
const RELEASE_LABEL = /^(release|production|prod|deploy:? ?prod(uction)?)$/i

/** Why a PR is a production release, or undefined. A production release never merges automatically. */
export function productionReason(pr: MergePr): string | undefined {
  if (pr.baseRefName && PROD_BRANCH.test(pr.baseRefName)) return `the base branch ${pr.baseRefName} is a production or release branch`
  if (pr.headRefName && RELEASE_HEAD.test(pr.headRefName)) return `the branch ${pr.headRefName} is a release branch`
  if (pr.title && RELEASE_TITLE.test(pr.title)) return 'the title names a release'
  const label = (pr.labels ?? []).map(l => l.name ?? '').find(n => RELEASE_LABEL.test(n))
  if (label) return `the label "${label}" marks a production release`
  return undefined
}

/**
 * May ci-watch merge this PR by itself? It merges only when every rule holds:
 * the kill switch is off; the PR is the user's own and not a draft; CI is green and
 * mergeStateStatus is CLEAN; no requested changes; it is no production release; and
 * the merge-policy rule file allows the merge for the repo (the same conditions merge-policy
 * checks, with squash when the rule allows it, else the rule's first method, never --admin).
 * Otherwise it answers every reason it holds back.
 */
export function autoMergeDecision(input: MergeInput): MergeDecision {
  const { pr, policy } = input
  const reasons: string[] = []
  if (input.killSwitch) reasons.push('the kill switch ~/.claude/autonomy.off is on')
  const author = pr.author?.login
  if (!input.me) reasons.push('ci-watch cannot tell your GitHub login (gh api user failed)')
  else if (!author || author.toLowerCase() !== input.me.toLowerCase()) {
    reasons.push(`the PR is by ${author ? `@${author}` : 'an unknown author'}, not by you`)
  }
  if (pr.state !== 'OPEN') reasons.push(`the state is ${pr.state ?? 'unknown'}, not OPEN`)
  if (pr.isDraft !== false) reasons.push(pr.isDraft ? 'the PR is a draft' : 'gh did not say if the PR is a draft')
  if (pr.mergeable !== 'MERGEABLE' || pr.mergeStateStatus === 'DIRTY') {
    reasons.push(`the PR has a conflict or is not mergeable (mergeable ${pr.mergeable ?? 'unknown'})`)
  }
  const checks = pr.statusCheckRollup ?? []
  const bad = notGreenChecks(checks)
  // No checks can also mean they did not start yet: never "green" for an auto-merge.
  if (checks.length === 0) reasons.push('no checks reported')
  else if (bad.length > 0) reasons.push(`CI is not green: ${bad.join(', ')}`)
  if (pr.mergeStateStatus !== 'CLEAN') reasons.push(`mergeStateStatus is ${pr.mergeStateStatus ?? 'unknown'}, not CLEAN`)
  if (pr.reviewDecision === 'CHANGES_REQUESTED') reasons.push('a reviewer requested changes')
  const prod = productionReason(pr)
  if (prod) reasons.push(`it is a production release (${prod}); a release merges only by hand`)

  let method: Method | undefined
  if (policy.kind === 'missing') reasons.push('there is no merge-policy rule file (~/.claude/merge-policy.json)')
  else if (policy.kind === 'bad') reasons.push(`the merge-policy rule file is bad: ${policy.error}`)
  else {
    const found = findRule(policy.rules, input.repo)
    if (!found) reasons.push(`merge-policy has no rule for ${input.repo}`)
    else {
      if (found.rule.requireApproval && pr.reviewDecision !== 'APPROVED') {
        reasons.push(`merge-policy needs an approval for ${found.key} (reviewDecision ${pr.reviewDecision || 'none'})`)
      }
      method = found.rule.method.includes('squash') ? 'squash' : found.rule.method[0]
    }
  }
  if (reasons.length > 0 || method === undefined) return { merge: false, reasons }
  return { merge: true, method }
}
