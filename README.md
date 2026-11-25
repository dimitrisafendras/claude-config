# claude-config

A Claude Code setup in two layers, two repos:

- **Core** (this repo, public): `claude/`, `mods/`, `routines/`, `install.sh`. Generic and white-labeled: it has no company, person or project names, and `tests/core-clean.sh` enforces this in CI. Use it as it is in every project, or fork it.
- **Profile** (your private repo): what is yours or your company's: rules, extra skills, ticket sources, mods, permissions, the URLs of your pages. `profiles/example/` in this repo shows the layout. Install yours by path: `./install.sh --profile ~/Projects/my-profile`.

## How the two repos connect

```
~/Projects/claude-config        public core      ──install.sh──▶  ~/.claude/  (links and merged settings)
~/Projects/my-profile           private profile  ──install.sh --profile <path>──▶  ~/.claude/  (profile.md, skills, start-work.d, settings)
```

- `install.sh` records the profile (a name under `profiles/`, or a path) in `~/.claude/claude-config.profile`. Later runs, `/start-work`, `/setup-audit` and `prefs-sync` read that file, so the profile can live in any repo.
- `install.sh` also records the path of the main checkout in `~/.claude/claude-config.repo`. `/start-work` and `/setup-audit` find the repo there, so the repo can be in any folder.
- The profile's mods come from its own `.claude-plugin/marketplace.json`; `./install.sh --mods` installs the core's and the profile's.
- A profile with a `sync.sh` can copy skills from a source repo of yours; the audit runs `sync.sh --check`.
- Nothing in the core points at a private repo. The link is only the recorded profile path on each computer.

## Overview

| Part | Where | What |
|---|---|---|
| Answer format | `claude/CLAUDE.md`, `claude/output-styles/ste.md` | All answers in ASD-STE100 Simplified Technical English |
| Profile rules | `profiles/<name>/profile.md` | Linked to `~/.claude/profile.md`; the core `CLAUDE.md` imports it |
| Settings | `claude/settings.json` (+ the profile's `settings.json`) | Plugins, output style, effort, permissions; merged on install |
| Start the day | `claude/skills/start-work` | `/start-work`: housekeeping of every project in `~/Projects`, inbox (PRs, plus extra sources from the profile), one plan, lanes, Work Monitor |
| Watch and ship | `claude/skills/monitor`, `deploy`, `pr-sweep` | `/monitor`: sessions, PRs with CI, deploys. `/deploy`: wait for staging, test, report how far it got. `/pr-sweep`: fix comments, conflicts, red CI |
| Merge | `claude/skills/merge-when-green` | `/merge-when-green`: merge one PR when CI is green; waits with ci-watch, stops on red CI, a conflict, a draft or requested changes |
| Ship | `claude/skills/ship-mod` | `/ship-mod`: commit, push, PR, merge on green, pull main and install the mods |
| Browser | `claude/skills/start-browser`, `test-in-chrome` | `/start-browser`: check the Chrome bridge, open one tab for this session. `/test-in-chrome`: run a test plan in the real Chrome and report pass or fail per step with evidence |
| Clean | `claude/skills/cleanup` | Remove dead worktrees, archive finished sessions |
| Repo care | `claude/skills/setup-audit` | `/setup-audit`: read-only audit of this repo |
| Preferences sync | `claude/skills/sync-prefs`, `claude/scripts/prefs-sync.sh`, `routines/prefs-sync.md` | `/sync-prefs`: one way, local to repo. Your `settings.json` keys, the button row, the project files and the desktop app preferences go to one PR on `prefs/sync`. Never merges, never changes local files |
| Desktop app settings | `claude/desktop-settings.json` | A snapshot of the Claude desktop app preferences (auto-archive, branch prefix, notifications, keep-awake). The installer does not apply it: ask Claude to apply it with the app's settings tool |
| Cheat sheet | `mods/cheatsheet` | `/cheat` and a button row above the prompt |
| Routines | `routines/` | Prompts for scheduled tasks: nightly-cleanup, morning-prep, weekly-setup-audit, weekly-claude-releases, prefs-sync, project-daily |
| Claude releases | `docs/claude-releases.md`, `docs/claude-releases-improvements.md`, `docs/claude-releases-proposals.md`, `routines/weekly-claude-releases.md` | A digest page with three tabs: **Releases** (the big Claude features and workflow changes, by month, newest first), **Improvements** (the updates that were merged to this setup) and **Proposals** (changes that the releases suggest, with the gain and the risk). The weekly routine updates all three, republishes the artifact (URL in `docs/claude-releases-url`) and opens one PR |
| CI | `.github/workflows/ci.yml`, `tests/` | Three jobs run: `checks` and `mods` in parallel, then the gate `check`. `checks` runs on Linux and on Windows: shell syntax, JSON, skill frontmatter, and every `tests/*.sh` except `mods.sh` (shellcheck runs on Linux only). A new test file runs with no change to the workflow. The tests are `install-check`, `audit-link`, `list-projects`, `prefs-sync`, `morning-project`, `core-clean`, `mem-budget`, `merge-when-green` and `inventory`. `inventory` fails when a skill, mod, routine, script or test file is not named here. `mods` runs on Linux: it runs `tests/mods.sh`. `check` is the one gate that `main` requires: it fails unless `checks` and `mods` both succeed. A new push cancels the old run of a pull request |
| Agents | `claude/agents/pr-reviewer.md` | The one custom subagent |

## The flow of a change

1. `/start-work` picks the work. `/paralel` (or a profile dispatcher) runs it in lanes.
2. `/ship` commits, pushes, opens the PR and hands it to ci-watch. In a lane or a skill, the tool `mcp__ship__ship` does the same.
3. ci-watch starts a turn on red CI or a conflict. `/pr-sweep` fixes the PRs that need work.
4. `/merge-when-green` merges the PR. `/deploy` checks the release.
5. `/cleanup` removes the worktree and archives the session.

`/ship-mod` does steps 2 and 4 for a change to this repo, then installs it.

## New computer

1. Clone this repo to `~/Projects/claude-config`. Clone your profile repo next to it, for example `~/Projects/my-profile`. Another folder also works, because `install.sh` records the path.
2. Run `./install.sh --profile ~/Projects/my-profile` from the main checkout (it stops in a worktree). With no profile, run `./install.sh`. The profile is recorded in `~/.claude/claude-config.profile`, so later runs reuse it. `--no-profile` goes back to the core only.
3. Restart Claude Code, then run `./install.sh --check`.
4. Sign in to the MCP servers that you need with `/mcp`.
5. Run `/start-work`.

## Projects

Nothing lists your projects. `claude/scripts/list-projects.sh` finds every git repo in `$PROJECTS_DIR` (default `~/Projects`) and reads its surfaces (web, mobile, backend, infra, docs) from the files. A new clone shows up at once. `~/.claude/projects.conf` is optional: `<folder> <surfaces> [board]` overrides a folder, `!folder` hides one, and `board` marks the project that owns the ticket board.

## Extra sources for /start-work

Each file in `~/.claude/start-work.d/` is one source (a ticket board, an error tracker): how to check its connection, how to collect rows, how to classify them. The core ships none. A profile ships its own in `start-work.d/` and `install.sh` links them. `profiles/example/start-work.d/tracker.md` is a template.

## Make your own profile

1. Make a private repo, for example `my-profile`, and copy `profiles/example/` into its root. Remove what is not yours. Its README says what goes in a profile and what stays in the core.
2. Keep the same layout: `profile.md` (rules for `CLAUDE.md`), `settings.json` (extra permissions and plugins), `projects.conf`, `merge-policy.json` (optional: the merge rules of the `merge-policy` mod), `skills/`, `start-work.d/` (extra sources), `mods/` with its own `.claude-plugin/marketplace.json` (give it a name of its own), optional `sync.sh` and `docs/`.
3. `./install.sh --profile ~/Projects/my-profile`. Files you edit later (`projects.conf`, `work-monitor-url`, `cheat-sheet-url`, `cheat-buttons.json`, `merge-policy.json`) are copied once and never overwritten.
4. `--no-profile` returns to the core and removes the profile's links. It leaves `~/.claude/merge-policy.json` in place, like the other copied files, so the permission stays until you delete or edit the file. While the profile holds a `merge-policy.json`, a later `install.sh` run copies it again if the local file is missing. To remove the permission, delete the file from the profile too, or keep the local file with an empty `"repos": {}`.
5. A profile inside this repo also works (`profiles/<yours>/`, installed by name), for a private fork.

## Plugins

Only plugins from `claude-plugins-official`. A plugin that must stay off is `false` in `settings.json` (not left out), so the merge turns it off.

## Mods

`mods/` holds seventeen function-hook mods. `.claude-plugin/marketplace.json` lists them, so this repo is a local marketplace.
A plain `./install.sh` does not install them. `./install.sh --mods` does. Each mod has tests: `claude plugin test mods/<name>`.
`bash tests/mods.sh` runs `claude plugin validate --strict` and `claude plugin test` on each mod, and CI runs it too. Each `plugin.json` states the lowest Claude Code version that the mod needs in `engines["claude-code"]`.

| Mod | What it does | Commands |
|---|---|---|
| automodel | Sets the model and effort for each turn, and for each subagent and workflow agent that has no model. Plain rules place most prompts at 0 tokens; haiku is called only when the rules are unsure, and never in a long conversation. A cache guard limits model changes | `/automodel on\|off\|status\|map` |
| verify-gate | A session may not finish while its check command fails: after a turn that edited files it runs the check, and a failure starts another turn with the output (3 tries, then it stops and reports). Inert until a check is set. A repo's `.claude/verify.sh` runs only after you approve it with `/verify-gate set file`, and never after its text changes | `/verify-gate status\|set\|run\|on\|off\|clear` |
| ci-watch | Watches the checks of each pushed PR; red starts a turn (the option `fix_turns` = `off` keeps only the notification, for use with the desktop app Auto-fix); green with auto-merge on starts the merge turn; refuses sleep-poll loops. The tool `mcp__ci-watch__watch` takes `auto_merge` | `/ci-watch list\|add\|remove\|auto-merge\|allow-poll` |
| merge-policy | Answers the permission check for `gh pr merge` from `~/.claude/merge-policy.json`: allow or deny by the rules, and a person must approve every other merge; inert with no file | `/merge-policy status\|test` |
| ops-board | Pane and summary of agents, tasks and open PRs with CI state | `/ops`, `/ops-status` |
| context-keeper | Keeps the task state through a compaction | `/keep show\|add\|clear` |
| repo-guard | Warns about a stale branch; refuses a commit on the default branch | `/repo-guard status\|on\|off` |
| fail-hints | Adds the known fix to a failed tool result | `/fail-hints stats` |
| memory-governor | Refuses heavy agents and jobs when `mem-budget.sh` says no room | `/memgov on\|off\|status` |
| ship | Commit, push, PR and hand-off to ci-watch; obeys repo attribution rules; never merges itself. `--auto-merge` (or the mod option `auto_merge: on`, set with `/plugin configure ship@claude-config`) asks ci-watch to merge the PR on green, per the repo rules in `~/.claude/merge-policy.json`. The tool `mcp__ship__ship` does the same run for skills and lanes, with an optional PR `title`, `body`, `draft` and `auto_merge` | `/ship [--dry-run] [--auto-merge] [hint]` |
| connect-doctor | Checks MCP servers and `gh auth` at session start | `/mcp-doctor` |
| skill-router | Matches a prompt to one of your skills and tells the model to load it | `/skill-router status\|on\|off\|reload\|why` |
| browser-keeper | Adds the fix to a failed browser call; reports a sign-in page; stops retry loops | `/browser-keeper status\|on\|off` |
| session-relay | Reports a message that did not arrive and a hook call that timed out | `/relay-status` |
| cheatsheet | `/cheat` lists your skills from the live skill files, with the cheat sheet link. A row of buttons above the prompt fills (or, with `"send": true`, runs) your main commands. An optional `"hint"` shows under a button while the pointer is over it. Edit `~/.claude/cheat-buttons.json` (example in the mod folder) | `/cheat [word\|show\|hide\|reload]` |
| flow-view | A dashboard pane for the work day. **Today**: the phases of the `/start-work` plan (read from its Work Monitor writes), five counts (running, in review, done, needs you, queued) that filter the ticket list, and the tickets as rows, sorted by need, with the PR and the CI mark; a press on a row opens its breakdown into session, agents and PR. **Sessions**: a row for each session that runs the mod, running ones first, with a toggle for only those that run; a press opens its steps with durations and its run graph of agents and subagents. A subsession is not linked to its parent | `/flow [tickets\|sessions\|status\|clear\|demo\|help]` |
| custom-themes | The custom themes of this setup on one card, like the `theme-examples` plugin: **Christmas Night** (a snowy village under a moon and a faint aurora, with a decorated tree, pines, an A-frame cabin, small houses, a robin on a sign that shows the context fill, and snow on the ground, the trees and the roofs that rises as the context window fills and falls after `/compact` or `/clear`; frosted glass and cards under the messages keep the text easy to read) **Pixel Blue** (a pixel night sky with Orion, more stars as the context fills; blue colors for dark and light mode; two terminal themes for `/theme`) and **Pokémon Pixel** (a sunny pixel route of a handheld monster game, in original art: a battle box shows the context as HP, and wild creatures come out of the tall grass as it fills). A theme applies to all projects (saved) or to this session; a preview lasts 20 seconds | `/themes [<name> [session]\|list\|off\|preview <name>]` |

The `merge-policy` file gives permission to merge with no prompt, so only its owner writes it. The core ships no real policy. To make it, copy the example and edit it. These commands never overwrite a file that is there. On macOS, Linux and Git Bash: `[ -e ~/.claude/merge-policy.json ] || cp mods/merge-policy/merge-policy.example.json ~/.claude/merge-policy.json`. On Windows in PowerShell: `if (-not (Test-Path "$env:USERPROFILE\.claude\merge-policy.json")) { Copy-Item mods\merge-policy\merge-policy.example.json "$env:USERPROFILE\.claude\merge-policy.json" }`. The example names a fake repo: replace it with your own repos before you rely on it. Or put `merge-policy.json` in your profile: `install.sh` copies it once, and never overwrites it. `--no-profile` leaves the file in `~/.claude/`, so the permission stays until you delete or edit the file. While the profile holds the file, a later `install.sh` run copies it again if the local file is missing. To remove the permission, delete the file from the profile too, or keep the local file with an empty `"repos": {}`.

Known limits: ci-watch refuses `merge-when-green.sh` (use `/ci-watch auto-merge`, or `/ci-watch allow-poll on`). `ship` runs git with repo hooks off.
automodel and memory-governor have no fixed hook sequence on `agent.spawn`.

## Install

```bash
./install.sh
```

`install.sh` does these steps:

1. It adds each marketplace in `claude/settings.json` (`extraKnownMarketplaces`).
2. It installs or switches on each plugin that is `true` in `enabledPlugins`.
3. It merges `claude/settings.json` (and the profile's `settings.json`) into `~/.claude/settings.json`. The repo values win, but the permission
   allow lists are joined, so local permissions stay. The old file goes to `settings.json.bak-install`.
4. It links these files from the repo into `~/.claude`: `CLAUDE.md`, the ASD-STE100 output style,
   every skill folder in `claude/skills/` and in the profile, `profile.md`, the profile's `start-work.d` files, the agent `pr-reviewer` and the scripts in `claude/scripts/`.
   A real file at a target goes to `~/.claude/backups/install-<date>/` first.
5. It writes the path of the main checkout to `~/.claude/claude-config.repo`.

Because of the links, a change in this repo applies at once, and the links serve the branch of the main checkout. Keep it on `main`.

`./install.sh --check` changes nothing. It lists each setting, permission, plugin and link where `~/.claude`
is different from the repo, a checkout that is not on `main`, and a missing or wrong `~/.claude/claude-config.repo`. Exit 1 means drift. `/start-work` runs it each morning.

## Answer format: ASD-STE100

`claude/CLAUDE.md` and the output style `claude/output-styles/ste.md` tell Claude to write all answers
in ASD-STE100 Simplified Technical English. `settings.json` sets `"outputStyle": "ASD-STE100"`.
The caveman plugin and its marketplace are not in the settings, because caveman mode removes articles and STE needs them.

## Layout

| Path | Content |
|---|---|
| `claude/skills/` | Generic skills. `~/.claude/skills` links to these folders; a new folder needs no list. |
| `claude/agents/` | `pr-reviewer`, the one user-level subagent |
| `claude/scripts/` | statusline-command.sh, merge-when-green.sh (`-R owner/repo`, `-m method`), mem-budget.sh, list-projects.sh |
| `claude/settings.json` | Settings that `install.sh` merges into `~/.claude/settings.json` |
| `profiles/example/` | The layout of a profile: `profile.md`, `settings.json`, `projects.conf`, `skills/`, `start-work.d/`, `mods/`, optional `merge-policy.json`, `sync.sh` and `docs/`. Your real profile is a private repo with this layout |

