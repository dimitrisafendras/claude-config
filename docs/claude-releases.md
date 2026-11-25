# Claude releases digest

The big new features that Anthropic released for Claude, and the changes that affect the daily workflow of this setup (skills, mods, routines, worktrees, the PR flow). Each item has what it does, why it helps this setup, and a link to the source. Months are newest first.

Covered to: 2026-11-24
Covered from: 2026-05-24
Last update: 2026-11-24 (added mod backdrops)

Sources: the Claude Code [CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) with the [release dates](https://github.com/anthropics/claude-code/releases), the [Claude Code docs](https://code.claude.com/docs/llms.txt), the [Anthropic newsroom](https://www.anthropic.com/news) and the [Claude Platform release notes](https://platform.claude.com/docs/en/release-notes/overview). The routine `routines/weekly-claude-releases.md` adds new items every Monday. Small changes, bug fixes, settings tweaks, older models, API-only, gateway, self-hosted runner and admin-only items are not in this digest.

## November 2026

### Mods can set a backdrop and the color scheme
2026-11-24 · v2.1.319 · Mods

In the Desktop app, a mod can now change the background of the conversation. A mod calls `$.theme.set` with a backdrop scene and an optional color scheme, and a `Backdrop` render hook draws the scene. Because a mod is code, it can use session data too: `$.session.usage()` gives the context window and the plan limits, so a scene can change as the context fills. Anthropic announced this on 2026-11-24. The docs say `$.theme` needs v2.1.319 or later, and the `Backdrop` fields were renamed in v2.1.323 (`id` is now `scene`, `colorScheme` is now `overrideColorScheme`). The `theme-examples` plugin has sample backdrops, and `/custom-theme` starts from them.

**Why here:** A theme mod in this repo can use the scene, the color scheme and the context-window link, not only a fixed look. A mod that reads `$.session.usage()` can also show the context or the plan limit as a scene, with no extra pane.

[Source](https://code.claude.com/docs/en/plugins/mods/interface#put-a-backdrop-behind-the-conversation)

### easel, a built-in chart mod
2026-11-20 · v2.1.330 · Mods

A built-in mod that draws charts when you ask for one and under MCP metrics results. You can turn off the automatic charts in `/config`.

**Why here:** Usage, CI and memory numbers from the mods and skills can show as a chart with no new code. The `mcp__easel__chart` tool comes from this mod.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.330)

### /tasks shows scheduled tasks, loops, the goal and forks
2026-11-19 · v2.1.329 · Claude Code

`/tasks` now lists the scheduled tasks of the session, the `/loop` wakeups, the active goal and the forks of the conversation. Press `x` to stop one.

**Why here:** One place to see and stop what the routines, `/loop` and `/goal` started in a session.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.329)

### Code Mode (experimental)
2026-11-12 · v2.1.323 · Claude Code

Claude writes JavaScript that makes several tool calls in one step: parallel commands, filtered results, one result used in the next call. It is off by default. v2.1.326 lets it run with agent teams, and v2.1.331 adds Bedrock, Google Cloud, Foundry and Claude Platform on AWS.

**Why here:** Changes that repeat across many files, such as one edit in all mods, take fewer turns. Try it on a branch first, because it can change or go away.

[Source](https://code.claude.com/docs/en/code-mode)

### Claude Fable 5.2
2026-11-09 · v2.1.321 · Models

The new default Fable model (`claude-fable-5-2`): 1M context, $8/$40 per million tokens, a lower price than Fable 5.1. The API adds a fast mode for it.

**Why here:** A cheaper top model for hard planning and review work. Check the model names in the `automodel` mod and in skill frontmatter.

[Source](https://www.anthropic.com/claude-fable-and-mythos-5-2)

### Deny instead of prompting
2026-11-06 · v2.1.319 · Permissions

`permissions.denyInsteadOfPrompting` denies a tool call that would wait on a permission prompt, and the turn continues. It works in terminal sessions, subagents and teammates. For `claude -p` runs, `--permission-prompts none` (v2.1.259) does the same.

**Why here:** A routine that runs with nobody watching does not hang on a prompt. It gets a denial and writes it in its report.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.319)

## October 2026

### Block writes outside the working directories
2026-10-30 · v2.1.314 · Permissions

`permissions.blockWritesOutsideWorkingDirectories`: Write, Edit and NotebookEdit refuse paths outside the working directories in every permission mode.

**Why here:** A session in a worktree cannot write by mistake in the main checkout, which the install links serve.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.314)

### Idle compaction
2026-10-30 · v2.1.299, v2.1.314 · Claude Code

A conversation of more than 200K tokens that stays idle for about 54 minutes is compacted before its one-hour prompt cache expires. The terminal got it in v2.1.299, VS Code and the desktop Code tab in v2.1.314. Turn it off with `"idleCompaction": false`.

**Why here:** Long dispatcher sessions cost less when you come back to them after a break.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.314)

### Mods can require a person to approve
2026-10-19 · v2.1.304 · Mods

A mod's `tool.check` answer can set `decider: "person"`: only the permission dialog or a host callback can approve, and with nobody to ask the call is refused. The event also has `e.isReadOnly`. A transcript line now says when another plugin skips one of your mod's hooks.

**Why here:** `merge-policy`, `repo-guard` and `verify-gate` can make a person approve a merge or a push, also in auto mode.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.304)

### Claude Haiku 5.5
2026-10-07 · v2.1.293 · Models

The new default Haiku model (`claude-haiku-5-5`): 1M context, $0.10/$0.50 per million tokens, for high-volume work such as subagents and browser use.

**Why here:** The cheap lane of the `paralel` skill. Code written for Haiku 4.5 can break: read the migration notes.

[Source](https://www.anthropic.com/claude-haiku-5-5)

### Effort for each subagent
2026-10-06 · v2.1.292 · Claude Code

The Agent tool has an `effort` parameter, so Claude runs a subagent at the effort you ask for. From v2.1.316, `CLAUDE_CODE_SUBAGENT_EFFORT` sets the effort of subagents when nothing else names one; before, they used the effort of the session.

**Why here:** The `paralel` skill can give each agent a model and an effort level, and small agents do not run at the effort of an xhigh session.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.292)

### Claude Mods
2026-10-01 · v2.1.287 · Mods

Plugins can now change deeper behavior with JavaScript or TypeScript event handlers: panes, bands, commands, tools and tool call rules. A built-in mod, You should know, came at the same time. Through October and November the mods API got many additions: native notifications, prompt and agent events, prompt caching for model calls, and type checks in `claude plugin validate`.

**Why here:** All of `mods/` in this repo is built on this API. The mods docs are the reference for each change.

[Source](https://code.claude.com/docs/en/plugins/mods/overview)

## September 2026

### Open the desktop app from the terminal
2026-09-29 · v2.1.285 · Desktop

`claude --desktop` opens the Claude desktop app on the current directory, or on a session with `--continue` or `--resume <id>`.

**Why here:** Move a terminal session to the desktop app, where the panes and the browser are.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.285)

### Claude Sonnet 5.5
2026-09-28 · v2.1.284 · Models

The new default Sonnet model on the API (`claude-sonnet-5-5`): 1M context, $2/$10 per million tokens. On 2026-10-07 the cache read price went down to $0.10.

**Why here:** The middle lane of the `paralel` skill.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.284)

### Claude Opus 5.5
2026-09-22 · v2.1.280 · Models

The new default Opus model (`claude-opus-5-5`): 1M context, $4/$20 per million tokens. Anthropic says it costs 40% less to run than Opus 5 on typical work.

**Why here:** The default for design-heavy work in this setup costs less.

[Source](https://www.anthropic.com/claude-opus-5-5)

### AGENTS.md support
2026-09-18 · v2.1.277 · Claude Code

In a project with no CLAUDE.md, Claude Code reads AGENTS.md. Change it under "Project instructions" in `/config`.

**Why here:** Projects that keep their rules in AGENTS.md need no copy in CLAUDE.md.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.277)

### claude.ai skills and plugins sync to the terminal
2026-09-17 · v2.1.275 · Plugins

The skills and plugins that you enable on your claude.ai account now also load in terminal sessions with that sign-in. Turn it off with `syncClaudeAiSkills: false` or `syncClaudeAiPlugins: false`.

**Why here:** Skills from the account appear next to the skills from `install.sh`. Check for skills with the same job.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.275)

### claude plugin eval
2026-09-11 · v2.1.269 · Plugins

Runs the eval suite of a plugin against Claude Code and gives scored, repeatable results as JSON and HTML. v2.1.299 added `--disallow-tools`.

**Why here:** Test that a skill triggers on the right words and that a mod does its job, before a release.

[Source](https://code.claude.com/docs/en/plugin-evals)

### --plugin-dir loads a folder of plugins
2026-09-08 · v2.1.265 · Plugins

`--plugin-dir` can point at a folder of plugins. Each child folder with a manifest loads, and Claude Code finds children that you add or remove while it runs.

**Why here:** `claude --plugin-dir mods` loads all mods of this repo from a worktree to test them before install.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.265)

### /skill-doctor
2026-09-04 · v2.1.261 · Claude Code

Shows which loaded skills you do not use and what they cost in context, so you can remove them.

**Why here:** This setup loads many skills from the repo, plugins and the account. Use it to keep the list short.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.261)

### Diff panel
2026-09-03 · v2.1.260 · Claude Code

In fullscreen mode a panel beside the conversation shows your uncommitted changes as Claude edits. Toggle it with `/diff`.

**Why here:** Watch the changes in a worktree before a commit.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.260)

## August 2026

### Continue at usage limit reset
2026-08-17 · v2.1.234 · Claude Code

Claude Code continues your session when a claude.ai usage limit resets. Turn it off in `/config`.

**Why here:** Long runs of the dispatcher continue after a limit with no restart.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.234)

### Cross-session messaging
2026-08-07 · v2.1.224 · Claude Code

Claude Code sessions can message each other on your machines with `SendMessage`, and find each other with `ListAgents`. v2.1.236 added `notify_when_idle`, and v2.1.248 added Bedrock, Vertex and Foundry. `crossSessionInbound` controls what a session accepts.

**Why here:** The `paralel` skill and the `session-relay` mod can coordinate sessions with no shared file.

[Source](https://code.claude.com/docs/en/cross-session-messaging)

## July 2026

### /code-review runs in the background
2026-07-22 · v2.1.215, v2.1.218 · Claude Code

`/code-review` runs as a background subagent, so the review does not fill the conversation. Claude does not start `/verify` or `/code-review` by itself; you type them.

**Why here:** The PR flow of this setup must call `/code-review` itself.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.218)

### /fork makes a background session
2026-07-17 · v2.1.212 · Claude Code

`/fork` copies the conversation into a new background session with its own row in `claude agents`. The old in-session subagent is now `/subtask`.

**Why here:** Split a side task from a long session and keep both.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.212)

### Background agents notify and open draft PRs
2026-07-01 · v2.1.198 · Claude Code

Sessions in `claude agents` fire the `Notification` hook when they need input or finish (`agent_needs_input`, `agent_completed`). When they finish code work in a worktree, they commit, push and open a draft PR.

**Why here:** A notification hook can show which lane needs you. Know that background agents push by themselves.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.198)

## June 2026

### Claude Tag
2026-06-23 · News

Claude joins Slack as a team member. Anyone in a channel can tag @Claude to give it a task. Beta for Team and Enterprise.

**Why here:** A team channel can give work to Claude with the same tools as Claude Code.

[Source](https://www.anthropic.com/news/introducing-claude-tag)

### Permission rules on tool parameters
2026-06-15 · v2.1.178 · Permissions

`Tool(param:value)` rules match the input of a tool, with `*` as a wildcard. Example: `Agent(model:opus)` blocks Opus subagents.

**Why here:** Enforce the model policy of the `paralel` skill with a permission rule.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.178)

### Safe mode, /cd and bundled skills off
2026-06-08 · v2.1.169 · Claude Code

`--safe-mode` starts with all customizations off (CLAUDE.md, plugins, skills, hooks, MCP). `/cd` moves a session to a new directory with no cache loss. `disableBundledSkills` hides the bundled skills from the model.

**Why here:** Use safe mode to find a broken mod. Use `/cd` to move a session into its worktree.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.169)

## May 2026 (from 2026-05-24)

### Dynamic workflows
2026-05-28 · v2.1.154, v2.1.160 · Claude Code

Claude writes a script that runs tens to hundreds of agents in the background. `/workflows` shows the runs. From v2.1.160 the trigger word is `ultracode`, and from v2.1.284 Ultracode is its own switch in `/effort`. The "Dynamic workflow size" setting (v2.1.202) sets how many agents a run uses.

**Why here:** Large reviews and migrations across many repos, next to the `paralel` skill.

[Source](https://code.claude.com/docs/en/workflows)

### /simplify and /code-review --fix
2026-05-28 · v2.1.152, v2.1.154 · Claude Code

`/code-review --fix` applies the findings to the working tree. `/simplify` runs a cleanup-only review (reuse, simplification, efficiency) and applies the fixes.

**Why here:** Two steps for the PR flow: find bugs, then clean up.

[Source](https://github.com/anthropics/claude-code/releases/tag/v2.1.154)

## In the docs, no release date found

These items are in the Claude Code docs, but no changelog line in the window names them.

### /ship and /steward
Docs · Claude Code

`/ship` opens a GitHub PR for the branch if it has none, reviews the change, then works on feedback and failing checks. `/steward` does the same work on an open PR with no review. Both run only in the CLI, in a local clone.

**Why here:** Compare them with the `ship` mod and the `ship-mod` skill of this repo before you change either.

[Source](https://code.claude.com/docs/en/ship-command)

### Claude Ship: Code Review, PR Steward and Claude Approvals
Docs · Claude Code

Agents for GitHub pull requests: Code Review finds issues, PR Steward fixes feedback and failing checks, Claude Approvals checks a PR against a policy that you write. Team and Enterprise plans.

**Why here:** An organization-level option for the work that `pr-sweep` and `merge-when-green` do locally.

[Source](https://code.claude.com/docs/en/claude-ship)

### Artifacts from Claude Code
Docs · Claude Code

Claude Code publishes live pages to a private claude.ai URL that you can share. The changelog has Artifact tool changes from v2.1.260 (2026-09-03).

**Why here:** This digest and the Work Monitor are published as artifacts.

[Source](https://code.claude.com/docs/en/artifacts)
