---
name: config-loop
description: Nightly. In the main checkout of this repo, only when it is clean and on main - pulls, installs the mods, checks the install, runs setup-audit read-only, and sends the safe fixes as one PR that merges on green. When the checkout is not clean or not on main it only reports that.
schedule: "0 3 * * *"   # 03:00 every day, local time
skills: [setup-audit, merge-when-green]
---

You run alone at night. Nobody watches. Keep this setup current and healthy.

Hard rules:
- Limits: at most 60 tool calls and 30 minutes. At a limit, stop, write the report with what you have, and say which limit stopped you. Never go on past a limit to finish.
- The main checkout is the folder in `~/.claude/claude-config.repo`. Change it only when `git status --porcelain` is empty and the branch is `main`. Else change nothing, report the state, and end.
- In the main checkout, only `git pull --ff-only` and the install commands of step 3. Never commit, reset, stash, switch branches or force in the main checkout. Make the fixes in a new worktree from `origin/main`.
- Safe fixes only: a fix that `setup-audit` marks mechanical (a rename, a stale path, a missing name in a README, a lint fix) and that changes no behavior. Never change a permission, a hook, a setting that weakens a safety check, or the merge policy. Everything else goes in the report as a proposal.
- One PR at most, on the branch `config/nightly`. If a PR from that branch is open, push to it. It merges only on green, with `merge-when-green.sh`, and only where the merge policy permits it. At most 3 fix tries on red CI; then leave the PR open and write a decision record.
- The core rules apply: no company, person or project names in the files you write (`bash tests/core-clean.sh` must pass).
- Do not ask questions. A denied tool call is not a failure: write it in the report with the command, and go on or stop on doubt.

Steps:
1. Run `bash ~/.claude/autonomy.sh check`. If it fails, stop and say nothing.
2. Read the main checkout path. Run `git -C <path> status --porcelain` and `git -C <path> branch --show-current`. If the output is not empty or the branch is not `main`, write "not clean" or "not on main" (with the branch and the changed files) in the report, skip to step 8, and change nothing.
3. Run `git -C <path> pull --ff-only`. Then, in the main checkout: `./install.sh --mods`, then `./install.sh --check`. On a failure, stop the changes and report the output.
4. Run the `setup-audit` skill read-only: `bash ~/.claude/skills/setup-audit/audit.sh`. Rank the findings by risk.
5. If there are safe fixes: make a worktree from `origin/main` on `config/nightly`, apply them, run `bash tests/core-clean.sh`, `bash tests/inventory.sh` and the other tests that the change touches. Commit, push and open one PR (or push to the open one). The PR body lists each fix and its audit finding.
6. Run `bash ~/.claude/autonomy.sh check` again. If it fails, do not merge. Else merge the PR with `bash ~/.claude/merge-when-green.sh -R <owner/repo> <number>`. On red CI, fix and try again, 3 tries at most; then add a decision record to `~/.claude/autonomy/decisions.json` (`routines/README.md` has the format).
7. Remove the worktree after the merge. Do not pull or install again in this run: the next run installs the merged fixes.
8. Write the report to `~/.claude/routines/reports/config-loop-<YYYY-MM-DD>.md`: the checkout state, the pull result, the install and check output (short), the ranked findings, the PR link and its state, and the proposals that were not safe to apply.
9. Run `bash ~/.claude/autonomy.sh stamp config-loop`.
