import type { EngineInterface, ProcessRunResult, Register, ToolCallArgs } from 'claude-code'

// ship: `/ship [hint]` takes the local diff to a pull request that ci-watch
// watches. `/ship --dry-run [hint]` prints the plan and changes nothing.
// It never merges. The hand-off to ci-watch is the tool
// `mcp__ci-watch__watch`, called through $.tool.call.
// The same run is the tool `mcp__ship__ship`, so skills and lanes can call it:
// a skill cannot type a slash command. The tool also takes the PR title and
// body (ticket id, check evidence) and a draft flag.

type $T = EngineInterface

const WATCH_TOOL = 'mcp__ci-watch__watch'
const SHIP_TOOL = 'mcp__ship__ship'
const DIFF_CAP = 12_000
const DEFAULT_NAMES = new Set(['main', 'master', 'dev'])
const CO_AUTHOR = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
const GENERATED = '🤖 Generated with [Claude Code](https://claude.com/claude-code)'

type Change = { code: string; path: string }

export type ShipOptions = {
  isDry: boolean
  hint: string
  /** Ask ci-watch to merge the PR on green. */
  isAutoMerge?: boolean
  /** PR title; with `body`, no PR text is generated. */
  title?: string
  body?: string
  isDraft?: boolean
}

class Stop extends Error {}

// The `auto_merge` option of the mod: on, every PR that ship opens gets auto-merge in ci-watch.
let autoMergeDefault = false

// ---------- pure helpers ----------

/** `git status --porcelain -z` entries; a rename's old path is skipped. */
export function parsePorcelain(z: string): Change[] {
  const parts = z.split('\0')
  const out: Change[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p || p.length < 4) continue
    const code = p.slice(0, 2)
    out.push({ code, path: p.slice(3) })
    if (code.includes('R') || code.includes('C')) i++
  }
  return out
}

const SECRET_RE = [/^\.env/i, /\.pem$/i, /\.key$/i, /^credentials/i]

export function isSecretPath(path: string): boolean {
  const base = path.split('/').pop() ?? path
  return SECRET_RE.some(r => r.test(base))
}

/** True when a repo's agent rules forbid AI attribution in commits or PRs. */
export function forbidsAttribution(text: string): boolean {
  return text.split('\n').some(line => {
    if (/attribution-guard/i.test(line)) return true
    if (!/co-?author|ai[- ]attribution/i.test(line)) return false
    return /\b(no|never|not|don'?t|forbid\w*|without|remove|avoid|must not|prohibit\w*)\b/i.test(line)
  })
}

function cleanMessage(text: string): string {
  return text
    .replace(/^```\w*\n?/gm, '')
    .replace(/```$/gm, '')
    .split('\n')
    .filter(l => !/^co-authored-by:/i.test(l.trim()) && !l.includes('Generated with'))
    .join('\n')
    .trim()
}

function firstError(r: ProcessRunResult): string {
  return (r.stderr.trim() || r.stdout.trim() || `exit code ${r.exitCode}`).slice(0, 2000)
}

// ---------- the run ----------

/** `/ship` arguments: `[--dry-run] [--auto-merge] [hint]`. */
export function parseArgs(rawArgs: string): ShipOptions {
  return {
    isDry: /(^|\s)--dry-run(\s|$)/.test(rawArgs),
    isAutoMerge: /(^|\s)--auto-merge(\s|$)/.test(rawArgs),
    hint: rawArgs.replace(/(^|\s)--(dry-run|auto-merge)(?=\s|$)/g, ' ').trim(),
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** Tool input to options. Unknown or wrong-typed fields are ignored. */
export function toolOptions(args: Record<string, unknown>): ShipOptions {
  return {
    isDry: args.dry_run === true,
    hint: str(args.hint) ?? '',
    title: str(args.title),
    body: str(args.body),
    isDraft: args.draft === true,
    isAutoMerge: args.auto_merge === true,
  }
}

async function ship($: $T, opts: ShipOptions): Promise<string> {
  const { isDry, hint } = opts
  const cwd = await $.session.cwd()
  const log: string[] = [isDry ? 'ship --dry-run: nothing will change.' : 'ship:']
  const step = (s: string) => log.push(s)

  const run = async (argv: string[], opts: { stdin?: string; timeoutMs?: number; dir?: string } = {}) =>
    $.process.run(argv, { cwd: opts.dir ?? cwd, stdin: opts.stdin, timeoutMs: opts.timeoutMs ?? 60_000 })
  const must = async (label: string, argv: string[], opts: { stdin?: string; timeoutMs?: number; dir?: string } = {}) => {
    const r = await run(argv, opts)
    if (r.exitCode !== 0) {
      step(`✘ ${label} failed (\`${argv.join(' ')}\`):\n${firstError(r)}`)
      throw new Stop()
    }
    return r
  }

  try {
    // 1. Repo, branch, default branch.
    const top = (await must('find the repository', ['git', 'rev-parse', '--show-toplevel'])).stdout.trim()
    const git = (args: string[], opts: { stdin?: string; timeoutMs?: number } = {}) =>
      run(['git', ...args], { ...opts, dir: top })
    const mustGit = (label: string, args: string[], opts: { stdin?: string; timeoutMs?: number } = {}) =>
      must(label, ['git', ...args], { ...opts, dir: top })

    const branch = (await mustGit('read the branch', ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
    const head = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    const defaultBranch = head.exitCode === 0 ? head.stdout.trim().replace(/^origin\//, '') : 'main'
    if (branch === 'HEAD' || branch === defaultBranch || DEFAULT_NAMES.has(branch)) {
      step(
        `✘ You are on ${branch === 'HEAD' ? 'a detached HEAD' : `the default branch \`${branch}\``}. Create a branch first, for example \`git switch -c <name>\`, then run /ship again.`,
      )
      throw new Stop()
    }
    step(`✔ repo ${top}, branch \`${branch}\` (default \`${defaultBranch}\`)`)

    // 2. What there is to ship.
    const status = await mustGit('read git status', ['status', '--porcelain', '-z', '--untracked-files=all'])
    const changes = parsePorcelain(status.stdout)
    const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    const base = upstream.exitCode === 0 ? upstream.stdout.trim() : `origin/${defaultBranch}`
    const ahead = await git(['rev-list', '--count', `${base}..HEAD`])
    const unpushed = ahead.exitCode === 0 ? Number(ahead.stdout.trim()) || 0 : 0
    const hasUpstream = upstream.exitCode === 0
    if (changes.length === 0 && unpushed === 0 && hasUpstream) {
      step('✘ Nothing to ship: no changes and no unpushed commits.')
      throw new Stop()
    }
    step(`✔ ${changes.length} changed file(s), ${unpushed} commit(s) not on ${base}`)

    // 3. Secrets are never staged.
    const secrets = changes.filter(c => !c.code.includes('D') && isSecretPath(c.path))
    if (secrets.length > 0) {
      step(
        `✘ These files look like secrets, so ship stages nothing:\n${secrets.map(s => `  - ${s.path}`).join('\n')}\nAdd them to .gitignore or move them out of the repo, then run /ship again.`,
      )
      throw new Stop()
    }

    // 4. Repo rules on attribution.
    let rulesText = ''
    for (const f of ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md']) {
      const p = `${top}/${f}`
      if (await $.fs.exists(p)) rulesText += `\n${await $.fs.read(p)}`
    }
    const isAttributed = !forbidsAttribution(rulesText)
    step(isAttributed ? '✔ attribution: allowed by the repo rules' : '✔ attribution: the repo rules forbid it; no trailer, no "Generated with" line')

    // 5. Stage and write the commit message.
    let message: string | undefined
    if (changes.length > 0) {
      let stat: string
      let diff: string
      if (isDry) {
        stat = (await git(['diff', 'HEAD', '--stat'])).stdout
        diff = (await git(['diff', 'HEAD'])).stdout
        const untracked = changes.filter(c => c.code === '??').map(c => c.path)
        if (untracked.length) stat += `\nnew files:\n${untracked.map(p => ` ${p}`).join('\n')}`
      } else {
        await mustGit('stage the files', ['add', '-A'])
        stat = (await mustGit('read the staged stat', ['diff', '--cached', '--stat'])).stdout
        diff = (await mustGit('read the staged diff', ['diff', '--cached'])).stdout
      }
      const subjects = (await git(['log', '-10', '--format=%s'])).stdout.trim()
      const cut = diff.length > DIFF_CAP ? `${diff.slice(0, DIFF_CAP)}\n[diff cut at ${DIFF_CAP} characters]` : diff
      const answer = await $.model.complete({
        model: 'haiku',
        maxTokens: 400,
        timeoutMs: 60_000,
        system: 'You write git commit messages. Output only the message: no code fences, no quotes, no trailers.',
        prompt: [
          'Write the commit message for this change.',
          'Rules: a subject line of at most 72 characters in the same style as the recent subjects below (keep their prefix convention, case and tense); then, if useful, one blank line and a body of at most 4 short lines that says why.',
          hint ? `The author's hint: ${hint}` : '',
          `Recent subjects:\n${subjects || '(none)'}`,
          `Staged files:\n${stat}`,
          `Diff:\n${cut}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      })
      if (!answer.isAnswered) {
        step(`✘ The commit message could not be written (model: ${answer.reason}${answer.reason === 'api-error' ? ` ${answer.status ?? ''} ${answer.error}` : ''}).${isDry ? '' : ' The files are staged; nothing is committed.'}`)
        throw new Stop()
      }
      message = cleanMessage(answer.text)
      if (!message) {
        step('✘ The model gave an empty commit message. The files are staged; nothing is committed.')
        throw new Stop()
      }
      if (isAttributed) message += `\n\n${CO_AUTHOR}`
      step(`${isDry ? '•' : '✔'} files to commit:\n${changes.map(c => `  ${c.code.trim() || 'M'} ${c.path}`).join('\n')}`)
      step(`${isDry ? '•' : '✔'} commit message:\n${message.split('\n').map(l => `  | ${l}`).join('\n')}`)
    }

    if (isDry) {
      log.push(
        '• plan:',
        `  1. ${message ? 'git add -A, then git commit with the message above' : 'no commit (no changes)'}`,
        '  2. git push -u origin HEAD',
        `  3. gh pr view for the branch; if none, gh pr create${opts.isDraft ? ' --draft' : ''} with ${opts.title && opts.body ? 'the given title and body' : 'a generated title and body'}`,
        `  4. hand the PR to ci-watch (mcp__ci-watch__watch)${opts.isAutoMerge || autoMergeDefault ? ', with auto-merge on' : ''}`,
        'Nothing was changed.',
      )
      return log.join('\n')
    }

    // 6. Commit and push.
    if (message) {
      await mustGit('commit', ['commit', '-F', '-'], { stdin: `${message}\n` })
      const sha = (await git(['rev-parse', '--short', 'HEAD'])).stdout.trim()
      step(`✔ committed ${sha}`)
    }
    await mustGit('push', ['push', '-u', 'origin', 'HEAD'], { timeoutMs: 180_000 })
    step(`✔ pushed \`${branch}\` to origin`)

    // 7. Find or open the PR. Never merge.
    let url: string | undefined
    const view = await run(['gh', 'pr', 'view', '--json', 'number,url,state'], { dir: top, timeoutMs: 30_000 })
    if (view.exitCode === 0) {
      const pr = JSON.parse(view.stdout) as { url?: string; state?: string }
      if (pr.url && pr.state === 'OPEN') {
        url = pr.url
        step(`✔ the PR exists: ${url}`)
      }
    }
    const draftFlag = opts.isDraft ? ['--draft'] : []
    if (!url && opts.title && opts.body) {
      const body = isAttributed
        ? opts.body.includes('Generated with') ? opts.body : `${opts.body}\n\n${GENERATED}`
        : cleanMessage(opts.body)
      const created = await run(['gh', 'pr', 'create', ...draftFlag, '--title', opts.title, '--body-file', '-'], {
        dir: top,
        stdin: body,
        timeoutMs: 60_000,
      })
      if (created.exitCode !== 0) {
        step(`✘ gh pr create failed:\n${firstError(created)}`)
        throw new Stop()
      }
      url = /https:\/\/github\.com\/\S+\/pull\/\d+/.exec(created.stdout)?.[0]
      step(`✔ opened the PR: ${url ?? created.stdout.trim()}`)
    }
    if (!url) {
      const commits = (await git(['log', '--format=%s%n%b', `origin/${defaultBranch}..HEAD`])).stdout.slice(0, 4000)
      const stat = (await git(['diff', '--stat', `origin/${defaultBranch}...HEAD`])).stdout.slice(0, 4000)
      const answer = await $.model.complete({
        model: 'haiku',
        maxTokens: 600,
        timeoutMs: 60_000,
        system: 'You write GitHub pull request titles and descriptions. Follow the output format exactly.',
        prompt: [
          'Write a pull request for these commits.',
          'Output format:\nTITLE: <one line, at most 72 characters, in the style of the commit subjects>\nSUMMARY:\n<2 to 5 bullet points that say what changed and why>',
          hint ? `The author's hint: ${hint}` : '',
          `Commits:\n${commits}`,
          `Files:\n${stat}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      })
      const text = answer.isAnswered ? answer.text : ''
      const title = /^TITLE:\s*(.+)$/m.exec(text)?.[1]?.trim()
      const summary = /SUMMARY:\s*\n([\s\S]*)$/m.exec(text)?.[1]?.trim()
      let created: ProcessRunResult
      if (title && summary) {
        const body = [
          '## Summary',
          cleanMessage(summary),
          '',
          '## Test plan',
          '- [ ] TODO: say how this change was tested',
          ...(isAttributed ? ['', GENERATED] : []),
        ].join('\n')
        created = await run(['gh', 'pr', 'create', ...draftFlag, '--title', title, '--body-file', '-'], {
          dir: top,
          stdin: body,
          timeoutMs: 60_000,
        })
      } else {
        step(`• the PR text could not be written (${answer.isAnswered ? 'no TITLE/SUMMARY' : answer.reason}); using gh pr create --fill`)
        created = await run(['gh', 'pr', 'create', ...draftFlag, '--fill'], { dir: top, timeoutMs: 60_000 })
      }
      if (created.exitCode !== 0) {
        step(`✘ gh pr create failed:\n${firstError(created)}`)
        throw new Stop()
      }
      url = /https:\/\/github\.com\/\S+\/pull\/\d+/.exec(created.stdout)?.[0]
      step(`✔ opened the PR: ${url ?? created.stdout.trim()}`)
    }

    // 8. Hand the PR to ci-watch.
    if (url) {
      try {
        // Typed loosely: the MCP type list may not name ci-watch's tool yet.
        const call = { tool: WATCH_TOOL, pr: url, cwd: top, auto_merge: opts.isAutoMerge || autoMergeDefault } as unknown as ToolCallArgs
        const r = await $.tool.call(call)
        if (r.deny !== undefined) step(`✘ ci-watch refused the PR: ${r.deny}`)
        else step(`✔ ${typeof r.result === 'string' ? r.result : 'handed to ci-watch'}`)
      } catch (err) {
        step(`✘ could not hand the PR to ci-watch (is the ci-watch mod loaded?): ${String(err)}`)
      }
    }
    step(opts.isAutoMerge || autoMergeDefault ? 'ship never merges itself. ci-watch starts the merge turn when CI is green.' : 'ship never merges. ci-watch starts a turn when CI changes.')
    return log.join('\n')
  } catch (err) {
    if (!(err instanceof Stop)) step(`✘ ship stopped: ${String(err)}`)
    return log.join('\n')
  }
}

// ---------- register ----------

export const register: Register = (on, options) => {
  autoMergeDefault = options.auto_merge === 'on'

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'ship',
        description: 'Commit the local diff, push the branch, open or find its PR, and hand it to ci-watch. Never merges itself; --auto-merge asks ci-watch to merge on green.',
        argumentHint: '[--dry-run] [--auto-merge] [message hint]',
      })
    } catch {
      // The command is missing this session; nothing else depends on it.
    }
    try {
      await $.tool.register({
        name: 'ship',
        description:
          'The /ship run as a tool: stage every change in the repo at the session directory, commit it with a generated message, push the branch, open or find its pull request and hand it to ci-watch. Never merges. Refuses the default branch and files that look like secrets, and obeys the repo rules on AI attribution. Give `title` and `body` to set the PR text (ticket id, what changed, the check command and its result); else the PR text is generated with a TODO test plan. Use `dry_run` to see the plan first.',
        inputSchema: {
          type: 'object',
          properties: {
            hint: { type: 'string', description: 'A hint for the commit message and the generated PR text' },
            title: { type: 'string', description: 'PR title; used with body for a new PR' },
            body: { type: 'string', description: 'PR body in Markdown; used with title for a new PR' },
            draft: { type: 'boolean', description: 'Open a new PR as a draft' },
            auto_merge: { type: 'boolean', description: 'Ask ci-watch to merge the PR per the repo rules when it is green' },
            dry_run: { type: 'boolean', description: 'Print the plan and the commit message; change nothing' },
          },
        },
      })
    } catch {
      // The tool is missing this session; /ship still works.
    }
    return next(e)
  })

  on('command.run', { command: 'ship' }, async ($, e) => {
    try {
      return { text: await ship($, parseArgs(e.args)) }
    } catch (err) {
      return { text: `ship failed: ${String(err)}` }
    }
  })

  // No tool.check hook: the tool commits and pushes, so the normal
  // permission prompt applies. The tool name is compared as a string, so the
  // hook types the same whether or not the MCP type list names it yet.
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== SHIP_TOOL) return next(e)
    try {
      return { result: await ship($, toolOptions(e as unknown as Record<string, unknown>)) }
    } catch (err) {
      return { result: `ship failed: ${String(err)}` }
    }
  })
}
