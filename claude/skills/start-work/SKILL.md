---
name: start-work
description: Start the working day across all projects in ~/Projects with one command: fetch and update clean default branches, run cleanup and the setup drift checks, collect the inbox (open PRs with red CI, comments or conflicts, plus every extra source the profile adds), rank one plan, publish it to the Work Monitor, and start the work. Use for "/start-work", "start work", "start my day", "what's on my plate today", "pick up my tasks".
argument-hint: "[project folder | surface] (optional: one project such as `my-app`, or one surface such as `web`; default: all projects)"
model: opus
effort: medium
---

# Start work

One command for the whole day: housekeeping, inbox, one plan, start, and a live monitor page. No choice of environment or mode.

## Scope: all projects or one

- **No argument:** all projects. The day document id is `<date>`.
- **A project folder** (a first column of `list-projects.sh`): that project only. Run `morning.sh <folder>`, read only the extra sources of that project, and use the day document id `<date>_<folder>` (its `date` field holds the same text). 
- **A surface** (`web`, `mobile`, `backend`, `infra`): all projects, and the plan keeps only the rows of that surface.

**Project skills.** A project can have its own skills. An extra source file names them in its coordinates (`Dispatcher`, `Cleanup`, `Environment skill`). For rows and housekeeping of that project, use the named skill in place of `paralel`, `cleanup` or the generic environment skill.

## Fixed coordinates

| Thing | Value |
|---|---|
| Projects | every git repo in `~/Projects`, found by `list-projects.sh` (surfaces come from the files; optional `~/.claude/projects.conf` overrides a folder, hides one with `!folder`, or marks the project that owns the ticket board with `board`) |
| Inbox script | `morning.sh [folder ...]` in this folder. One JSON object on stdout. With folders, only those projects |
| Work Monitor | the artifact URL in `~/.claude/work-monitor-url` (one line). When the file is missing, publish `monitor.html` of this folder with the Artifact tool (`db` capability) and save the URL there. Collections, fields and write rules: `references/monitor.md` (read it before the first write) |
| Extra sources | each `~/.claude/start-work.d/*.md` is one source (a ticket board, an error tracker). Each says how to check its connection, how to collect rows, and how to classify them. A line `Project: <folder>` in its first 10 lines ties it to one project; a file without that line is for every run. Read the files of the scope at the start |
| Today | the date in the session context |

## Stage 0 — Use a prepared day

Read today's day document of the scope. When its `phase` is `inbox` and its `updatedAt` is less than 4 hours old (a morning routine prepared it), do not collect again: run `morning.sh` for fresh PR states (stage 1, step 1 only), keep the rows of the extra sources from the document, say "prepared at <time>" in one line, and go to stage 3. Else start at stage 1.

## Stage 1 — Housekeeping (no questions)

1. Run `bash ~/.claude/skills/start-work/morning.sh` (add the folder for a project run). It fetches every repo, fast-forwards the default branch only when the main checkout is on it and clean, and lists your open PRs with a CI verdict. Keep its JSON.
2. Start the cleanup skill (the project's own when a source names one) in a background agent (`general-purpose`, `sonnet`, never a smaller model: this step deletes): dry run, then apply, archive only what its rules allow. A row of the dry run that the rules do not clearly allow is kept and reported. Do not wait.
3. Check the Claude setup for drift: run `bash "$(cat ~/.claude/claude-config.repo)/install.sh" --check` (`install.sh` writes the path of the repo to that file). When the file is missing, use the folder that the link `~/.claude/skills/start-work` points to, without `/claude/skills/start-work` at the end; when that is not a link, use `~/Projects/claude-config`. Also run `bash <profile>/sync.sh --check` when the active profile folder (named or pathed in `~/.claude/claude-config.profile`) has a `sync.sh`. Exit 0 means no drift. On exit 1, put each printed line in `housekeeping.setupDrift` and add one `needsYou` line ("Claude setup drift: N items, see monitor"). Do not fix drift: run neither script without `--check`.
4. Check the connections with one cheap call each: `gh` (the script's `github_login`) and the check that each extra source names. A failed one removes only its source. Add a `needsYou` line with the source and the fix (for example "sign in to <server>"), and continue.
5. Write the day document to the monitor (see "Work Monitor") with `phase: "housekeeping"` and a `housekeeping` object: repos fetched, repos updated, repos not updated with the script's `note`, worktrees, free memory, setup drift.

## Stage 2 — Inbox

Collect the sources in parallel:

- **PRs** (from the script): keep a PR when CI is `red`, `conflict` is true, or `review` is `CHANGES_REQUESTED`. A green, approved, non-draft PR becomes a "ready to merge" row (the user merges, or the merge rules of the dispatcher skill apply). Other PRs (waiting for review, CI pending) go into one summary line, not into rows.
- **Extra sources**: one per file of the scope in `~/.claude/start-work.d/`, as that file says. Merge a ticket and a PR into one row when the PR title, branch or link carries the ticket id.

Update the day document: `phase: "inbox"`.

## Stage 3 — One plan

Classify each item: surface, severity (1 to 4), difficulty (XS, S, M, L) and model. Use the extra source's own classification rules when its file has them. Add a **repo** for each row; a PR row has its repo already. A source file can say which repo its items belong to (`projects.conf` marks the board's project with `board`).

Order:
1. Severity 4: production incidents, security, new errors that many users hit.
2. PR fixes (red CI, conflict, changes requested): they are almost done.
3. Tasks, easiest first (XS, S, M, L); same size: severity, then most overdue.
4. Not dispatched, in their own groups: ready to merge, needs you, blocked, in review.

Print the plan as one table (`#`, item link, repo, surface, severity, size · model, why, due). Then write the plan rows to the monitor (`phase: "plan"`) and give the user the monitor link in one line.

**What starts without a question (the day loop):** severity 4 rows, PR fixes (groups 1 and 2) and tasks (group 3) that are not `blocked` and not `needs-you`. Check `bash ~/.claude/autonomy.sh check` first: with the kill switch on, print the plan and start nothing. A `blocked` or `needs-you` row starts nothing; an open choice becomes a decision record (`paralel`, "Decisions"). Where a person is still needed: a production release, a message to other people, money, secrets, sign-ins, destructive data actions.

**Today's cut.** The inbox can hold 50 or more items. Put at most 12 dispatchable rows in the plan (the top of the order), plus the not-dispatched groups. Name the others in the day document's `headline` ("and 30 more for later"). When a row finishes, take the next item.

## Stage 4 — Start

Group the dispatchable rows into **lanes**: one lane per (repo, surface) pair that has rows. Backend and infra rows of the board repo form one lane.

- **One lane:** start it in this session. If an environment skill for the surface is installed (for example `start-web-dev` or `start-mobile-dev`), invoke it. Else work the rows yourself, one subagent per row, and keep the PRs small. For a project other than the current one, run from that project's checkout.
- **Two or more lanes:** this session becomes the coordinator and starts one nested session per lane. Use the project's dispatcher when a source names one, else the `paralel` skill if it is installed. Else read `references/lanes.md` for the session brief, the memory budget and the coordination rules.
  - Lanes that change the same API or shared library: the contract change goes first, in its own PR from the coordinator.
  - Not more sessions than the memory budget allows. Queue the other lanes and start each when one ends.

Then `phase: "running"`. Each lane then runs the lane loop of `paralel` with no person in it (`references/lane-loop.md` there). The `morning-prep` routine runs this day loop at the start of the day; `/autonomy run morning-prep` runs it once by hand. This skill does not repeat the rules for agents, branches, reviews, merges, CI and verification.

## Work Monitor

One artifact for every day. Only the coordinating session writes to it, with the `ArtifactData` tool (load it with ToolSearch once). The page only reads. Write when a state really changes, never on a timer. `references/monitor.md` has the collections, the fields, the row states and the write rules.

## Closing the day

When every lane reports `done` or `needs-you`, or the user stops: give one summary (PRs, verdicts, open decision records), write it to the monitor, and run `cleanup`. Archive nested sessions only after the PR merged or closed.

## Boundaries

- **Only your work.** The plan holds only items assigned to you and PRs you authored. Never dispatch, move, comment on or close an item that belongs only to someone else. An item with several assignees is yours, but say who else is on it in the row's note.
- Never push a release tag, never merge to a default branch outside the merge rules of the dispatcher skill, never force-push.
- `morning.sh` is the only thing that updates a main checkout, and only by fast-forward. Report a checkout that is behind and dirty or on another branch; do not fix it.
- Never change due dates, priorities or assignees in an extra source. Never post routine progress comments.
- Repo rules in each repo's `CLAUDE.md`, and the rules in the global `CLAUDE.md`, bind every agent and session. A row that would break a rule becomes `needs-you` with the rule ID; never work around it.
