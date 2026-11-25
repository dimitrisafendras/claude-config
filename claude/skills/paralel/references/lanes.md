# Lanes: several independent pieces at once

The plan in `plan-the-fan-out.md` decides when lanes are needed; read this once it does. Read it when the work has several independent lanes (an epic, a list of tickets, a refactor plan). Each lane gets one nested session; this session is the coordinator. Throughput comes from parallel lanes; safety comes from lanes that never touch the same files, a reviewer on every change, and one coordinator who owns the order of merges.

Before every spawn, apply `memory-budget.md`. Why lanes are cut this way: `why-this-exists.md`.

Usage: `/paralel <epic or task id(s) or URL, or a short description of the work> [max-sessions=N]`.

## Phase 1: Gather the work (cheap, yourself)

1. Read the input: the epic with its description and subtasks, or each named ticket, through the board tools that the board's extra source file in `~/.claude/start-work.d/` names (ids, workspace and call shapes are there). Keep only open items (backlog / to do / in progress / blocked whose blocker is gone). Note anything marked done or Closed that the code contradicts. Report it, don't silently redo it.
2. Do not read the codebase here beyond one grep per item to learn which area it touches. Sizing and implementation are the lanes' job.

## Phase 2: Cut lanes

Default: one lane per ticket or unique task. Merge items into one lane only when they would edit the same files, so that **no two lanes edit the same files**:

| Signal | Put together in one lane |
|---|---|
| Same app area (web stores, mobile stores, one backend module) | yes |
| One item's output is another's input (lib extract → adoption) | yes, ordered inside the lane |
| Dependency / lockfile changes | one lane owns them; others merge `origin/main` and regenerate after it lands |
| Cross-cutting config (every lib's tsconfig, CI workflows) | its own lane, or last |
| Final audit / verification item | the coordinator or the longest-lived lane, last |

- One lane per ticket, capped by the memory budget (`memory-budget.md`). More sessions than independent file sets (or than RAM allows) just means conflicts or a crash. `max-sessions=N` caps it further.
- A trivial item (one or two tool calls' worth) stays with the coordinator.
- If an existing linked session already has context for an area, give it that lane via `SendMessage` instead of starting a new one, and tell it what is no longer its job.
- Respect repo caps. A repo can cap open PRs for one epic (a decision record or its `CLAUDE.md` says so). Lanes check the open PRs of that epic with `gh pr list --search "<epic> in:title is:open"` before opening one.

## Phase 3: Start the lanes

For each lane, in one message (call `mcp__ccd_session__mark_chapter` first when starting two or more), write a bold title line and a sentence, then `mcp__ccd_session__start_session` with:

- `initiation: "user_asked"` (running `/paralel` is the ask), `context: "fresh"`, `use_worktree: true`, a plain `branch_name`, a short `name`, and the `model` that the plan names for this lane (default `sonnet`; `plan-the-fan-out.md`, section 3).
- **`prompt`**, the brief:
  - The user manages only the coordinator. Never ask the user a question and never wait for the user: when blocked or unsure, `SendMessage` the coordinator with the question and the options, then continue with what is not blocked. The same for a tool call that is refused or needs a prompt: do not retry it and do not wait; send the coordinator the exact action and the reason.
  - Models: the `automodel` mod, when installed, picks the model and effort for each of your turns. Do not set a fixed `/model` and do not fight it. Your agents are different: each one gets the explicit model and effort from your sizing, and that choice wins over `automodel`.
  - Report to the coordinator with `SendMessage` at each state change (agent started, sub-branch merged, PR opened, CI result, merged, blocked), and at least every 20 minutes while you work. Never poll CI or sleep to wait for it when the CI watcher is installed.
  - **Open the PR and fix it until CI is green** (`keep-it-running.md`, 7): open it when the check passes and the reviewer is clean, fix each real CI failure from its log (3 rounds for one check, 6 for the PR), re-run an infrastructure failure once, never bypass or weaken a check, and report `ready` only when every required check is green on the head commit. Never merge.
  - **Done criteria and the check** (from the coordinator's plan): before any edit, call the tool `mcp__verify-gate__set` with the check command and the one-line criteria. Never edit, skip or weaken the check. Report `review` only after the check passes, and put the command and its result in the PR body (`keep-it-running.md`, 6).
  - **Environment first** (only when the plan marked the lane `env`): invoke the lane's environment skill before any work: `start-web-dev` for web, `start-mobile-dev` for mobile. It boots the dev server or simulator from this lane's worktree and opens the app. It must not start sessions: its phase 4 ("invoke `/paralel`") is already met, because you are a lane in dispatcher mode. A backend, docs or infra lane has no `env`: skip this.
  - First line: you are a **lane**. Invoke `/paralel`, skip step 0 (do not start sessions of your own) and work in dispatcher mode, with subagents on `<feature>--<sub>` sub-branches and a separate risk-sized reviewer before each merge.
  - The memory rules: agents as the coordinator's plan says for this lane (default one running subagent, at most 3 on disjoint paths), `mem-budget.sh` before every heavy job, targeted tests locally, dev servers stopped when done.
  - The lane's items with ticket ids, in order, and which can run in parallel inside the lane.
  - Done = each item is a main task with its own PR from a plain-named feature branch cut from `origin/main` (never a `claude/` branch). The lane's subagents work on sub-branches of it and never open PRs. The PR stays a draft until the item is complete (`finishing-ci-and-merge.md`), then is marked ready and admin-merged when every required check is green and the reviewer has no open CONFIRMED findings. The ticket moves in progress → in review → done, and the lane reports the merge to the coordinator via `SendMessage`.
- **`background`**: the repo and its rules (CLAUDE.md: no AI attribution, root installs, no `--legacy-peer-deps`, required checks unfiltered), who owns the lockfile, the PR cap, what the other lanes are doing (so they stay out), standing user rules (e.g. a designer's UI wins over ours; never touch a named repo, flag or release tag).

Then, in this session, dispatch any coordinator-owned item to a background subagent (`Agent`, `run_in_background: true`, explicit model and effort) under the dispatcher rules in `../SKILL.md`, so the coordinator is never idle-waiting.

Tell the user in a few lines: which lanes started, what each owns, what the coordinator kept.

## Phase 4: Coordinate until done

- **Merge order:** when two lanes' PRs touch the same files after all (it happens: shared components, CI), merge one, then tell the other lane to merge `origin/main` and resolve, keeping the merged side's intent (a designer's UI always wins).
- **Shared contracts:** a lib or backend change another lane depends on lands first; message the dependent lane once it is on `main`.
- **Lane reports are claims:** verify a "merged" with `gh pr view <n> --json state,mergeCommit` before relaying.
- **Blocked lanes:** a lane blocked by a hook or permission it can't clear: take the piece over with a subagent here (check its saved WIP branch first) and tell the lane to drop it. Never run something a lane was refused by its permission check without the user's own go-ahead.
- **Merging:** the coordinator may admin-merge any reviewed, green PR from the work without asking. It never pushes release tags, flips feature flags, or bulk-deletes anything on its own.
- **Relay** each merge to the user in one line with the PR link; keep a running table (lane, item, PR, state) and reprint it when asked "status?".
- **Metrics:** if the work promises a measurable gain, have one lane own measuring before/after and publish it (an Artifact page), updated after each merge.

## Phase 5: Close

When every item is merged: run (or have a lane run) the final audit item against the epic's "Done when", fix what it finds, move the epic to done, give the user one summary (PRs, what moved, what is left and why), then clean up:

1. **Sweep each lane.** Run the wind-down sweep of `cleaning-up-worktrees.md` for every lane's feature branch: no orphan sub-branch worktrees, no unmerged sub-branch (never `--force`, never `-D`).
2. **Remove the lane worktrees and branches** of every merged PR, with the `cleanup` skill rules (clean, pushed, merged only; never delete a remote branch).
3. **Stop what you started:** dev servers, simulators, Metro, background shells.
4. **Archive the lane sessions** with one line to the user. Archive only on their yes, and never delete a session.
5. **Mark the ledger** `done, cleaned` per lane, and print it one last time.
6. **Propose rule updates.** List each mistake that a lane repeated or that you corrected twice, with one proposed line for the repo's `CLAUDE.md` (or a hook). Change nothing without the user's yes.

A lane that is not merged keeps its worktree and its session. Say so in the summary.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Two lanes keep conflicting | Lanes cut by ticket, not by files | Re-cut: move one item to the other lane, or sequence them |
| Lockfile conflicts every merge | More than one lane changes deps | One lane owns deps; others regenerate at the root after merging main |
| A lane pushes from `claude/...` | Worktree default branch name | Lanes create plain feature branches from `origin/main`; never push the worktree branch |
| A lane's agent can't write files | Cross-worktree write hook | Agent enters its own worktree (`EnterWorktree`) or the coordinator takes the piece |
| PRs pile up unopened | Repo PR cap | Lanes queue; coordinator merges green ones promptly to free slots |
| The desktop app runs out of memory | Too many sessions or parallel test suites | Archive finished sessions, cap lanes and agents by `mem-budget.sh`, targeted tests locally; resume lanes from their pushed WIP |
