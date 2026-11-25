---
name: land
description: Merge one or more pull requests when CI is green, then pull the main checkout and install. One command for "merge 28 when green, then pull and install". It reads each PR once, merges the green ones, hands the running ones to ci-watch, and does the pull and install when all are merged. Use for "/land", "/land 28 29", "merge 28 when green then pull and install", "land it", "is it merged? pull and install".
model: sonnet
effort: low
argument-hint: "[PR numbers or URLs, default: the PR of the current branch] [-R owner/repo]"
---

# Land

Merge, then pull and install. Read each state once. Never poll.

## Steps

1. **List the PRs.** Use the arguments. With none, use `gh pr view --json number,url` of the current branch. With no PR, stop and name `/ship`. The repo is `-R` if given, else the repo of the current folder.
2. **Read each PR once.** `gh pr view <n> -R <repo> --json state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup`.
3. **Decide for each PR.**
   - Already `MERGED`: nothing to do, go to step 5 for it.
   - Draft, `CONFLICTING`, `CHANGES_REQUESTED` or a failed check: stop for that PR. Say the reason in one line. Name `/pr-sweep` or `/paralel`.
   - Checks still running: add it to ci-watch (`/ci-watch add <n>`, auto-merge on). Say that ci-watch merges it and starts a turn. Do not wait here.
   - All green and `CLEAN`: run the steps of `merge-when-green` (rule check, then `gh pr merge <n> -R <repo> --squash --delete-branch`). The merge policy mod may refuse: report its reason and stop for that PR.
4. **Wait without polling.** If a PR still runs, end the turn with one line: which PRs wait, and that ci-watch starts the next turn. On that turn, read the state once and go on from step 3.
5. **Pull and install, only when every PR is merged.** The main checkout is the folder in `~/.claude/claude-config.repo`.
   - `git -C <main> status --porcelain` must be empty. If not, stop and say which files.
   - If it is on another branch, run `git -C <main> switch main`.
   - If the merged PR is in the profile repo, run `git -C <profile> switch main` and `pull --ff-only` there too. The profile folder is in `~/.claude/claude-config.profile`.
   - Run `git -C <main> pull --ff-only`, then `./install.sh`, then `./install.sh --mods`, then `./install.sh --check` in `<main>`.
6. **Report.** One line for each PR (merged, waiting, or stopped and why). Then: installed with no drift, or the drift lines. If mods changed, say: run `/reload-plugins`.

## Boundaries

- Never merge a draft, a conflict, a PR with requested changes, or a PR with a failed check. Never use `--admin`.
- Never pull over a dirty checkout. Never force or reset.
- Never poll: no `sleep` loop, no `gh pr checks --watch`.
- A production release stays manual: stop and say so.
