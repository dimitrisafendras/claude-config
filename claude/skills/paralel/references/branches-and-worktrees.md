# Branches and worktrees (detail)

Only code-changing work gets a branch. Reviewing someone's PR, answering a question, triage and ticket moves don't.

## The feature branch (one per main task)

When the first code task of a main task arrives (a ticket, an epic, a feature the user names), the dispatcher creates its feature branch from freshly fetched `origin/main`, in its own worktree, and pushes it:

```
git fetch origin
git worktree add .claude/worktrees/<topic> -b feature/<topic> origin/main
git -C .claude/worktrees/<topic> push -u origin feature/<topic>
```

- **Name:** `feature/`, `fix/` or `chore/`, then a plain topic in lowercase words joined by single hyphens. Never an agent-branded prefix. The double hyphen is reserved for sub-branches.
- **One draft PR to `main`**, opened by the dispatcher as soon as the first reviewed sub-branch has merged in (GitHub refuses a PR with no diff): `gh pr create --draft --base main --head feature/<topic>`. Put every ticket id the feature covers in the title or a `Refs:` line. If the feature spans surfaces (backend and web, say), say in the body that the user asked for one feature branch. That is the explicit request for a combined review that the workspace `CLAUDE.md` asks for.
- **Nothing is tested on `main`.** Agents verify on their sub-branches, CI runs on the feature PR, and any dev server serves the feature worktree.
- Follow-ups for the same main task (review fixes, CI fixes, a newly found subtask) join its feature branch. An unrelated main task gets its own. Under `start-web-dev` the session has a single feature branch, the one localhost serves, and every main task goes on it.

## Sub-branches (one per agent)

Every code-changing agent works on its own branch, based on the feature branch, in its own worktree. A main task without subtasks still gets one sub-branch, so nothing unreviewed reaches the feature branch.

- **Naming: `<feature-branch>--<subtask>`**, with the worktree named after it: `feature/ask-ai--adr` in `.claude/worktrees/ask-ai--adr`. Git stores each branch as a file under `refs/heads/`, so `feature/ask-ai` and `feature/ask-ai/adr` can't both exist (one path would have to be a file and a directory at once), and the second branch fails to create or push. The `--` suffix avoids that clash, keeps the sub-branch listed next to its feature, and keeps the plain prefix the attribution guard expects.
- **The agent creates its worktree itself**, with the exact command from its prompt: `git worktree add .claude/worktrees/<topic>--<sub> -b feature/<topic>--<sub> origin/feature/<topic>`. Subagents can't use `EnterWorktree` (it's refused in subagent context). Don't use `isolation: "worktree"` for sub-branches either: it picks its own name and base, so neither the ledger nor the cleanup can track it.
- **The agent pushes and reports. It never opens a PR**, not to `main` and not to the feature branch.
- **Before reporting**, when other sub-branches have landed since it branched, the agent checks that its branch still merges cleanly: `git fetch origin && git merge-tree --write-tree origin/feature/<topic> HEAD`. On a conflict it merges `origin/feature/<topic>` into its own branch (a merge commit, no rebase), resolves, re-verifies and pushes, so the dispatcher's merge is clean.

## Merging a sub-branch in

After a clean review, the dispatcher merges in the feature worktree, which nobody else writes to:

```
git -C .claude/worktrees/<topic> pull --ff-only
git -C .claude/worktrees/<topic> merge --no-ff origin/feature/<topic>--<sub> \
  -m "Merge branch 'feature/<topic>--<sub>' into feature/<topic> (<ticket id>)"
git -C .claude/worktrees/<topic> push
```

If the merge conflicts, run `git merge --abort` and send the author agent to merge the feature branch into its sub-branch and resolve it there. A conflict resolution is code, so it gets reviewed. And the dispatcher may not be able to edit files in another worktree anyway: hooks can block `Edit` and `Write` there while `git` commands still work, so every file change goes through an agent. After the merge, move the ticket (see "Keep the board current").

**Then remove the sub-branch at once, in the same turn as the push.** This step is part of the merge, not optional cleanup. Skipped, it leaves `.claude/worktrees/<topic>--<sub>` behind with no PR and a branch that is not on `main`, and nothing else ever removes it:

1. `git fetch origin`, then check that the sub-branch tip is an ancestor of the pushed feature branch, for the remote and the local tip: `git merge-base --is-ancestor origin/feature/<topic>--<sub> origin/feature/<topic>` and `git merge-base --is-ancestor feature/<topic>--<sub> origin/feature/<topic>`. If either fails, stop and remove nothing.
2. `git worktree remove .claude/worktrees/<topic>--<sub>`, never with `--force`.
3. `git branch -d feature/<topic>--<sub>`, never `-D`.
4. `git push origin --delete feature/<topic>--<sub>` if the sub-branch was pushed, then `git worktree prune`.

The exact commands, what to do when a step refuses, and the wind-down sweep for orphans are in `cleaning-up-worktrees.md`.

## Several agents on one feature

- Each agent has its own sub-branch and worktree. Where you can, give each one a disjoint set of paths, and list the other agents' paths as off-limits in its prompt.
- **One writer on the feature worktree: the dispatcher's merges.** Agents never edit files there, never install, reinstall or delete `node_modules` there, and never start a second dev server.
- **Shared hot files** are where parallel agents collide. Settle them before spawning:
  - **Numbered migrations:** reserve one number per agent up front, counting on from the highest number on the feature branch, and put it in that agent's prompt. For example, RDS migrations in `apps/meeting-platform/infra/rds-migrations/`: 0225 for the first agent, 0226 for the second. Re-check the numbers against `origin/main` and every open PR when the feature finishes, with the `migration-number-check` skill (below).
  - **Generated files are regenerated, never hand-merged.** For example `libs/contracts/pipeline/pipeline-solution.json` (`npm run pipeline-solution:generate` from `apps/meeting-platform`), or the error-code contract `libs/contracts/api/src/mirrored/meeting-platform-error-codes.json` (`npm run error-codes:generate` from `apps/meeting-platform`). The agent whose branch lands second merges the feature branch in, reruns the generator on the merged tree, and commits the output.
  - **The lockfile:** one agent per feature changes dependencies at a time. On a conflict, take one side, rerun `npm install` at the workspace root so it re-applies the other side's `package.json` changes, and commit the result. Never hand-edit it, and never use `--legacy-peer-deps`.
  - **Other singletons** (a global stylesheet, a route manifest, the locale files) get one owning agent, named in every prompt.
