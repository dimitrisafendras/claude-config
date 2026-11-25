import { expect, test } from 'claude-code/testing'
import { dayOf, deployOf, nextMidnight, ticketOf, verdictOf } from '../hooks/register'
import { autoMergeDecision, productionReason, validateRules, type MergeInput, type PolicyLoad } from '../hooks/merge-rules'

const run = (name: string, conclusion: string | undefined, startedAt: string, status = 'COMPLETED') => ({
  __typename: 'CheckRun',
  name,
  workflowName: name,
  status,
  conclusion,
  startedAt,
  detailsUrl: `https://github.com/acme/web-app/actions/runs/${startedAt.replace(/\D/g, '')}/job/1`,
})

test('a cancelled run that a newer run of the same check replaced is not a failure', () => {
  const older = run('record', 'CANCELLED', '2026-01-01T10:00:00Z')
  expect(verdictOf({ state: 'OPEN', statusCheckRollup: [older, run('record', 'SUCCESS', '2026-01-01T10:00:05Z')] }).verdict).toBe('green')
  expect(
    verdictOf({ state: 'OPEN', statusCheckRollup: [older, run('record', undefined, '2026-01-01T10:00:05Z', 'IN_PROGRESS')] }).verdict,
  ).toBe('pending')
  const red = verdictOf({ state: 'OPEN', statusCheckRollup: [older, run('record', 'FAILURE', '2026-01-01T10:00:05Z')] })
  expect(red.verdict).toBe('red')
  expect(red.failed.length).toBe(1)
})

test('a cancelled run stays a failure when nothing replaced it', () => {
  const cancelled = run('record', 'CANCELLED', '2026-01-01T10:00:05Z')
  expect(verdictOf({ state: 'OPEN', statusCheckRollup: [cancelled] }).verdict).toBe('red')
  expect(verdictOf({ state: 'OPEN', statusCheckRollup: [cancelled, run('tests', 'SUCCESS', '2026-01-01T10:00:09Z')] }).verdict).toBe('red')
  expect(verdictOf({ state: 'OPEN', statusCheckRollup: [run('record', 'SUCCESS', '2026-01-01T10:00:00Z'), cancelled] }).verdict).toBe('red')
  expect(
    verdictOf({ state: 'OPEN', statusCheckRollup: [run('record', 'CANCELLED', '2026-01-01T10:00:00Z'), cancelled] }).verdict,
  ).toBe('red')
})

test('deployOf reads the newest run of each deploy workflow', () => {
  const run = (workflowName: string, status: string, conclusion = '') => ({ workflowName, status, conclusion })
  expect(deployOf([run('tests', 'completed', 'success')]).state).toBe('none')
  expect(deployOf([run('Deploy staging', 'in_progress'), run('tests', 'completed', 'failure')]).state).toBe('pending')
  expect(deployOf([run('Deploy staging', 'completed', 'success'), run('Deploy staging', 'completed', 'failure')]).state).toBe('success')
  expect(deployOf([run('deploy', 'completed', 'success'), run('staging-smoke', 'completed', 'failure')]).state).toBe('failure')
  expect(deployOf([run('deploy', 'completed', 'skipped')]).state).toBe('success')
})

test('ticketOf finds a ticket id in a PR title, else null', () => {
  expect(ticketOf('[SN-12] Fix it')).toBe('SN-12')
  expect(ticketOf('CU-86c0abc Fix it')).toBe('CU-86c0abc')
  expect(ticketOf('Fix it')).toBe(null)
  expect(ticketOf(undefined)).toBe(null)
})

test('the day of the cap is local, and resets at the next local midnight', () => {
  const t = new Date(2026, 10, 25, 23, 59).getTime()
  expect(dayOf(t)).toBe('2026-11-25')
  expect(new Date(nextMidnight(t)).getTime()).toBe(new Date(2026, 10, 26, 0, 0).getTime())
  expect(dayOf(new Date(nextMidnight(t)).getTime())).toBe('2026-11-26')
})

// ---------- autoMergeDecision: may ci-watch merge this PR by itself? ----------

const ok = (name = 'test') => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: 'SUCCESS' })
const rules = (rule: Record<string, unknown> = { method: ['merge', 'squash'], admin: false, requireApproval: false }): PolicyLoad => {
  const r = validateRules({ repos: { 'o/r': rule }, requireGreen: true, allowAdmin: false })
  if (!('rules' in r)) throw new Error(r.error)
  return { kind: 'ok', rules: r.rules }
}
const base = (): MergeInput => ({
  repo: 'o/r',
  killSwitch: false,
  me: 'me',
  policy: rules(),
  pr: {
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    statusCheckRollup: [ok(), ok('lint')],
    baseRefName: 'main',
    headRefName: 'feat/SN-1-x',
    title: '[SN-1] Fix it',
    author: { login: 'Me' },
    labels: [],
  },
})
const withPr = (pr: Partial<MergeInput['pr']>): MergeInput => ({ ...base(), pr: { ...base().pr, ...pr } })
const reasons = (i: MergeInput) => {
  const d = autoMergeDecision(i)
  return d.merge ? [] : d.reasons
}

test('green and clean: merges, squash when the rule allows it, else its first method', () => {
  expect(autoMergeDecision(base())).toEqual({ merge: true, method: 'squash' })
  expect(autoMergeDecision({ ...base(), policy: rules({ method: ['rebase', 'merge'], admin: false, requireApproval: false }) })).toEqual({ merge: true, method: 'rebase' })
  expect(autoMergeDecision({ ...withPr({ reviewDecision: 'APPROVED' }), policy: rules({ method: ['squash'], admin: false, requireApproval: true }) }).merge).toBe(true)
})

test('a draft holds', () => {
  expect(reasons(withPr({ isDraft: true }))).toEqual(['the PR is a draft'])
  expect(reasons(withPr({ isDraft: undefined }))).toEqual(['gh did not say if the PR is a draft'])
})

test('red, pending or no CI holds', () => {
  const failed = { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }
  expect(reasons(withPr({ statusCheckRollup: [failed, ok('lint')], mergeStateStatus: 'UNSTABLE' }))).toEqual([
    'CI is not green: test FAILURE',
    'mergeStateStatus is UNSTABLE, not CLEAN',
  ])
  expect(reasons(withPr({ statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS' }] }))).toEqual(['CI is not green: test IN_PROGRESS'])
  expect(reasons(withPr({ statusCheckRollup: [] }))).toEqual(['no checks reported'])
})

test('a conflict, a block or a branch behind holds: only CLEAN merges', () => {
  expect(reasons(withPr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }))).toEqual([
    'the PR has a conflict or is not mergeable (mergeable CONFLICTING)',
    'mergeStateStatus is DIRTY, not CLEAN',
  ])
  expect(reasons(withPr({ mergeStateStatus: 'BEHIND' }))).toEqual(['mergeStateStatus is BEHIND, not CLEAN'])
  expect(reasons(withPr({ mergeStateStatus: 'BLOCKED' }))).toEqual(['mergeStateStatus is BLOCKED, not CLEAN'])
})

test('requested changes hold', () => {
  expect(reasons(withPr({ reviewDecision: 'CHANGES_REQUESTED' }))).toEqual(['a reviewer requested changes'])
})

test('the kill switch holds', () => {
  expect(reasons({ ...base(), killSwitch: true })).toEqual(['the kill switch ~/.claude/autonomy.off is on'])
})

test('a PR that is not yours holds, and an unknown login holds', () => {
  expect(reasons(withPr({ author: { login: 'someone' } }))).toEqual(['the PR is by @someone, not by you'])
  expect(reasons(withPr({ author: null }))).toEqual(['the PR is by an unknown author, not by you'])
  expect(reasons({ ...base(), me: undefined })).toEqual(['ci-watch cannot tell your GitHub login (gh api user failed)'])
})

test('a production release never merges automatically', () => {
  for (const pr of [
    { baseRefName: 'production' },
    { baseRefName: 'release/2026.11' },
    { baseRefName: 'prod' },
    { headRefName: 'release/v1.4.0' },
    { title: 'Release v1.4.0' },
    { title: 'chore(release): 1.4.0' },
    { title: 'Deploy to production' },
    { labels: [{ name: 'release' }] },
  ]) {
    const r = reasons(withPr(pr))
    expect(r.length).toBe(1)
    expect(r[0]).toContain('it is a production release')
  }
  expect(productionReason(base().pr)).toBe(undefined)
  expect(productionReason({ title: 'Fix the release notes link' })).toBe(undefined)
})

test('the merge-policy rule file decides: no file, a bad file, no rule for the repo, a needed approval', () => {
  expect(reasons({ ...base(), policy: { kind: 'missing' } })).toEqual(['there is no merge-policy rule file (~/.claude/merge-policy.json)'])
  expect(reasons({ ...base(), policy: { kind: 'bad', error: 'not valid JSON' } })).toEqual(['the merge-policy rule file is bad: not valid JSON'])
  expect(reasons({ ...base(), repo: 'o/other' })).toEqual(['merge-policy has no rule for o/other'])
  expect(reasons({ ...base(), policy: rules({ method: ['squash'], admin: false, requireApproval: true }) })).toEqual([
    'merge-policy needs an approval for o/r (reviewDecision none)',
  ])
  expect('error' in validateRules({ repos: { 'o/r': { method: ['squash'] } }, requireGreen: true, allowAdmin: false })).toBe(true)
})

test('every reason is named at once', () => {
  const r = reasons({ ...withPr({ isDraft: true, author: { login: 'x' }, baseRefName: 'production' }), killSwitch: true })
  expect(r.length).toBe(4)
})
