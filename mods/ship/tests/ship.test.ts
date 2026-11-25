import { expect, test } from 'claude-code/testing'
import type { On, ToolCallArgs } from 'claude-code'

// Nothing sits beneath the plugin: these hooks stand for git, gh, the model
// and the file system. A small inline plugin stands for ci-watch's tool.

type Run = { argv: string[]; stdin?: string }

type Repo = {
  branch: string
  porcelain: string
  hasPr: boolean
  rules: string
  runs: Run[]
  watched: string[]
}

const CI_WATCH_STUB = {
  name: 'ci-watch',
  register(on: On) {
    on('session.start', async ($, e, next) => {
      await $.tool.register({ name: 'watch', description: 'stub' })
      return next(e)
    })
    on('tool.check', { tool: 'mcp__ci-watch__watch' }, () => ({ decision: 'allow' as const }))
    on('tool.call', ($, e, next) =>
      String(e.tool) === 'mcp__ci-watch__watch'
        ? { result: `ci-watch now watches ${String((e as unknown as { pr?: unknown }).pr)}` }
        : next(e),
    )
  },
}

function repo(on: On, over: Partial<Repo> = {}): Repo {
  const r: Repo = {
    branch: 'feat/x',
    porcelain: ' M src/a.ts\0?? src/b.ts\0',
    hasPr: false,
    rules: '',
    runs: [],
    watched: [],
    ...over,
  }
  const out = (stdout: string, exitCode = 0, stderr = '') => ({
    value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', () => ({ value: { command: 'ship' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__ci-watch__watch' } }))
  on('fs.exists', (_, e) => ({ value: e.path === '/repo/CLAUDE.md' && r.rules !== '' }))
  on('fs.read', () => ({ value: r.rules }))
  on('model.complete', (_, e) => ({
    value: {
      isAnswered: true as const,
      text: e.prompt.includes('pull request')
        ? 'TITLE: feat: add b\nSUMMARY:\n- adds b'
        : 'feat: add b\n\nAdds the b module.',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    r.runs.push({ argv, stdin: e.init?.stdin })
    const a = argv.join(' ')
    if (a === 'git rev-parse --show-toplevel') return out('/repo\n')
    if (a === 'git rev-parse --abbrev-ref HEAD') return out(`${r.branch}\n`)
    if (a.startsWith('git symbolic-ref')) return out('origin/main\n')
    if (a.startsWith('git status')) return out(r.porcelain)
    if (a.includes('@{u}')) return out('', 128, 'no upstream')
    if (a.startsWith('git rev-list')) return out('0\n')
    if (a.startsWith('git log -10')) return out('feat: earlier\nfix: thing\n')
    if (a.startsWith('git diff')) return out(' src/a.ts | 2 +-\n')
    if (a.startsWith('git rev-parse --short')) return out('abc1234\n')
    if (a.startsWith('git ')) return out('')
    if (a.startsWith('gh pr view')) return r.hasPr ? out(JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN' })) : out('', 1, 'no pull requests found')
    if (a.startsWith('gh pr create')) return out('https://github.com/o/r/pull/8\n')
    return out('', 1, `unexpected ${a}`)
  })
  return r
}

const START = { cwd: '/repo', surface: 'terminal' as const, isInteractive: true }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const ran = (r: Repo, prefix: string) => r.runs.filter(x => x.argv.join(' ').startsWith(prefix))

test('ship commits with the trailer, opens a PR and hands it to ci-watch', { plugins: [CI_WATCH_STUB] }, async ($, on) => {
  const r = repo(on)
  await $.session.start(START)
  const res = await $.command.run({ command: 'ship', args: 'add b', ...RUN })

  expect(ran(r, 'git add -A').length).toBe(1)
  const commit = ran(r, 'git commit')[0]
  expect(commit?.stdin).toContain('feat: add b')
  expect(commit?.stdin).toContain('Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')
  expect(ran(r, 'git push -u origin HEAD').length).toBe(1)
  const create = ran(r, 'gh pr create')[0]
  expect(create?.stdin).toContain('## Test plan')
  expect(create?.stdin).toContain('🤖 Generated with [Claude Code](https://claude.com/claude-code)')
  expect(res.text).toContain('opened the PR: https://github.com/o/r/pull/8')
  expect(res.text).toContain('ci-watch now watches https://github.com/o/r/pull/8')
  expect(ran(r, 'gh pr merge').length).toBe(0)
})

test('an existing PR is reported, not created again', { plugins: [CI_WATCH_STUB] }, async ($, on) => {
  const r = repo(on, { hasPr: true })
  await $.session.start(START)
  const res = await $.command.run({ command: 'ship', args: '', ...RUN })
  expect(ran(r, 'gh pr create').length).toBe(0)
  expect(res.text).toContain('the PR exists: https://github.com/o/r/pull/7')
})

test('repo rules that forbid attribution drop the trailer and the line', { plugins: [CI_WATCH_STUB] }, async ($, on) => {
  const r = repo(on, { rules: '# Rules\n- Never add Co-Authored-By trailers or other AI attribution.\n' })
  await $.session.start(START)
  await $.command.run({ command: 'ship', args: '', ...RUN })
  expect(ran(r, 'git commit')[0]?.stdin).not.toContain('Co-Authored-By')
  expect(ran(r, 'gh pr create')[0]?.stdin).not.toContain('Generated with')
})

test('the default branch is refused', async ($, on) => {
  const r = repo(on, { branch: 'main' })
  await $.session.start(START)
  const res = await $.command.run({ command: 'ship', args: '', ...RUN })
  expect(res.text).toContain('Create a branch first')
  expect(ran(r, 'git add').length).toBe(0)
})

test('files that look like secrets stop ship before staging', async ($, on) => {
  const r = repo(on, { porcelain: ' M src/a.ts\0?? .env.local\0?? certs/server.pem\0' })
  await $.session.start(START)
  const res = await $.command.run({ command: 'ship', args: '', ...RUN })
  expect(res.text).toContain('.env.local')
  expect(res.text).toContain('certs/server.pem')
  expect(ran(r, 'git add').length).toBe(0)
})

test('--dry-run prints the plan and the message and changes nothing', async ($, on) => {
  const r = repo(on)
  await $.session.start(START)
  const res = await $.command.run({ command: 'ship', args: '--dry-run add b', ...RUN })
  expect(res.text).toContain('Nothing was changed.')
  expect(res.text).toContain('| feat: add b')
  expect(res.text).toContain('src/b.ts')
  for (const p of ['git add', 'git commit', 'git push', 'gh pr create']) expect(ran(r, p).length).toBe(0)
})

test('the ship tool opens a draft PR with the given title and body', { plugins: [CI_WATCH_STUB] }, async ($, on) => {
  const r = repo(on)
  await $.session.start(START)
  const res = await $.tool.call({
    tool: 'mcp__ship__ship',
    hint: 'add b',
    title: 'feat: add b (CU-123)',
    body: '## Summary\n- adds b\n\n## Check\n`pnpm test`: pass',
    draft: true,
  } as unknown as ToolCallArgs)

  expect(ran(r, 'git commit')[0]?.stdin).toContain('feat: add b')
  const create = ran(r, 'gh pr create')[0]
  expect(create?.argv).toContain('--draft')
  expect(create?.argv).toContain('feat: add b (CU-123)')
  expect(create?.stdin).toContain('`pnpm test`: pass')
  expect(create?.stdin).toContain('🤖 Generated with [Claude Code](https://claude.com/claude-code)')
  expect(String(res.result)).toContain('ci-watch now watches https://github.com/o/r/pull/8')
  expect(ran(r, 'gh pr merge').length).toBe(0)
})

test('the ship tool drops attribution from a given body when the repo forbids it', { plugins: [CI_WATCH_STUB] }, async ($, on) => {
  const r = repo(on, { rules: '- Never add Co-Authored-By trailers or other AI attribution.\n' })
  await $.session.start(START)
  await $.tool.call({
    tool: 'mcp__ship__ship',
    title: 'fix: thing',
    body: 'Fixes it.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  } as unknown as ToolCallArgs)
  const create = ran(r, 'gh pr create')[0]
  expect(create?.stdin).toContain('Fixes it.')
  expect(create?.stdin).not.toContain('Generated with')
  expect(ran(r, 'git commit')[0]?.stdin).not.toContain('Co-Authored-By')
})

test('the ship tool with dry_run changes nothing', async ($, on) => {
  const r = repo(on)
  await $.session.start(START)
  const res = await $.tool.call({ tool: 'mcp__ship__ship', dry_run: true, draft: true } as unknown as ToolCallArgs)
  expect(String(res.result)).toContain('Nothing was changed.')
  expect(String(res.result)).toContain('gh pr create --draft')
  for (const p of ['git add', 'git commit', 'git push', 'gh pr create']) expect(ran(r, p).length).toBe(0)
})

test('--auto-merge and the auto_merge input ask ci-watch to merge on green', { plugins: [CI_WATCH_STUB] }, async ($, on) => {
  const r = repo(on)
  await $.session.start(START)
  const res = await $.command.run({ command: 'ship', args: '--auto-merge add b', ...RUN })
  expect(res.text).toContain('ci-watch starts the merge turn when CI is green')
  expect(ran(r, 'git commit')[0]?.stdin).toContain('feat: add b')
  expect(ran(r, 'gh pr merge').length).toBe(0)
  const dry = await $.command.run({ command: 'ship', args: '--dry-run --auto-merge', ...RUN })
  expect(dry.text).toContain('with auto-merge on')
})
