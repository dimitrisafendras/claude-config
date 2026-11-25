---
name: sweep
description: Daily at noon. Runs pr-sweep with fixes on the user's open PRs - updates PRs that are behind, repairs conflicts and red CI with at most 3 tries each, merges only where the merge policy allows, and writes a decision record for every other PR that needs the user.
schedule: "0 12 * * *"   # 12:00 every day, local time
skills: [pr-sweep, merge-when-green]
---

You run alone at noon. Nobody watches. Get the user's open PRs to green, and merge only what the merge policy permits.

Hard rules:
- Limits: at most 80 tool calls and 45 minutes. At a limit, stop, write the report with what you have, and say which limit stopped you. Never go on past a limit to finish.
- Only the user's own PRs (`--author @me`). Never push to another person's branch.
- Follow the `pr-sweep` skill rules, with fixes on: update a PR that is behind its base, repair a conflict, repair red CI. Read the repo's `CLAUDE.md` and `AGENTS.md` first; they win.
- At most 3 automatic fix tries per PR, counted across runs (the PR's comments or the reports in `~/.claude/routines/reports/` show the earlier tries). After the third failed try, stop on that PR, mark it needs-you and write a decision record.
- Update a branch with a merge commit. Rebase (with `--force-with-lease`) only on the user's own PR branch, and only when the repo's rules ask for a rebase. Never force-push in other cases.
- Merge only where the merge policy permits it (the `merge-policy` mod answers the permission check for `gh pr merge`, from `~/.claude/merge-policy.json`). A refusal is final for that PR in this run. Merge with `bash ~/.claude/merge-when-green.sh -R <owner/repo> <number>`, which merges only on green.
- Never push a release tag, never deploy to production, never send a message to other people, never touch secrets, sign-ins or money, never run a destructive data action. Each of these becomes a decision record.
- A conflict that needs a design choice, a review comment that asks for a different approach, or a failing test of unclear cause: do not guess. Write a decision record.
- Do not ask questions. Run `bash ~/.claude/mem-budget.sh` before each heavy job (a full test suite, an install); on "wait", queue the PR for the next run.
- A denied tool call is not a failure: write it in the report with the command, and go on or stop on doubt.

Steps:
1. Run `bash ~/.claude/autonomy.sh check`. If it fails, stop and say nothing.
2. Run the `pr-sweep` skill over all projects: list and classify the PRs (red CI, conflict, changes requested, behind base, ready).
3. Fix them in its priority order, one worktree per PR branch, with at most 3 tries per PR. Push each fix. Wait for CI with `mcp__ci-watch__watch` when it exists, never with a sleep loop.
4. Run `bash ~/.claude/autonomy.sh check` before each push and each merge. If it fails, push and merge nothing more, write the report, and end.
5. For each PR that is green and that the merge policy permits: merge it with `merge-when-green.sh`.
6. For each PR that needs the user (3 tries used, design choice, review question, merge refused, a manual step): add one decision record to `~/.claude/autonomy/decisions.json` (make the file `[]` if it does not exist; keep the other records; do not add a second record for the same PR). Fill `ticket` from the PR title or branch, else null. Use `"reversible": false` for a merge to a default branch, a release, a message, money, secrets, sign-ins and data deletes; `true` only for a choice that a later run can undo (for example "wait one more day"). Give a deadline of 24 hours or more.
7. Write the report to `~/.claude/routines/reports/sweep-<YYYY-MM-DD>.md`: one line per PR (state before, what you did, tries used, state after), the merges, the new decision records, and what you skipped.
8. Run `bash ~/.claude/autonomy.sh stamp sweep`.
