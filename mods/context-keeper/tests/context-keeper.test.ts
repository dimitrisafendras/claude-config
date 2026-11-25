import type { On, SessionCompactResult } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const PROMPT = { wait: false, origin: { kind: 'composer' as const } }

function host(on: On, compacted: string[] = [], prompts: (readonly string[] | undefined)[] = []) {
  mock.store(on)
  on('session.id', () => ({ value: 's-1' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('process.run', (_, e) => {
    const args = e.argv.slice(3).join(' ')
    const stdout = args === 'rev-parse --show-toplevel' ? '/work/app\n' : args === 'branch --show-current' ? 'feat/login\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', (_, e) => {
    prompts.push(e.context)
    return { text: e.text, context: e.context }
  })
  on('session.compact', (_, e): SessionCompactResult => {
    compacted.push(e.instructions ?? '')
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] }
  })
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash' && e.command.startsWith('gh pr create')) {
      return { result: {}, text: 'https://github.com/acme/app/pull/77\n' }
    }
    if (e.tool === 'Bash' && e.command === 'git branch --show-current') return { result: {}, text: 'feat/login' }
    return { result: {}, text: 'ok' }
  })
}

const keep = async ($: { command: { run: (e: any) => Promise<{ text?: string }> } }, args: string) =>
  (await $.command.run({ command: 'keep', args, ...RUN })).text ?? ''

test('the record collects decisions, PRs, branch and todos', async ($, on) => {
  host(on)
  await $.prompt.submit({ text: 'Fix the login bug. Never push to main. We work in worktrees only.', ...PROMPT })
  await $.tool.call({ tool: 'Bash', command: 'git branch --show-current' })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [{ content: 'Write the test', status: 'in_progress', activeForm: 'Writing the test' }],
  })

  const shown = await keep($, 'show')
  expect(shown).toContain('branch: feat/login')
  expect(shown).toContain('PRs: https://github.com/acme/app/pull/77')
  expect(shown).toContain('- [in_progress] Write the test')
  expect(shown).toContain('- Never push to main.')
  expect(shown).toContain('- We work in worktrees only.')
  expect(shown).not.toContain('Fix the login bug')
})

test('compaction keeps the block and the next prompt carries it once', async ($, on) => {
  const compacted: string[] = []
  const prompts: (readonly string[] | undefined)[] = []
  host(on, compacted, prompts)
  await $.prompt.submit({ text: "Don't use npm, use pnpm not npm.", ...PROMPT })

  await $.session.compact({
    trigger: 'manual',
    instructions: 'focus on the API',
    messages: [{ role: 'user', text: 'old', toolUses: [] }],
  })
  expect(compacted[0]).toContain('focus on the API')
  expect(compacted[0]).toContain('verbatim')
  expect(compacted[0]).toContain('<context-keeper task-state>')
  expect(compacted[0]).toContain('repo: /work/app')

  await $.prompt.submit({ text: 'go on', ...PROMPT })
  await $.prompt.submit({ text: 'and then?', ...PROMPT })
  expect(prompts[1]?.[0]).toContain('The conversation was compacted')
  expect(prompts[1]?.[0]).toContain("Don't use npm, use pnpm not npm.")
  expect(prompts[2]).toBeUndefined()
})

test('/keep add and clear', async ($, on) => {
  host(on)
  expect(await keep($, 'add always run the tests')).toContain('added')
  expect(await keep($, 'show')).toContain('- always run the tests')
  expect(await keep($, 'clear')).toContain('clear')
  expect(await keep($, 'show')).toBe('keep: no task state yet.')
})

test('decisions are capped at 15, newest kept', async ($, on) => {
  host(on)
  for (let i = 1; i <= 20; i++) await keep($, `add never do thing ${i}`)
  const shown = await keep($, 'show')
  expect(shown).not.toContain('thing 5\n')
  expect(shown).toContain('thing 6')
  expect(shown).toContain('thing 20')
})
