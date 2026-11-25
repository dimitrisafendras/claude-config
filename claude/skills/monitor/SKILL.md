---
name: monitor
description: One view of everything that runs and waits, read-only: your sessions and agents, open PRs with CI state, deploys in flight, merged work not yet closed in the ticket tracker. Use for "/monitor", "status", "what is running", "what is waiting on me", "how are my PRs", "is it done".
argument-hint: "[repo] (optional, limits the view)"
model: haiku
effort: low
---

# Monitor

Answer "what is going on" in one table. Read only. Do not start, stop, merge or fix anything.

## Rules

- **Read-only.** No merges, pushes, reruns, archives. Say what to run next instead.
- **No polling loops.** Take one reading. For a change that needs watching, point to `ci-watch` (`/ci-watch add <pr>`), which starts a turn when CI changes.
- Say what you could not read. Do not guess a state.

## Steps

1. **Sessions and agents.** If the `ops-board` mod is on, run `/ops-status`. Else call `mcp__ccd_session_mgmt__list_sessions` with `linked: true` and list each one: title, running or idle, PR, last activity.
2. **PRs.** `gh search prs --author @me --state open --json number,title,repository,url,updatedAt --limit 50`. For each updated in the last 7 days: `gh pr view <n> -R <repo> --json statusCheckRollup,mergeable,reviewDecision`. Verdict: red, conflict, changes requested, pending, green.
3. **Deploys in flight.** For each PR merged in the last 24 hours: `gh run list -R <repo> --commit <sha> --json name,status,conclusion,url`. Show the deploy run state.
4. **Done but not closed.** For each merged PR with a ticket id in the title or branch (the extra sources in `~/.claude/start-work.d/` say what an id looks like and how to read its state), check that the ticket is closed. Skip this step when no extra source is installed. List the ones that are not.
5. If `$1` names a repo, keep only its rows.

## Report

First line: counts (running, waiting on you, red, deploying). Then one table: what, state, link. Then **Next**, one line for each row that needs action:

- red or conflict PR → `/paralel` (fix it) or `/pr-sweep`
- merged and deploying → `/deploy <pr>`
- merged and done → `/cleanup`
