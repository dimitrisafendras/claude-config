import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

type Repo = {
  branch: string
  behind: number
  isMain: boolean
  isDirty: boolean
  rules?: Record<string, string>
}

const ROOT = '/work/app'
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }

/** Stands for the host: git answers from `repo`, files from `repo.rules`. */
function fakeHost(on: On, repo: Repo, calls: string[][] = []) {
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  on('session.cwd', () => ({ value: ROOT }))
  on('command.register', () => ({ value: { command: 'repo-guard' } }))
  on('fs.read', (_, e) => {
    const name = e.path.slice(ROOT.length + 1)
    const text = repo.rules?.[name]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    calls.push(argv)
    const dir = argv[2] ?? ''
    const args = argv.slice(3).join(' ')
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const fail = () => ({ value: { exitCode: 128, stdout: '', stderr: 'fatal', isStdoutTruncated: false, isStderrTruncated: false } })
    if (!dir.startsWith(ROOT)) return fail()
    if (args === 'rev-parse --show-toplevel') return ok(ROOT)
    if (args === 'branch --show-current') return ok(repo.branch)
    if (args === 'symbolic-ref --short refs/remotes/origin/HEAD') return ok('origin/main')
    if (args.startsWith('rev-parse --path-format=absolute')) {
      return ok(repo.isMain ? `${ROOT}/.git\n${ROOT}/.git` : `${ROOT}/.git/worktrees/x\n${ROOT}/.git`)
    }
    if (args.startsWith('status --porcelain')) return ok(repo.isDirty ? ' M a.ts' : '')
    if (args.startsWith('rev-list --left-right --count')) return ok(`0\t${repo.behind}`)
    if (args === 'fetch -q origin') return ok('')
    return fail()
  })
  on('tool.call', () => ({ result: { stdout: 'done' }, text: 'done' }))
}

test('git commit on main is refused', async ($, on) => {
  fakeHost(on, { branch: 'main', behind: 0, isMain: true, isDirty: false })
  const ran = await $.tool.call({ tool: 'Bash', command: 'git add . && git commit -m x' })
  expect(ran.deny).toBe('repo-guard: do not commit on main; create a branch first')
  expect(ran.deny).toContain('repo-guard: do not commit on main; create a branch first')
})

test('git commit on a feature branch runs', async ($, on) => {
  fakeHost(on, { branch: 'feat/x', behind: 0, isMain: false, isDirty: false })
  const ran = await $.tool.call({ tool: 'Bash', command: `git -C ${ROOT} commit -m x` })
  expect(ran.text).toBe('done')
})

test('a commit after checkout -b runs', async ($, on) => {
  fakeHost(on, { branch: 'main', behind: 0, isMain: true, isDirty: false })
  const ran = await $.tool.call({ tool: 'Bash', command: 'git checkout -b feat/y && git commit -m x' })
  expect(ran.text).toBe('done')
})

test('push of claude/* is refused only where the repo forbids it', async ($, on) => {
  const repo: Repo = {
    branch: 'claude/fix-it',
    behind: 0,
    isMain: false,
    isDirty: false,
    rules: { 'AGENTS.md': '# Rules\n- Never use agent-branded branch names such as claude/*.\n' },
  }
  fakeHost(on, repo)
  const denied = await $.tool.call({ tool: 'Bash', command: 'git push -u origin claude/fix-it' })
  expect(denied.deny).toContain('AGENTS.md: - Never use agent-branded branch names')

  const other = await $.tool.call({ tool: 'Bash', command: 'git push -u origin feat/ok' })
  expect(other.text).toBe('done')
})

test('push of claude/* runs where no rule exists', async ($, on) => {
  fakeHost(on, { branch: 'claude/fix-it', behind: 0, isMain: false, isDirty: false })
  const ran = await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(ran.text).toBe('done')
})

test('an edit on a branch far behind runs and carries one warning', async ($, on) => {
  const calls: string[][] = []
  fakeHost(on, { branch: 'feat/old', behind: 42, isMain: false, isDirty: false }, calls)
  const edit = { tool: 'Edit' as const, file_path: `${ROOT}/src/a.ts`, old_string: 'a', new_string: 'b' }

  const first = await $.tool.call(edit)
  expect(first.text).toBe('done')
  expect(first.context).toEqual([
    'repo-guard: app branch feat/old is 42 commits behind origin/main; rebase or merge main before more edits.',
  ])
  expect(calls.filter(c => c[3] === 'fetch').length).toBe(1)

  const second = await $.tool.call(edit)
  expect(second.context).toBeUndefined()
})

test('the main checkout on main with changes warns at the first prompt', async ($, on) => {
  fakeHost(on, { branch: 'main', behind: 0, isMain: true, isDirty: true })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  const first = await $.prompt.submit({ text: 'fix the bug', wait: false, origin: { kind: 'composer' } })
  expect(first.context?.[0]).toContain('main checkout on main with uncommitted changes')
  const second = await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })
  expect(second.context).toBeUndefined()
})

test('/repo-guard off lets a commit on main run', async ($, on) => {
  fakeHost(on, { branch: 'main', behind: 0, isMain: true, isDirty: false })
  const out = await $.command.run({ command: 'repo-guard', args: 'off', ...RUN })
  expect(out.text).toBe('repo-guard is off.')
  const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  expect(ran.text).toBe('done')
  await $.command.run({ command: 'repo-guard', args: 'on', ...RUN })
})

test('/repo-guard status lists the facts', async ($, on) => {
  fakeHost(on, { branch: 'feat/x', behind: 3, isMain: false, isDirty: false })
  const out = await $.command.run({ command: 'repo-guard', args: 'status', ...RUN })
  expect(out.text).toContain('branch: feat/x (default main)')
  expect(out.text).toContain('behind origin/main: 3')
})
