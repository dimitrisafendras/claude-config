import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { isAbsolutePath, parseMergeCommand, personAsk } from '../hooks/policy.js'

const HOME = '/home/t'
const RULE_PATH = `${HOME}/.claude/merge-policy.json`
const REPO = 'acme/web-app'

const RULES = {
  repos: { [REPO]: { method: ['merge', 'squash'], admin: false, requireApproval: false } },
  requireGreen: true,
  allowAdmin: false,
}

const GREEN_PR = {
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: '',
  baseRefName: 'main',
  headRefName: 'feature',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'StatusContext', context: 'ci/legacy', state: 'SUCCESS' },
  ],
}

type World = {
  rules?: unknown
  ruleText?: string
  pr?: unknown
  prExit?: number
  prStdout?: string
  prReject?: boolean
  repoView?: string
  below?: 'allow' | 'ask' | 'deny'
}

type Seen = {
  argv: string[][]
  cwd: (string | undefined)[]
  toasts: string[]
  store: Map<string, unknown>
}

/** The engine beneath the plugin, from memory. */
function world(on: On, w: World, store?: Record<string, unknown>): Seen {
  const seen: Seen = { argv: [], cwd: [], toasts: [], store: new Map(Object.entries(store ?? {})) }
  mock.env(on, { HOME })
  // The plugin's store, kept here so the test can read it back.
  on('store.get', (_, e) => ({ value: structuredClone(seen.store.get(e.key)) }))
  on('store.set', (_, e) => {
    seen.store.set(e.key, structuredClone(e.value))
    return { value: undefined }
  })
  mock.clock(on, { now: Date.UTC(2026, 10, 16, 12, 0, 0) })
  const hasFile = w.rules !== undefined || w.ruleText !== undefined
  on('fs.exists', (_, e) => ({ value: hasFile && e.path === RULE_PATH }))
  on('fs.read', (_, e) => {
    if (!hasFile || e.path !== RULE_PATH) throw new Error('ENOENT')
    return { value: w.ruleText ?? JSON.stringify(w.rules) }
  })
  on('process.run', (_, e) => {
    seen.argv.push([...e.argv])
    seen.cwd.push(e.init?.cwd)
    const out = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv[1] === 'repo' && e.argv[2] === 'view') {
      return out(JSON.stringify({ nameWithOwner: w.repoView ?? REPO }))
    }
    if (e.argv[1] === 'pr' && e.argv[2] === 'view') {
      if (w.prReject) throw new Error('timed out')
      return out(w.prStdout ?? JSON.stringify(w.pr ?? GREEN_PR), w.prExit ?? 0)
    }
    return out('', 1)
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.check', () => ({ decision: w.below ?? 'ask', reason: 'engine verdict' }))
  return seen
}

const check = ($: Engine, command: string) => $.tool.check({ tool: 'Bash', input: { command } })

const run = ($: Engine, args: string) =>
  $.command.run({
    command: 'merge-policy',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

const ALLOW_REASON = `merge-policy: ${REPO}#4 green, mergeable, rule ${REPO}`
const askReason = (why: string) => `merge-policy: ${why}. A person must approve this merge.`
const ENGINE_ASK = { decision: 'ask', reason: 'engine verdict' }

describe('allow', () => {
  test('-R with --squash on a green PR', async ($, on) => {
    const seen = world(on, { rules: RULES })
    const v = await check($, `gh pr merge 4 -R ${REPO} --squash`)
    expect(v.decision).toBe('allow')
    expect(v.reason).toBe(ALLOW_REASON)
    expect(seen.argv).toEqual([
      ['gh', 'pr', 'view', '4', '-R', REPO, '--json',
        'state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,baseRefName,headRefName'],
    ])
  })

  test('a PR URL with --merge --delete-branch --auto', async ($, on) => {
    world(on, { rules: RULES })
    const v = await check($, `gh pr merge https://github.com/${REPO}/pull/4 --merge --delete-branch --auto`)
    expect(v.decision).toBe('allow')
    expect(v.reason).toBe(ALLOW_REASON)
  })

  test('cd <dir> && gh pr merge resolves the repo in that dir', async ($, on) => {
    const seen = world(on, { rules: RULES })
    const v = await check($, `cd '/Users/me/My Projects/claude-config' && gh pr merge 4 --squash`)
    expect(v.decision).toBe('allow')
    expect(seen.argv[0]).toEqual(['gh', 'repo', 'view', '--json', 'nameWithOwner'])
    expect(seen.cwd[0]).toBe('/Users/me/My Projects/claude-config')
  })

  test('cd ~/dir expands HOME; the repo key matches case-insensitively', async ($, on) => {
    const seen = world(on, { rules: RULES, repoView: 'Acme/Web-App' })
    const v = await check($, 'cd ~/Projects/claude-config && gh pr merge 4 --squash')
    expect(v.decision).toBe('allow')
    expect(seen.cwd[0]).toBe(`${HOME}/Projects/claude-config`)
  })

  test('--admin when allowAdmin and the repo admin are both true', async ($, on) => {
    const rules = {
      ...RULES,
      allowAdmin: true,
      repos: { [REPO]: { method: ['squash'], admin: true, requireApproval: true } },
    }
    world(on, { rules, pr: { ...GREEN_PR, reviewDecision: 'APPROVED' } })
    const v = await check($, `gh pr merge 4 -R ${REPO} --squash --admin`)
    expect(v.decision).toBe('allow')
  })

  test('requireGreen false allows a PR with no checks', async ($, on) => {
    world(on, { rules: { ...RULES, requireGreen: false }, pr: { ...GREEN_PR, statusCheckRollup: [] } })
    const v = await check($, `gh pr merge 4 -R ${REPO} --squash`)
    expect(v.decision).toBe('allow')
  })

  test('each allow is logged to the store', async ($, on) => {
    const seen = world(on, { rules: RULES })
    await check($, `gh pr merge 4 -R ${REPO} --squash`)
    const log = (seen.store.get('decisions')) as { decision: string; repo: string; pr: number; time: string; reason: string }[]
    expect(log).toEqual([
      { time: '2026-11-16T12:00:00.000Z', repo: REPO, pr: 4, decision: 'allow', reason: ALLOW_REASON },
    ])
  })
})

describe('deny', () => {
  const cases: [string, World, string, RegExp][] = [
    ['a failed check', { rules: RULES, pr: { ...GREEN_PR, statusCheckRollup: [
      { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }] } },
      `gh pr merge 4 -R ${REPO} --squash`, /checks not green: test FAILURE/],
    ['a pending check', { rules: RULES, pr: { ...GREEN_PR, statusCheckRollup: [
      { __typename: 'CheckRun', name: 'build', status: 'IN_PROGRESS', conclusion: '' },
      { __typename: 'StatusContext', context: 'ci/x', state: 'PENDING' }] } },
      `gh pr merge 4 -R ${REPO} --squash`, /checks not green: build IN_PROGRESS, ci\/x PENDING/],
    ['no checks while requireGreen', { rules: RULES, pr: { ...GREEN_PR, statusCheckRollup: [] } },
      `gh pr merge 4 -R ${REPO} --squash`, /no checks reported/],
    ['a method not in the rule', { rules: RULES }, `gh pr merge 4 -R ${REPO} --rebase`,
      /--rebase not allowed \(allowed: --merge, --squash\)/],
    ['no method flag', { rules: RULES }, `gh pr merge 4 -R ${REPO}`, /no merge method flag/],
    ['--admin while not allowed', { rules: RULES }, `gh pr merge 4 -R ${REPO} --squash --admin`,
      /--admin not allowed/],
    ['--admin with allowAdmin but repo admin false', { rules: { ...RULES, allowAdmin: true } },
      `gh pr merge 4 -R ${REPO} --squash --admin`, /--admin not allowed/],
    ['a draft that is not mergeable', { rules: RULES, pr: { ...GREEN_PR, isDraft: true, mergeable: 'CONFLICTING' } },
      `gh pr merge 4 -R ${REPO} --squash`, /PR is a draft; mergeable is CONFLICTING, not MERGEABLE/],
    ['a closed PR', { rules: RULES, pr: { ...GREEN_PR, state: 'MERGED' } },
      `gh pr merge 4 -R ${REPO} --squash`, /state is MERGED, not OPEN/],
    ['a missing approval', {
      rules: { ...RULES, repos: { [REPO]: { method: ['squash'], admin: false, requireApproval: true } } },
      pr: { ...GREEN_PR, reviewDecision: 'REVIEW_REQUIRED' } },
      `gh pr merge 4 -R ${REPO} --squash`, /reviewDecision is REVIEW_REQUIRED, not APPROVED/],
  ]
  for (const [name, w, command, reason] of cases) {
    test(name, async ($, on) => {
      world(on, w)
      const v = await check($, command)
      expect(v.decision).toBe('deny')
      expect(v.reason).toMatch(new RegExp(`^merge-policy: ${REPO}#4 not merged: `))
      expect(v.reason).toMatch(reason)
    })
  }

  test('a deny beneath is never turned into an allow', async ($, on) => {
    world(on, { rules: RULES, below: 'deny' })
    const v = await check($, `gh pr merge 4 -R ${REPO} --squash`)
    expect(v.decision).toBe('deny')
    expect(v.reason).toBe('engine verdict')
  })
})

describe('pass through', () => {
  test('no rule file: inert, no gh call, nothing stored', async ($, on) => {
    const seen = world(on, {})
    const v = await check($, `gh pr merge 4 -R ${REPO} --squash`)
    expect(v).toEqual({ decision: 'ask', reason: 'engine verdict' })
    expect(seen.argv).toEqual([])
    expect([...seen.store.keys()]).toEqual([])
  })

  test('a command with no gh pr merge in it', async ($, on) => {
    const seen = world(on, { rules: RULES })
    for (const command of ['git status', 'gh pr view 4', 'gh pr merged', 'echo merge']) {
      expect(await check($, command)).toEqual(ENGINE_ASK)
    }
    expect(seen.argv).toEqual([])
    expect([...seen.store.keys()]).toEqual([])
  })

  test('no rule file: every shape passes through', async ($, on) => {
    world(on, {})
    expect(await check($, `gh pr merge 4 -R ${REPO} --squash | cat`)).toEqual(ENGINE_ASK)
    expect(await check($, 'gh pr merge 4 -R someone/else --squash')).toEqual(ENGINE_ASK)
  })
})

// With a rule file, a merge that the file does not settle needs a person.
describe('ask a person', () => {
  test('the answer carries decider: person', () => {
    expect(personAsk('why')).toEqual({ decision: 'ask', reason: 'why', decider: 'person' })
  })

  const shapes = [
    `gh pr merge 4 -R ${REPO} --squash | cat`,
    `gh pr merge 4 -R ${REPO} --squash; echo done`,
    `gh pr merge 4 -R ${REPO} --squash && rm -rf /tmp/x`,
    `echo hi && gh pr merge 4 -R ${REPO} --squash`,
    `cd /x && cd /y && gh pr merge 4 -R ${REPO} --squash`,
    `gh pr merge $(echo 4) -R ${REPO} --squash`,
    `gh pr merge \`echo 4\` -R ${REPO} --squash`,
    `GH_TOKEN=x gh pr merge 4 -R ${REPO} --squash`,
    `gh pr merge 4 -R ${REPO} --squash --body done`,
    `gh pr merge 4 -R ${REPO} -s`,
    `gh pr merge 4 --repo=${REPO} --squash`,
    `gh pr merge 4 -R ${REPO} --squash --merge`,
    `gh pr merge -R ${REPO} --squash`,
    `gh pr merge my-branch -R ${REPO} --squash`,
    `gh pr merge 4 5 -R ${REPO} --squash`,
    `gh pr merge 4 --squash`,
    `cd claude-config && gh pr merge 4 --squash`,
    `cd "$HOME/x" && gh pr merge 4 --squash`,
    `gh pr merge 4 -R ${REPO} --squash > /tmp/out`,
    `gh pr merge 4 -R ${REPO} --squash &`,
    `gh pr merge 4 -R ${REPO}\n--squash`,
    `gh pr merge 4 -R '${REPO}' --squash`,
    `gh pr merge https://github.com/other/repo/pull/4 -R ${REPO} --squash`,
    `/usr/bin/gh pr merge 4 -R ${REPO} --squash`,
    `gh pr merge 4 -R github.com/${REPO} --squash`,
  ]
  for (const command of shapes) {
    test(`shape: ${command}`, async ($, on) => {
      const seen = world(on, { rules: RULES })
      const v = await check($, command)
      expect(v.decision).toBe('ask')
      expect(v.reason).toBe(askReason('the command shape is not on the allowed list'))
      expect(seen.argv).toEqual([])
    })
  }

  test('a repo not in the rule file: asked and logged, no gh call', async ($, on) => {
    const seen = world(on, { rules: RULES })
    const v = await check($, 'gh pr merge 4 -R someone/else --squash')
    expect(v.decision).toBe('ask')
    expect(v.reason).toBe(askReason('someone/else is not in the rule file'))
    expect(seen.argv).toEqual([])
    expect(seen.store.get('decisions')).toEqual([
      { time: '2026-11-16T12:00:00.000Z', repo: 'someone/else', pr: 4, decision: 'ask',
        reason: askReason('someone/else is not in the rule file') },
    ])
  })

  test('an allow beneath stays allow for a repo not in the file', async ($, on) => {
    const seen = world(on, { rules: RULES, below: 'allow' })
    const v = await check($, 'gh pr merge 4 -R someone/else --squash')
    expect(v).toEqual({ decision: 'allow', reason: 'engine verdict' })
    expect(seen.store.get('decisions')).toBe(undefined)
  })

  test('a deny beneath stays deny for a repo not in the file', async ($, on) => {
    world(on, { rules: RULES, below: 'deny' })
    const v = await check($, 'gh pr merge 4 -R someone/else --squash')
    expect(v).toEqual({ decision: 'deny', reason: 'engine verdict' })
  })

  const errors: [string, World][] = [
    ['gh pr view fails', { rules: RULES, prExit: 1 }],
    ['gh pr view prints bad JSON', { rules: RULES, prStdout: '{not json' }],
    ['gh pr view answers an odd shape', { rules: RULES, prStdout: JSON.stringify({ state: 'OPEN' }) }],
    ['gh pr view times out', { rules: RULES, prReject: true }],
  ]
  for (const [name, w] of errors) {
    test(`error: ${name}`, async ($, on) => {
      const seen = world(on, w)
      const v = await check($, `gh pr merge 4 -R ${REPO} --squash`)
      expect(v.decision).toBe('ask')
      expect(v.reason).toBe(askReason('gh pr view failed'))
      const log = (seen.store.get('decisions')) as { decision: string }[]
      expect(log.map(d => d.decision)).toEqual(['ask'])
    })
  }

  const badFiles: [string, World][] = [
    ['not JSON', { ruleText: '{ repos: ' }],
    ['a bad method', { rules: { ...RULES, repos: { [REPO]: { method: ['yolo'], admin: false, requireApproval: false } } } }],
    ['requireGreen missing', { rules: { repos: RULES.repos, allowAdmin: false } }],
    ['an unknown key', { rules: { ...RULES, allowEverything: true } }],
    ['a repo key that is not owner/repo', { rules: { ...RULES, repos: { 'claude-config': RULES.repos[REPO] } } }],
  ]
  for (const [name, w] of badFiles) {
    test(`bad rule file (${name}): ask, toast once`, async ($, on) => {
      const seen = world(on, w)
      const first = await check($, `gh pr merge 4 -R ${REPO} --squash`)
      const second = await check($, `gh pr merge 4 -R ${REPO} --squash`)
      expect(first.decision).toBe('ask')
      expect(first.reason).toMatch(/^merge-policy: bad rule file: .*\. A person must approve this merge\.$/)
      expect(second.decision).toBe('ask')
      expect(seen.argv).toEqual([])
      expect(seen.toasts).toEqual(['merge-policy: bad rule file'])
    })
  }
})

// A test has no person: `$.tool.call` raises the check as a background
// subagent does, so an ask that only a person can answer refuses the call.
describe('a real call with nobody to ask', () => {
  const call = async ($: Engine, on: On, command: string) => {
    let ran = false
    on('tool.call', { tool: 'Bash' }, () => {
      ran = true
      return { result: 'merged' }
    })
    const out = await $.tool.call({ tool: 'Bash', command })
    return { ran, out }
  }

  test('a merge that the rule file allows runs', async ($, on) => {
    world(on, { rules: RULES })
    const { ran, out } = await call($, on, `gh pr merge 4 -R ${REPO} --squash`)
    expect(ran).toBe(true)
    expect(out.isError).not.toBe(true)
  })

  test('a merge for a repo not in the rule file is refused', async ($, on) => {
    world(on, { rules: RULES })
    const { ran, out } = await call($, on, 'gh pr merge 4 -R someone/else --squash')
    expect(ran).toBe(false)
    expect(out.isError).toBe(true)
  })

  test('a merge in a compound command is refused', async ($, on) => {
    world(on, { rules: RULES })
    const { ran, out } = await call($, on, `gh pr merge 4 -R ${REPO} --squash && echo done`)
    expect(ran).toBe(false)
    expect(out.isError).toBe(true)
  })

  test('a merge that the rule file denies is refused with the reason', async ($, on) => {
    world(on, { rules: RULES })
    const { ran, out } = await call($, on, `gh pr merge 4 -R ${REPO} --rebase`)
    expect(ran).toBe(false)
    expect(out.isError).toBe(true)
    expect(out.text).toMatch(/--rebase not allowed/)
  })
})

describe('log', () => {
  test('keeps the last 100 decisions', async ($, on) => {
    const old = Array.from({ length: 100 }, (_, i) => ({
      time: 't', repo: REPO, pr: i, decision: 'deny', reason: 'r',
    }))
    const seen = world(on, { rules: RULES }, { decisions: old })
    await check($, `gh pr merge 4 -R ${REPO} --squash`)
    const log = (seen.store.get('decisions')) as { pr: number; decision: string }[]
    expect(log.length).toBe(100)
    expect(log[0]?.pr).toBe(1)
    expect(log[99]?.decision).toBe('allow')
  })
})

describe('/merge-policy', () => {
  test('status lists the file, the repos and the last decisions', async ($, on) => {
    world(on, { rules: RULES })
    await check($, `gh pr merge 4 -R ${REPO} --squash`)
    const out = await run($, 'status')
    expect(out.text).toMatch(`merge-policy rule file: ${RULE_PATH}`)
    expect(out.text).toMatch(`- ${REPO}: method merge/squash, admin false, requireApproval false`)
    expect(out.text).toMatch(`${REPO}#4 allow: ${ALLOW_REASON}`)
  })

  test('status says inert without a rule file', async ($, on) => {
    world(on, {})
    const out = await run($, '')
    expect(out.text).toMatch(/no rule file\. The mod is inert/)
  })

  test('test <pr-url> is a dry run: it logs nothing and merges nothing', async ($, on) => {
    const seen = world(on, { rules: RULES })
    const out = await run($, `test https://github.com/${REPO}/pull/4`)
    expect(out.text).toMatch(/Dry run \(nothing is merged\)/)
    expect(out.text).toMatch(`Would allow: ${ALLOW_REASON}`)
    expect(out.text).toMatch(/give a method flag/)
    expect(seen.argv.every(a => !a.includes('merge'))).toBe(true)
    expect(seen.store.get('decisions')).toBe(undefined)
  })

  test('test <pr-url> --rebase shows the deny', async ($, on) => {
    world(on, { rules: RULES })
    const out = await run($, `test https://github.com/${REPO}/pull/4 --rebase`)
    expect(out.text).toMatch(/Would deny: .*--rebase not allowed/)
  })

  test('test on a repo not in the file says ask a person', async ($, on) => {
    const seen = world(on, { rules: RULES })
    const out = await run($, 'test https://github.com/a/b/pull/1')
    expect(out.text).toMatch(/Would ask a person \(auto mode cannot approve it\): a\/b is not in the rule file/)
    expect(seen.store.get('decisions')).toBe(undefined)
  })

  test('test without a rule file says pass through', async ($, on) => {
    world(on, {})
    const out = await run($, 'test https://github.com/a/b/pull/1')
    expect(out.text).toMatch(/Would pass through to the normal decider: no rule file/)
  })

  test('status with a bad rule file says a merge needs a person', async ($, on) => {
    world(on, { ruleText: '{ repos: ' })
    const out = await run($, 'status')
    expect(out.text).toMatch(/bad rule file \(not valid JSON\)\. Every `gh pr merge` needs a person\./)
  })
})

describe('home folders and paths on Windows', () => {
  test('isAbsolutePath takes /… and C:/… only', () => {
    expect(isAbsolutePath('/home/t')).toBe(true)
    expect(isAbsolutePath('C:/Users/me')).toBe(true)
    expect(isAbsolutePath('relative/dir')).toBe(false)
    expect(isAbsolutePath('C:relative')).toBe(false)
    expect(isAbsolutePath('~/x')).toBe(false)
  })

  test('cd ~/dir expands a USERPROFILE home; a drive path is a cd dir', () => {
    expect(parseMergeCommand('cd ~/Projects/x && gh pr merge 4 -R acme/web-app --squash', 'C:/Users/me')?.cdDir).toBe('C:/Users/me/Projects/x')
    expect(parseMergeCommand('cd E:/Projects/x && gh pr merge 4 -R acme/web-app --squash', undefined)?.cdDir).toBe('E:/Projects/x')
  })

  test('a home or cd dir that is not absolute is still refused', () => {
    expect(parseMergeCommand('cd ~/x && gh pr merge 4 -R acme/web-app --squash', 'Users/me')).toBeUndefined()
    expect(parseMergeCommand('cd x && gh pr merge 4 -R acme/web-app --squash', 'C:/Users/me')).toBeUndefined()
  })
})
