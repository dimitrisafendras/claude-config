# Improvements to this setup

The updates that we made to this setup (skills, mods, routines, settings), each with the pull request and, where there is one, the item of the Claude releases digest that it came from. Months are newest first. The weekly routine adds the pull requests that were merged since its last run.

Last update: 2026-11-25 (custom-themes)

## November 2026

### Proposals applied: routine prompts, a mod smoke test, /skill-doctor
2026-11-25 · PR #54 · Routines

Three proposals of the digest, applied. `routines/README.md` says to set the permission mode of each scheduled task in the app, and each routine writes a denied call in its report (`denyInsteadOfPrompting` stays off: it is a global setting). `ship-mod` step 4b smoke-tests a changed mod with `claude --plugin-dir mods/<mod> -p`. The weekly setup audit runs `/skill-doctor` and reports unused skills and plugins.

Digest items: [Deny instead of prompting](https://github.com/anthropics/claude-code/releases/tag/v2.1.319), [--plugin-dir loads a folder of plugins](https://github.com/anthropics/claude-code/releases/tag/v2.1.265), [/skill-doctor](https://github.com/anthropics/claude-code/releases/tag/v2.1.261).

**Why here:** A scheduled run no longer stalls on a prompt by design, a changed mod is tried live before a merge, and the weekly report names the skills that cost context for nothing.

[Source](https://github.com/dimitrisafendras/claude-config/pull/54)

### custom-themes: both themes on one card
2026-11-25 · PR #56 · Mods

The `pixel-blue` and `christmas-night` mods become one mod, `custom-themes`, with a card like the one of the `theme-examples` plugin: `/themes` lists the themes with Apply, This session and Preview buttons. A choice for the project is saved; a choice for the session is not. The band above the prompt and the spinner mark of `pixel-blue` go.

**Why here:** One place to pick a look, the same way as the official examples, and one mod to keep instead of two.

[Source](https://github.com/dimitrisafendras/claude-config/pull/56)

### christmas-night: a theme mod with a snow ground that follows the context
2026-11-25 · PR #55 · Mods

A new mod. Snowy pine trees with lights under a moon and stars, falling snow, and a snow ground that rises as the context window fills and falls after `/compact` or `/clear`. Frosted glass and cards under the messages keep the text easy to read. `/xmas on|off`.

Digest item: [Mods can set a backdrop and the color scheme](https://code.claude.com/docs/en/plugins/mods/interface#put-a-backdrop-behind-the-conversation).

**Why here:** The second mod on the backdrop API, and the first with glass and message cards for legibility.

[Source](https://github.com/dimitrisafendras/claude-config/pull/55)

### flow-view: ticket sorting, PR and CI marks, the /flow command
2026-11-25 · PR #51 · Mods

A set of 92 small changes to the Workflow pane. Tickets sort by need, show the PR and a CI mark, and filter by five count tiles. Running sessions come first and a toggle shows only those. Cards show the model, failed calls and the last tool. A failing store can no longer break a turn. `/flow` takes `tickets`, `sessions`, `status`, `clear` and `help`.

**Why here:** The pane is the one place that shows the day. It now says what needs you first.

[Source](https://github.com/dimitrisafendras/claude-config/pull/51)

### Mods and CI: a person approves, engines ranges, strict checks
2026-11-24 · PR #50 · Mods

`merge-policy` answers a merge that its file does not settle with `decider: "person"`, so only a person can approve it. Each mod has an `engines` range. `tests/mods.sh` runs `claude plugin validate` and the tests of every mod in CI. `ci-watch` has an option, `fix_turns`, that stops its fix turns.

Digest item: [Mods can require a person to approve](https://github.com/anthropics/claude-code/releases/tag/v2.1.304) (v2.1.304).

**Why here:** A merge that no rule allows cannot pass in auto mode, and a broken mod fails CI before a merge.

[Source](https://github.com/dimitrisafendras/claude-config/pull/50)

### pixel-blue: a theme mod with a night-sky backdrop
2026-11-24 · PR #49 · Mods

A new mod. It sets blue colors, draws a pixel night sky with Orion as the backdrop of the Desktop app (more stars as the context window fills, fewer after `/compact`), and adds the themes "Pixel Blue Dark" and "Pixel Blue Light" for the terminal.

Digest item: [Mods can set a backdrop and the color scheme](https://code.claude.com/docs/en/plugins/mods/interface#put-a-backdrop-behind-the-conversation).

**Why here:** The first mod that reads `$.session.usage()` to show the context window as a scene.

[Source](https://github.com/dimitrisafendras/claude-config/pull/49)

### paralel and automodel: an effort level for each agent
2026-11-24 · PR #48 · Skills

The sizing rubric of `paralel` has an effort next to each model, and the dispatcher passes `effort` on each `Agent` call. The `automodel` mod handles workflow agents like other subagents and sets the effort of a subagent on its steps.

Digest item: [Effort for each subagent](https://github.com/anthropics/claude-code/releases/tag/v2.1.292) (v2.1.292).

**Why here:** Small agents no longer run at the effort of the session.

[Source](https://github.com/dimitrisafendras/claude-config/pull/48)

### Weekly digest of Claude releases
2026-11-24 · PR #47 · Routines

A Monday routine that reads the changelog, the docs, the newsroom and the platform release notes, adds the big features and workflow changes to the digest, and republishes its page. It also writes proposals and an upkeep check. The 6-month backfill is in the digest.

**Why here:** New Claude features reach this setup within a week, without a manual search.

[Source](https://github.com/dimitrisafendras/claude-config/pull/47)

### /ship as a tool for skills and lanes
2026-11-24 · PR #46 · Mods

The `ship` mod registers the tool `mcp__ship__ship`, the same run as `/ship`, because a skill cannot type a slash command. It takes an optional PR title, body and draft flag. `paralel`, `ship-mod` and `merge-when-green` use it. The README has a section on the flow of a change.

Digest item: [/ship and /steward](https://code.claude.com/docs/en/ship-command).

**Why here:** A lane opens its PR in one call, and the repo rules on AI attribution still apply.

[Source](https://github.com/dimitrisafendras/claude-config/pull/46)
