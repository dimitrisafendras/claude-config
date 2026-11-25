---
name: pr-sweep
description: Find the user's open PRs across all projects in `~/Projects`, classify each (red CI, conflict, changes requested, behind base, ready), fix them in priority order through the paralel rules, push, and report. Never merges. Use for "/pr-sweep", "sweep my PRs", "fix my open PRs", "what is wrong with my PRs".
argument-hint: "[repo or PR number] (optional, limits the sweep)"
model: sonnet
effort: medium
---

# PR sweep

Get every open PR of the user to "ready". Fix what is fixable. Leave the merge to the user.

## Rules

- **Never merge.** Merging stays with the user or their merge rule (`merge-when-green.sh`, the merge rules of the dispatcher skill).
- **No force-push and no rebase by default.** Update a branch with a merge commit (`git merge origin/<base>`). Use a rebase plus `--force-with-lease` only on the user's own PR branch, and only when the repo's rules ask for a rebase. Many repos forbid every history rewrite; read first.
- Read each repo's `CLAUDE.md` and `AGENTS.md` before any change. They win over this skill. Cite organization ADR rule IDs (for example `ADR-004/R3`) when a rule decides something.
- Only the user's own PRs (`--author @me`). Never push to another person's branch.
- One worktree per PR branch under `.claude/worktrees/`. Do not switch a main checkout's branch. Do not touch other worktrees.
- Do not poll CI in a sleep loop. If the tool `mcp__ci-watch__watch` exists (load it with ToolSearch), give it the PR. If not, run `gh pr checks <n> --watch` once, in the background.
- Do not skip hooks or CI, and do not edit tests only to make them pass.
- Stop and ask on a doubt: a conflict that needs a design choice, a review comment that asks for a different approach, a failing test of unclear cause.

## Steps

1. List PRs: `gh search prs --author @me --state open --json number,title,repository,url,isDraft`. Keep the repos of the projects that `bash ~/.claude/list-projects.sh` lists (match each folder's `origin` URL).
2. Classify each PR with `gh pr view <n> -R <repo> --json mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,headRefName,baseRefName` and the review threads:
   - **red CI**: a failed required check.
   - **conflict**: `mergeable` is `CONFLICTING`.
   - **review**: `CHANGES_REQUESTED` or unresolved review comments.
   - **behind**: `mergeStateStatus` is `BEHIND`.
   - **ready**: none of the above (draft PRs are listed, not fixed).
3. Print the table, then fix in this order: conflict, red CI, review, behind. (A conflict blocks CI, so it goes first.)
4. For each fix, follow the dispatcher skill for that repo: a profile skill whose description names the repo (for example `<project>-paralel`) wins over `paralel`, and `paralel` applies when no such skill exists. Small fixes go directly in the PR's own worktree; non-trivial changes go to an agent, then a separate reviewer before the push. Update the branch with a merge of `origin/<base>` (see Rules).
5. Push. Hand each pushed PR to the CI watcher (see Rules). Do not wait on it in this session.
6. Answer review comments only when the fix is done; reply with the commit. Do not resolve threads of other people.

## Report

A table: PR link, repo, class before, action taken, state now. Then the PRs that need the user (and why) and the PRs that are ready to merge.
