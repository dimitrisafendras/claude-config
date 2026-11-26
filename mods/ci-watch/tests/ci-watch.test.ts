import { expect, mock, test } from 'claude-code/testing'
import type { On, ToolCallArgs } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { dayOf } from '../hooks/register'

// Nothing sits beneath the plugin: these hooks stand for the engine and gh.

type Gh = { exitCode: number; stdout: string; stderr: string }
const ok = (j: unknown): Gh => ({ exitCode: 0, stdout: JSON.stringify(j), stderr: '' })

const RED = {
  state: 'OPEN',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'BLOCKED',
  url: 'https://github.com/o/r/pull/5',
  title: 'Fix it',
  baseRefName: 'main',
  headRefName: 'feat',
  isDraft: false,
  author: { login: 'me' },
  statusCheckRollup: [
    {
      __typename: 'CheckRun',
      name: 'test',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      detailsUrl: 'https://github.com/o/r/actions/runs/777/job/1',
    },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ],
}
const GREEN = { ...RED, mergeStateStatus: 'CLEAN', statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] }
const PENDING = { ...RED, statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS' }] }

const CONFLICT = { ...GREEN, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }

type World = {
  clock: ReturnType<typeof mock.clock>
  prompts: string[]
  toasts: string[]
  notes: string[]
  statuses: (string | undefined)[]
  gh: { pr: unknown; runs: unknown[]; rateLimited: boolean; calls: string[][] }
  /** True: the kill switch file ~/.claude/autonomy.off exists. */
  off: boolean
  /** What a Bash call beneath the plugin answers. */
  bash: Record<string, unknown>
  /** The login `gh api user` gives; undefined: gh fails. */
  me: string | undefined
  /** The merge-policy rule file ~/.claude/merge-policy.json; undefined: no file. */
  policy: unknown
}

/** A rule file that lets ci-watch squash-merge in o/r. */
const POLICY = { repos: { 'o/r': { method: ['merge', 'squash'], admin: false, requireApproval: false } }, requireGreen: true, allowAdmin: false }
const POLICY_PATH = '/home/me/.claude/merge-policy.json'

function world(on: On, opts: { now?: number; store?: Record<string, unknown> } = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: opts.now ?? 0 }),
    prompts: [],
    toasts: [],
    notes: [],
    statuses: [],
    gh: { pr: RED, runs: [], rateLimited: false, calls: [] },
    off: false,
    bash: { result: { stdout: 'ok', stderr: '', interrupted: false } },
    me: 'me',
    policy: POLICY,
  }
  mock.store(on, opts.store)
  mock.env(on, { HOME: '/home/me' })
  on('fs.exists', (_, e) => ({
    value: (w.off && e.path === '/home/me/.claude/autonomy.off') || (w.policy !== undefined && e.path === POLICY_PATH),
  }))
  on('fs.read', (_, e) => {
    if (w.policy === undefined || e.path !== POLICY_PATH) throw new Error('ENOENT')
    return { value: JSON.stringify(w.policy) }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', () => ({ value: { command: 'ci-watch' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__ci-watch__watch' } }))
  on('ui.status', (_, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    w.notes.push(e.text)
    return { value: { isSent: true as const, channel: 'terminal_bell' } }
  })
  on('prompt.submit', (_, e) => {
    w.prompts.push(e.text)
    return { text: e.text }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    w.gh.calls.push(argv)
    if (argv[0] !== 'gh') return { value: { exitCode: 1, stdout: '', stderr: 'no', isStdoutTruncated: false, isStderrTruncated: false } }
    let r: Gh
    if (w.gh.rateLimited) r = { exitCode: 1, stdout: '', stderr: 'HTTP 403: API rate limit exceeded' }
    else if (argv[1] === 'run' && argv[2] === 'list') r = ok(w.gh.runs)
    else if (argv[1] === 'api' && argv[2] === 'user') r = w.me ? { exitCode: 0, stdout: `${w.me}\n`, stderr: '' } : { exitCode: 1, stdout: '', stderr: 'no auth' }
    else if (argv.includes('-R')) r = ok(w.gh.pr)
    else if (argv[3] === '--json' && argv[4]?.includes('headRefName')) r = ok({ number: 5, url: 'https://github.com/o/r/pull/5', headRefName: 'feat' })
    else r = ok({ number: 5, url: 'https://github.com/o/r/pull/5' })
    return { value: { ...r, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', () => w.bash as { result: unknown })
  return w
}

const START = { cwd: '/repo', surface: 'terminal' as const, isInteractive: true }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }

test('add, then a red check starts a turn with the failed check and run id', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const added = await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  expect(added.text).toContain('now watching o/r#5')

  await $.command.run({ command: 'ci-watch', args: 'check', ...RUN })
  await w.clock.advance(1)
  const listed = await $.command.run({ command: 'ci-watch', args: 'list', ...RUN })
  expect(listed.text).toContain('o/r#5 red')
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('ci-watch: o/r#5 is red. Failed checks: test.')
  expect(w.prompts[0]).toContain('gh run view 777 --log-failed -R o/r')
  expect(w.statuses.at(-1)).toBe('ci 1 red')

  // The same red state does not start a second turn.
  await $.command.run({ command: 'ci-watch', args: 'check', ...RUN })
  await w.clock.advance(1)
  expect(w.prompts.length).toBe(1)
})

test('autoMerge false: green notifies without a turn; auto-merge on asks to merge', { options: { loop: 'off', autoMerge: false } }, async ($, on) => {
  const w = world(on)
  w.gh.pr = GREEN
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add https://github.com/o/r/pull/5', ...RUN })
  await $.command.run({ command: 'ci-watch', args: 'check', ...RUN })
  await w.clock.advance(1)
  expect(w.prompts.length).toBe(0)
  expect(w.toasts).toContain('o/r#5 is green')

  await $.command.run({ command: 'ci-watch', args: 'auto-merge 5 on', ...RUN })
  await $.command.run({ command: 'ci-watch', args: 'check', ...RUN })
  await w.clock.advance(1)
  expect(w.prompts[0]).toContain('ci-watch: o/r#5 is green and clean, and every auto-merge rule holds')
  expect(w.prompts[0]).toContain('`gh pr merge 5 -R o/r --squash --delete-branch`')
  expect(w.prompts[0]).not.toContain('decision record')
})

test('a sleep-poll loop is denied and the PR is watched; allow-poll lets it run', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const denied = await $.tool.call({ tool: 'Bash', command: 'while true; do gh pr checks 5 -R o/r; sleep 30; done' })
  expect(denied.text ?? denied.deny).toContain('ci-watch watches o/r#5 and starts a turn when CI changes. Do not poll')

  const list = await $.command.run({ command: 'ci-watch', args: 'list', ...RUN })
  expect(list.text).toContain('o/r#5')

  await $.command.run({ command: 'ci-watch', args: 'allow-poll on', ...RUN })
  const ran = await $.tool.call({ tool: 'Bash', command: 'gh run watch 777' })
  expect(ran.deny).toBeUndefined()
  expect(w.prompts.length).toBe(0)
})

test('a successful git push adds the branch PR and tells the model', async ($, on) => {
  world(on)
  await $.session.start(START)
  const ran = await $.tool.call({ tool: 'Bash', command: 'cd ~/code/r && git push -u origin HEAD' })
  expect(ran.context?.join(' ')).toContain('ci-watch now watches o/r#5')
  const list = await $.command.run({ command: 'ci-watch', args: 'list', ...RUN })
  expect(list.text).toContain('o/r#5 not checked yet')
})

test('the watch tool adds a PR (the interop path for other mods)', async ($, on) => {
  world(on)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'mcp__ci-watch__watch', pr: 'o/r#9' } as unknown as ToolCallArgs)
  expect(String(r.result)).toContain('ci-watch now watches o/r#9')
})

test('the 90 s timer polls; a rate limit doubles the interval and shows it', async ($, on) => {
  const w = world(on)
  const clock = w.clock
  w.gh.pr = PENDING
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })

  await clock.advance(90_000)
  expect(w.statuses.at(-1)).toBe('ci 1 pending')

  w.gh.rateLimited = true
  await clock.advance(90_000)
  expect(w.statuses.at(-1)).toBe('ci 1 pending · rate-limited, next in 3m')

  w.gh.rateLimited = false
  w.gh.pr = RED
  await clock.advance(180_000)
  expect(w.prompts.length).toBe(1)
  expect(w.statuses.at(-1)).toBe('ci 1 red')
})

// The option fix_turns: `on` (the default) starts the fix turn, `off` only reports.
const check = async ($: Engine, w: World) => {
  await $.command.run({ command: 'ci-watch', args: 'check', ...RUN })
  await w.clock.advance(1)
}

test('fix_turns on: a conflict starts a turn, with no toast', { options: { fix_turns: 'on', loop: 'off' } }, async ($, on) => {
  const w = world(on)
  w.gh.pr = CONFLICT
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.prompts).toEqual([
    'ci-watch: o/r#5 has merge conflicts with main. Fetch origin, rebase onto (or merge) origin/main, resolve the conflicts, run the tests, and push.',
  ])
  expect(w.toasts).toEqual([])
  expect(w.notes).toEqual([])
})

test('fix_turns off: red CI gets a toast and a notification, and no turn', { options: { fix_turns: 'off' } }, async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  const added = await $.tool.call({ tool: 'mcp__ci-watch__watch', pr: 'o/r#5' } as unknown as ToolCallArgs)
  expect(String(added.result)).toContain('ci-watch now watches o/r#5 and reports red CI and conflicts with a notification (it starts no fix turn')
  await check($, w)
  expect(w.prompts).toEqual([])
  expect(w.toasts).toEqual(['o/r#5 is red: test'])
  expect(w.notes).toEqual(['o/r#5 is red: test'])
  expect(w.statuses.at(-1)).toBe('ci 1 red')

  // The same red state does not report again.
  await check($, w)
  expect(w.toasts.length).toBe(1)
})

test('fix_turns off: a conflict gets a toast and a notification, and no turn', { options: { fix_turns: 'off' } }, async ($, on) => {
  const w = world(on)
  w.gh.pr = CONFLICT
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.prompts).toEqual([])
  expect(w.toasts).toEqual(['o/r#5 has merge conflicts'])
  expect(w.notes).toEqual(['o/r#5 has merge conflicts'])
})

test('fix_turns off: the green path does not change', { options: { fix_turns: 'off', loop: 'off', autoMerge: false } }, async ($, on) => {
  const w = world(on)
  w.gh.pr = GREEN
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.prompts).toEqual([])
  expect(w.toasts).toEqual(['o/r#5 is green'])
  expect(w.notes).toEqual(['o/r#5 is green'])

  await $.command.run({ command: 'ci-watch', args: 'auto-merge 5 on', ...RUN })
  await check($, w)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('Run the `merge-when-green` skill steps for it now')
})

test('the watch tool can switch auto-merge on for the PR', async ($, on) => {
  world(on)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'mcp__ci-watch__watch', pr: 'o/r#9', auto_merge: true } as unknown as ToolCallArgs)
  expect(String(r.result)).toContain('Auto-merge is on')
  const list = await $.command.run({ command: 'ci-watch', args: 'list', ...RUN })
  expect(list.text).toContain('o/r#9')
  expect(list.text).toContain('(auto-merge on)')
})

// ---------- the lane loop (option loop, default on) ----------

const redRun = (id: number) => ({
  ...RED,
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: `https://github.com/o/r/actions/runs/${id}/job/1` },
  ],
})
const MERGED = { ...GREEN, state: 'MERGED', title: '[SN-12] Fix it', mergeCommit: { oid: 'abc1234def567' } }
const deployRun = (status: string, conclusion: string) => [
  { databaseId: 901, status, conclusion, workflowName: 'Deploy staging', url: 'https://github.com/o/r/actions/runs/901' },
  { databaseId: 900, status: 'completed', conclusion: 'failure', workflowName: 'lint', url: 'https://github.com/o/r/actions/runs/900' },
]
const list = async ($: Engine) => (await $.command.run({ command: 'ci-watch', args: 'list', ...RUN })).text ?? ''

test('loop: fix tries count to 3, then one last turn writes a decision record', async ($, on) => {
  const w = world(on)
  w.gh.pr = redRun(777)
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  w.gh.pr = redRun(778)
  await check($, w)
  w.gh.pr = CONFLICT
  await check($, w)
  expect(w.prompts.length).toBe(3)
  expect(w.prompts[0]).toContain('This is fix try 1 of 3 for o/r#5. Before the fix: read ~/.claude/ci-lessons/o-r.md when it exists, then read the failed log')
  expect(w.prompts[0]).toContain('add one entry to ~/.claude/ci-lessons/o-r.md')
  expect(w.prompts[0]).toContain('Write `next` on the ticket row: "CI watch: fix try 1 of 3".')
  expect(w.prompts[0]).not.toContain('fresh subagent')
  expect(w.prompts[1]).toContain('fix try 2 of 3')
  expect(w.prompts[1]).toContain('do this try in a fresh subagent (the Agent tool, not a fork)')
  expect(w.prompts[2]).toContain('has merge conflicts with main')
  expect(w.prompts[2]).toContain('fix try 3 of 3')
  expect(await list($)).toContain('o/r#5 conflict (fix try 3 of 3)')

  w.gh.pr = redRun(779)
  await check($, w)
  expect(w.prompts.length).toBe(4)
  const last = w.prompts[3] ?? ''
  expect(last).toContain('o/r#5 is red again after 3 automatic fix tries. Stop fixing it')
  expect(last).toContain('Mark the ticket needs-you.')
  const rec = JSON.parse(/(\{"id".*?\}) Mark/.exec(last)?.[1] ?? '{}')
  expect(Object.keys(rec)).toEqual(['id', 'ticket', 'question', 'options', 'default', 'deadline', 'reversible'])
  expect(rec.options.length).toBe(2)
  expect(rec.options).toContain(rec.default)

  // After the last turn: a toast only, no fifth turn.
  w.gh.pr = redRun(780)
  await check($, w)
  expect(w.prompts.length).toBe(4)
  expect(w.toasts.at(-1)).toBe('o/r#5 is red; ci-watch stopped fixing it after 3 tries')
  expect(await list($)).toContain('stopped: needs-you')
})

test('loop: the kill switch file stops every turn and says nothing; the event waits', async ($, on) => {
  const w = world(on)
  w.off = true
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  await check($, w)
  expect(w.prompts).toEqual([])
  expect(w.toasts).toEqual([])
  expect(w.notes).toEqual([])
  expect(await list($)).toContain('kill switch on')

  w.off = false
  await check($, w)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('fix try 1 of 3')
})

test('the kill switch also holds the turns of loop off', { options: { loop: 'off' } }, async ($, on) => {
  const w = world(on)
  w.off = true
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.prompts).toEqual([])
  w.off = false
  await check($, w)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).not.toContain('fix try')
})

test('loop: the daily cap of 60 turns stores one decision record and resets at local midnight', async ($, on) => {
  const now = new Date(2026, 10, 25, 23, 50).getTime()
  const w = world(on, { now, store: { 'loop/day': { day: dayOf(now), count: 59 } } })
  w.gh.pr = redRun(777)
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.prompts.length).toBe(1)
  expect(await list($)).toContain('60 of 60 automatic turns today')

  w.gh.pr = CONFLICT
  await check($, w)
  await check($, w)
  expect(w.prompts.length).toBe(1)
  const capped = w.toasts.filter(t => t.includes('daily cap reached'))
  expect(capped.length).toBe(1)
  const shown = await list($)
  expect(shown).toContain('decision: {"id":"ci-watch-cap-')
  expect(shown).toContain('"question":"daily cap reached')
  expect(shown).toContain('"reversible":true')

  // Past local midnight the held conflict starts its turn.
  await w.clock.advance(15 * 60_000)
  expect(w.prompts.length).toBe(2)
  expect(w.prompts[1]).toContain('has merge conflicts')
  expect(await list($)).toContain('1 of 60 automatic turns today')
})

test('loop: the merge turn obeys merge-policy; a refused merge gets a decision record', async ($, on) => {
  const w = world(on)
  w.gh.pr = { ...GREEN, title: '[SN-12] Fix it' }
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await $.command.run({ command: 'ci-watch', args: 'auto-merge 5 on', ...RUN })
  await check($, w)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('ci-watch: o/r#5 is green and clean, and every auto-merge rule holds')
  expect(w.prompts[0]).toContain('merge-policy checks that call')
  expect(w.prompts[0]).toContain('the refusal is final')

  w.bash = { deny: 'merge-policy: o/r#5 not merged: review required' }
  const ran = await $.tool.call({ tool: 'Bash', command: 'gh pr merge 5 -R o/r --squash' })
  expect(ran.deny).toContain('merge-policy: o/r#5 not merged: review required')
  expect(ran.deny).toContain('ci-watch: the merge of o/r#5 was refused')
  expect(ran.deny).toContain('do not retry and do not work around it')
  expect(ran.deny).toContain('"ticket":"SN-12"')
  expect(ran.deny).toContain('Mark the ticket needs-you.')
  expect(await list($)).toContain('merge refused')

  // No new merge turn for the refused PR.
  w.gh.pr = PENDING
  await check($, w)
  w.gh.pr = GREEN
  await check($, w)
  expect(w.prompts.length).toBe(1)
})

test('loop: a merge starts the deploy watch; success starts verify, its end starts close and cleanup', async ($, on) => {
  const w = world(on)
  w.gh.pr = MERGED
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.toasts).toContain('o/r#5 is merged; ci-watch watches its deploy')
  expect(w.prompts).toEqual([])

  w.gh.runs = deployRun('in_progress', '')
  await check($, w)
  expect(w.prompts).toEqual([])
  expect(w.gh.calls.some(c => c.join(' ').startsWith('gh run list --commit abc1234def567 -R o/r'))).toBe(true)
  expect(w.statuses.at(-1)).toBe('ci 1 deploying')

  w.gh.runs = deployRun('completed', 'success')
  await check($, w)
  expect(w.prompts.length).toBe(1)
  const verify = w.prompts[0] ?? ''
  expect(verify).toContain('ci-watch: verify o/r#5 on staging.')
  expect(verify).toContain('Run the `deploy` skill steps for this PR on staging')
  expect(verify).toContain('attach the evidence')
  expect(verify).toContain('the ticket SN-12')

  await $.turn.start({ text: verify, turnId: 't-verify' })
  await $.turn.complete({ turnId: 't-verify', answer: 'verified on staging', durationMs: 1, isAborted: false, reason: 'answer' })
  await w.clock.advance(1)
  expect(w.prompts.length).toBe(2)
  expect(w.prompts[1]).toContain('ci-watch: close and clean up after o/r#5. The verify turn ended.')
  expect(w.prompts[1]).toContain('close the ticket SN-12 (the ticket-closer mod asks first)')
  expect(w.prompts[1]).toContain('Run the `cleanup` skill rules for this lane')
  expect(await list($)).toContain('0 PR(s) watched')
})

test('loop: a failed deploy is fix try N of 3 on a follow-up PR, which takes over the count', async ($, on) => {
  const w = world(on)
  w.gh.pr = MERGED
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  w.gh.runs = deployRun('completed', 'failure')
  await check($, w)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('ci-watch: the deploy of o/r#5 failed: run "Deploy staging"')
  expect(w.prompts[0]).toContain('This is fix try 1 of 3.')
  expect(w.prompts[0]).toContain('gh run view 901 --log-failed -R o/r')
  expect(w.prompts[0]).toContain('follows "o/r#5"')

  const r = await $.tool.call({ tool: 'mcp__ci-watch__watch', pr: 'o/r#6', auto_merge: true, follows: 'o/r#5' } as unknown as ToolCallArgs)
  expect(String(r.result)).toContain('It takes over the fix tries of o/r#5: 1 of 3 used.')
  const shown = await list($)
  expect(shown).toContain('o/r#6 not checked yet (fix try 1 of 3, auto-merge on)')
  expect(shown).not.toContain('o/r#5')
})

test('loop: a failed deploy after 3 fix tries writes a decision record', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  // A conflict between the two red runs: the failed checks are not the same two times in a row, so 3 tries count.
  for (const pr of [redRun(777), CONFLICT, redRun(779)]) {
    w.gh.pr = pr
    await check($, w)
  }
  w.gh.pr = MERGED
  await check($, w)
  w.gh.runs = deployRun('completed', 'failure')
  await check($, w)
  expect(w.prompts.length).toBe(4)
  expect(w.prompts[3]).toContain('ci-watch: the deploy of o/r#5 failed again after 3 automatic fix tries')
  expect(w.prompts[3]).toContain('"ticket":"SN-12"')
  expect(w.prompts[3]).toContain('Mark the ticket needs-you.')
  expect(await list($)).toContain('0 PR(s) watched')
})

test('loop: no deploy run in 20 minutes goes straight to close and cleanup', async ($, on) => {
  const w = world(on)
  w.gh.pr = MERGED
  w.gh.runs = [{ databaseId: 900, status: 'completed', conclusion: 'success', workflowName: 'tests' }]
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  await w.clock.advance(10 * 60_000)
  expect(w.prompts).toEqual([])
  await w.clock.advance(12 * 60_000)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('No deploy workflow ran for abc1234 in 20 minutes')
  expect(w.prompts[0]).toContain('cleanup')
})

test('loop off: a merged PR leaves the list, as before', { options: { loop: 'off' } }, async ($, on) => {
  const w = world(on)
  w.gh.pr = MERGED
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.toasts).toContain('o/r#5 is merged; ci-watch stopped watching it')
  expect(await list($)).toContain('0 PR(s) watched')
  expect(w.gh.calls.some(c => c[1] === 'run')).toBe(false)
})

test('loop: the same failed checks after two fix tries stop the tries early', async ($, on) => {
  const w = world(on)
  w.gh.pr = redRun(777)
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  w.gh.pr = redRun(778)
  await check($, w)
  w.gh.pr = redRun(779)
  await check($, w)
  expect(w.prompts.length).toBe(3)
  expect(w.prompts[1]).toContain('fix try 2 of 3')
  expect(w.prompts[2]).toContain('is red with the same failed checks (test) after 2 automatic fix tries')
  expect(w.prompts[2]).toContain('Stop fixing it: make no more fix commits.')
  expect(w.prompts[2]).toContain('"default":"a person fixes it"')
  expect(w.prompts[2]).not.toContain('fix try 3 of 3')

  // No more fix turns after the stop.
  w.gh.pr = redRun(780)
  await check($, w)
  expect(w.prompts.length).toBe(3)
})

// ---------- auto-merge of your own PRs (option autoMerge, default true) ----------

test('autoMergeSkip: a repo on the list gets no merge turn, and one PR can still ask for it', { options: { autoMergeSkip: 'x/y, O/*' } }, async ($, on) => {
  const w = world(on)
  w.gh.pr = GREEN
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.prompts.length).toBe(0)
  expect(w.toasts).toContain('o/r#5 is green')
  expect(await list($)).toContain('Not in: x/y, o/* (option autoMergeSkip).')

  await $.command.run({ command: 'ci-watch', args: 'auto-merge o/r#5 on', ...RUN })
  await check($, w)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('`gh pr merge 5 -R o/r --squash --delete-branch`')
})

test('autoMerge: your green, clean PR starts the merge turn with no ask, a toast and a status line', async ($, on) => {
  const w = world(on)
  w.gh.pr = GREEN
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('Run the `merge-when-green` skill steps for it now, with no question to the user')
  expect(w.prompts[0]).toContain('`gh pr merge 5 -R o/r --squash --delete-branch`')
  expect(w.prompts[0]).toContain('Mark the ticket needs-you.')
  expect(w.toasts).toContain('o/r#5 is green: ci-watch merges it (--squash)')
  expect(w.statuses.at(-1)).toBe('ci 1 green · o/r#5 merging')
  expect(await list($)).toContain('auto-merge on: ci-watch merges your own green, clean PRs')

  // The same state starts no second merge turn.
  await check($, w)
  expect(w.prompts.length).toBe(1)
})

test('autoMerge: a draft, a PR of someone else, a block and requested changes only get a toast', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  w.gh.pr = { ...GREEN, isDraft: true }
  await check($, w)
  expect(w.toasts.at(-1)).toContain('o/r#5 is green; ci-watch does not merge it: the PR is a draft')
  expect(w.statuses.at(-1)).toContain('o/r#5 held: the PR is a draft')
  w.gh.pr = { ...GREEN, author: { login: 'someone' } }
  await check($, w)
  expect(w.toasts.at(-1)).toContain('the PR is by @someone, not by you')
  w.gh.pr = { ...GREEN, mergeStateStatus: 'BLOCKED', reviewDecision: 'CHANGES_REQUESTED' }
  await check($, w)
  expect(w.toasts.at(-1)).toContain('mergeStateStatus is BLOCKED, not CLEAN; a reviewer requested changes')
  expect(w.prompts).toEqual([])

  // The block goes: the merge turn starts.
  w.gh.pr = GREEN
  await check($, w)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('every auto-merge rule holds')
})

test('autoMerge: no merge-policy rule for the repo, or a production release, holds the merge', async ($, on) => {
  const w = world(on)
  w.policy = undefined
  w.gh.pr = GREEN
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.toasts.at(-1)).toContain('there is no merge-policy rule file')
  expect(w.prompts).toEqual([])

  // An explicit auto-merge on a release PR: a turn says why, with a decision record.
  w.policy = POLICY
  w.gh.pr = { ...GREEN, baseRefName: 'production' }
  await $.command.run({ command: 'ci-watch', args: 'auto-merge 5 on', ...RUN })
  await check($, w)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('ci-watch: o/r#5 is green, but ci-watch does not merge it')
  expect(w.prompts[0]).toContain('production release')
  expect(w.prompts[0]).toContain('Do not merge it')
  expect(w.prompts[0]).toContain('"id":"ci-watch-o-r-5-merge-held"')
})

test('autoMerge: the kill switch holds the merge in silence, and the merge runs when it goes', async ($, on) => {
  const w = world(on)
  w.off = true
  w.gh.pr = GREEN
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'add o/r#5', ...RUN })
  await check($, w)
  expect(w.prompts).toEqual([])
  expect(w.toasts).toEqual([])
  expect(w.statuses.at(-1)).toContain('o/r#5 held: the kill switch')

  w.off = false
  await check($, w)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('every auto-merge rule holds')
})

test('autoMerge: /ci-watch auto-merge <pr> off keeps one PR out', async ($, on) => {
  const w = world(on)
  w.gh.pr = GREEN
  await $.session.start(START)
  await $.command.run({ command: 'ci-watch', args: 'auto-merge 5 off', ...RUN })
  await check($, w)
  expect(w.prompts).toEqual([])
  expect(w.toasts).toEqual(['o/r#5 is green'])
  expect(await list($)).toContain('(auto-merge off)')
})
