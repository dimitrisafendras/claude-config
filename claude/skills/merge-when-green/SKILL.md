---
name: merge-when-green
description: Merge one pull request when its CI is green, with no polling. Reads the PR once. Merges at once when it is green and clean. Waits with ci-watch when CI is still running, then merges on the green turn. Stops and says why for a draft, a conflict, requested changes, red CI or a repo rule that forbids the merge. Use for "/merge-when-green", "merge when green", "merge it when CI passes", "merge this PR".
model: sonnet
effort: low
argument-hint: "[PR number or URL] (default: the pull request of the current branch)"
---

# Merge when green

Merge one pull request, and only when it is ready. Read the state once. Never poll.

## In a loop

The lane loop runs this skill at its merge stage, with no person. Check `bash ~/.claude/autonomy.sh check` first. In a company repo, merging on green under `merge-policy` needs no approval. Anything that stops the merge (red CI, a conflict, a refused rule) goes back to the lane: fix it within the limit of 3 automatic tries for each PR, then `needs-you` with a decision record. Never retry a refused merge.

## Steps

1. **Find the PR.** With an argument, use it. Else run `gh pr view --json number,url,headRefName` in the current repo. No PR: stop and say so. Name the step that opens one: `/ship`.
2. **Read the state once.** Run `gh pr view <n> -R <repo> --json isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,baseRefName`.
3. **Decide.**
   - Draft, `mergeable` = `CONFLICTING`, `reviewDecision` = `CHANGES_REQUESTED`, or any check failed: stop. Say the reason in one line. Name the next step for the person (`/pr-sweep` or `/paralel` fixes it). Do not start it here.
   - Any check still running or queued: add the PR to ci-watch with the intent "merge on green": `/ci-watch add <n>`. Say that the merge runs on the green turn. Do not wait here.
   - All checks passed, not a draft, no conflict, no requested changes: go to step 4.
4. **Check the repo rule.** Read the repo's `CLAUDE.md` and `AGENTS.md` (if present) for a merge rule. A rule that needs an admin gate, a second approval or a manual step: stop. Say which rule. Never work around it.
5. **Merge.** Use the merge style the repo allows: `gh repo view -R <repo> --json mergeCommitAllowed,squashMergeAllowed` (prefer a merge commit when both are allowed, as the history of the repo shows). Run `gh pr merge <n> -R <repo> --merge` or `--squash`. Do not delete the branch. The merge policy mod may refuse the command: if it does, stop and report its reason.
6. **Report.** One line: the PR, the merge commit (`gh pr view <n> -R <repo> --json mergeCommit -q .mergeCommit.oid`), and the next step (`/cleanup` removes its worktree).

## Boundaries

- One PR per run.
- Never merge a draft, a PR with a conflict, or a PR with requested changes.
- Never force a merge past a failed check or a rule.
- Never push, rebase or change the PR.
