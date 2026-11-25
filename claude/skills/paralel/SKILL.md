---
name: paralel
description: Run work in parallel without collisions. The coordinator plans first — one new session per ticket or unique task by default — sized to free memory. Each session runs sized agents (haiku, sonnet, opus + effort) on sub-branches, with a reviewer per sub-branch and worktree cleanup. Use for "/paralel", "/parallel", "/start-agents-dev", "do it in parallel", "dispatch this", "agent for this", "keep spawning agents", "fan out", "spawn sessions and subagents", or an epic or several tickets.
argument-hint: "<task, ticket id(s) or URL, or epic> [sessions=N | single] | status"
---

# Paralel

A project can have its own dispatcher skill. Its extra source file in `~/.claude/start-work.d/` names it on a line `Dispatcher`. Use that skill instead: it runs this skill with the project's rules.

Once invoked, this stays on for the session. This session is the **dispatcher**: it sizes each request, sends it to a background agent and answers the user at once. It does not do the work. It owns the branches and the merges.

## Hard rules

1. **Never work on `main` directly.** Nothing is tested on `main`.
2. **One feature branch, one worktree and one draft PR to `main` per main task** (`.claude/worktrees/<topic>`, `feature/<topic>`).
3. **Agents work on sub-branches** (`feature/<topic>--<sub>`, own worktree), push, and **never open a PR**.
4. **A separate reviewer agent checks each sub-branch** before it merges. Never the author.
5. **The dispatcher merges** the sub-branch into the feature branch, pushes, and **in the same turn removes it**: `git merge-base --is-ancestor` for the remote and local tip (stop if either fails), `git worktree remove` (never `--force`), `git branch -d` (never `-D`), delete the remote sub-branch.
6. **Memory budget:** run `bash ~/.claude/mem-budget.sh` before every spawn and every heavy job (full suite, `npm ci`, dev server, simulator). Exit 1 means wait. At most 4 active sessions on 24 GB, agents per session come from the plan (`references/plan-the-fan-out.md`), never more than the room allows.
7. Outward actions, attribution and Docker: `references/guardrails-detail.md`. Never kill or remove what you did not start.

## Step 0: plan the fan-out

Before the first dispatch, the coordinator plans the fan-out. By default every ticket and every unique task gets its own new session, and each session gets as many agents as it has independent subtasks. Read `references/plan-the-fan-out.md`, print the plan in one block and act. Do not wait for approval, except where that file says to ask. A lane session skips this step.

## One session for the user

The user manages **one** session: this one. Lane sessions are internal. A lane never asks the user anything; it messages the coordinator, who answers or relays one question. The coordinator reports every lane's state here, and the user never has to open a lane. Details: `references/plan-the-fan-out.md`.

## Which mode

| Work | Mode |
|---|---|
| Each ticket or unique task (the default) | One nested session per task, each running `/paralel` as a lane with its own agents; this session coordinates (`references/lanes.md`) |
| A lane whose work must be seen running (web or mobile UI) | The lane runs `start-web-dev` or `start-mobile-dev` first, then works as a lane (`references/plan-the-fan-out.md`, 3b) |
| Items on the same files, a trivial task, `single`, or no memory room | Stay in this session with agents only, or queue the session |

## Core loop

1. **Size cheaply, yourself:** fetch the ticket, one `gh pr view`, or one grep. Do not read the codebase.
2. **Pick the lowest model tier that fits and its effort** (`haiku`/`low`, `sonnet`/`medium`, `opus`/`high`), with a one-clause reason. Size each subtask on its own.
3. **Place it:** a code task goes on a sub-branch. An agent on the same ticket gets a `SendMessage`. Parallel agents get disjoint paths.
4. **Spawn** with `Agent`, `run_in_background: true`, an explicit `model`, an explicit `effort` and the prompt template.
5. **Tell the user in one line** (what, model and effort, branch, why). Take the next request.
6. **Review**, then merge and remove the sub-branch (rule 5). The lane then opens its PR and fixes it until CI is green (`references/keep-it-running.md`, 7).
7. **Relay the outcome** with evidence. Check "green" or "merged" with one call first.
8. **Escalate one step only on evidence:** first the effort, then the tier.
9. **After a merge, deploy and verify:** the `deploy` skill starts by itself from `ci-watch`; a ticket is done only after `verified` (`references/keep-it-running.md`, 4).
10. **Clean up at the end:** sweep orphan worktrees, remove merged lane worktrees and branches, stop what you started, offer to archive the lane sessions (`references/lanes.md`, Phase 5; `references/cleaning-up-worktrees.md`).

Reprint the ledger table on every state change (`references/dispatch-loop.md`) and write it to the ledger file first, so a crash or a compaction cannot lose it. Keep the ticket board current.

Each lane has done criteria and a check that it must pass (`keep-it-running.md`, 6). Lanes never wait for the user, a silent or dead lane gets one check and one restart, and the installed mods (`ci-watch`, `memory-governor`, `merge-policy`, `ops-board`) do their part: `references/keep-it-running.md`.

## Lane loop

Each lane is a loop with no person in it: work → PR → reviewer → fix red CI and conflicts (at most 3 automatic tries for each PR) → merge on green under `merge-policy` → deploy check → verify on staging → close the ticket → `cleanup`. `ci-watch` wakes the lane at each CI event. Each lane writes the `next` field of its ticket row (up to 90 characters: what happens next and when). Each lane ends `done` or `needs-you`. Check the kill switch first (`bash ~/.claude/autonomy.sh check`). Stages and limits: `references/lane-loop.md`. A person is still needed for: a production release (a release tag), any message to other people, money, secrets, sign-ins and destructive data actions. These only become decision records. `/autonomy run lane <ticket>` runs one lane loop now.

## Decisions

A lane that cannot go on writes one decision record (JSON) in its ticket and in its report, then ends `needs-you`:

```json
{"id": "d-0001", "ticket": "SN-123", "question": "Release v1.4 to production?", "options": ["release now", "wait"], "default": "wait", "deadline": "2026-11-26T09:00:00Z", "reversible": true}
```

- `id`: a unique string. `ticket`: the ticket id or `null`. `options`: two strings. `default`: one of the options. `deadline`: an ISO time. `reversible`: true or false.
- A reversible record takes its `default` at the `deadline`. An irreversible one never does: it waits for a person.
- Write a production release, a message to other people, money, secrets, sign-ins and destructive data actions as irreversible. Never take them by default.
- The flow-view mod shows open records in its Decisions card.

## `/paralel status`

With the argument `status`, dispatch nothing and plan nothing. If this session has no ledger, load the ledger file and check it against the facts. Print the ledger table, then show what the rest of the setup knows: run the `monitor` skill's view (sessions and agents, open PRs with CI, deploys in flight, merged work not closed in the ticket tracker). Join the two: add each lane's PR CI state from the monitor to its ledger row. End with the one next action that needs the user, or "nothing needs you". With no ledger yet, print "no lanes started" and give the monitor view alone.

## References

- `references/plan-the-fan-out.md`: the step 0 decision: stay or start sessions, agents per session. Read first on every request.
- `references/keep-it-running.md`: lane permission mode and refused actions, the ledger file and resume, silent and dead lanes, deploy after merge, the mods, the check of each lane, the PR and CI loop. Read when you start the first lane and when a lane stops, goes silent or merges.
- `references/dispatch-loop.md`: the full loop and the ledger format. Read on the first dispatch.
- `references/sizing-tiebreakers.md`: the rubric with the effort of each tier, tie-breakers, agent types. Read when you size a task.
- `references/prompt-template.md`: the agent prompt. Read before every spawn.
- `references/review-protocol.md`: reviewer size, input, findings. Read before each reviewer.
- `references/branches-and-worktrees.md`: feature branch, sub-branches, merging, hot files. Read before the first branch.
- `references/cleaning-up-worktrees.md`: removal commands, refusals, wind-down sweep. Read before the first merge and at wind-down.
- `references/lane-loop.md`: the lane loop: stages, limits, `next`, the end states. Read when a lane starts or wakes.
- `references/finishing-ci-and-merge.md`: leaving draft, watching CI, admin-merge to `main`. Read when CI runs or a merge is near.
- `references/keep-the-board-current.md`: ticket statuses and comments (canonical). Read when a ticket is involved.
- `references/guardrails-detail.md`: guardrails that never relax. Read before the first prompt and any outward action.
- `references/lanes.md`: gather, cut lanes, start sessions, relay shared contracts, close. Read for several lanes.
- `references/memory-budget.md`: costs, script, limits. Read before you start sessions.
- `references/why-this-exists.md`: why sizing, branches and lanes. Read when asked why.

## Next

- `/monitor`: watch what runs.
- `/deploy`: merge, deploy, verify, release.
- `/cleanup`: remove merged worktrees and archive finished sessions.
