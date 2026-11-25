---
name: sync-prefs
description: Send your local Claude preferences to the claude-config repo, one way. Compares ~/.claude/settings.json, the button row, the project files and the desktop app preferences with the repo, writes the differences to a worktree, checks for secrets and names, and opens or updates one PR. Never merges and never changes the local files. Use for "/sync-prefs", "sync my preferences", "save my settings to the repo", "update the repo with my settings".
model: sonnet
effort: low
argument-hint: "[--check] (optional: only list the differences, change nothing)"
---

# Sync preferences to the repo

One way only: your local preferences go to the repo. The repo never changes your local files here. The script `prefs-sync.sh` does the files. You read the desktop app preferences, because only a Claude session can.

## Steps

1. **Find the repo.** `REPO=$(cd "$(dirname "$(readlink ~/.claude/prefs-sync.sh)")/../.." && pwd -P)`. No link: stop and say that `install.sh` has not run.
2. **Check.** Run `bash ~/.claude/prefs-sync.sh --check`. Exit 1 lists the files that differ. Then read the desktop app preferences with `mcp__ccd_settings__get_settings` (load it with ToolSearch). Compare each setting that has a value with `settings` in `$REPO/claude/desktop-settings.json`.
3. **Stop when nothing differs.** Both equal: say "in sync" and stop. With the argument `--check`: list the differences and stop.
4. **Branch and worktree.** Never write in the main checkout and never switch its branch.
   - Open PR from the branch `prefs/sync` (`gh pr list --head prefs/sync --state open`): `git -C $REPO fetch -q origin prefs/sync` and `git -C $REPO worktree add $REPO/.claude/worktrees/prefs-sync-<date> prefs/sync`.
   - Else: `git -C $REPO fetch -q origin` and `git -C $REPO worktree add -b prefs/sync $REPO/.claude/worktrees/prefs-sync-<date> origin/main`.
5. **Apply.** `bash ~/.claude/prefs-sync.sh --apply --repo <worktree>`. Then write the desktop preferences into `<worktree>/claude/desktop-settings.json`: update `settings` with the keys and values you read. Keep `_note` and `read_only_facts`. A setting with no value is at its default: leave it out.
6. **Safety check.** Run `bash <worktree>/tests/core-clean.sh`. Scan the diff for secrets: `git -C <worktree> diff | grep -i -E 'api[_-]?key|token|secret|password|bearer|sk-[A-Za-z0-9]'`. A hit in either: do not commit. Remove the worktree changes, name the file and the line, and stop.
7. **Commit and PR.** One commit, subject `prefs: <what changed>` (a list of files). Push `prefs/sync`. Open one PR, or let the push update the open one. The body lists each changed file in one line.
8. **Report.** The PR link and the files in it. Name what you did not sync: hooks and marketplace paths (they hold paths of this computer), `env` (secrets), and the plugins of the `claude-config` marketplaces (`install.sh --mods` owns them).

## Boundaries

- One way. Never copy repo values into the local files here. `install.sh` does that, when the user runs it.
- Never merge the PR. The user, or `/merge-when-green`, does.
- Never put a secret in a commit. If unsure about a value, leave it out and say so.
- Run `./install.sh` only after the PR is merged: it overwrites local values with repo values, so a local change not yet synced is lost.
