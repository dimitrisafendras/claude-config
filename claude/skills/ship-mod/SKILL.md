---
name: ship-mod
description: Ship a change to a mod or skill of this repo, from the working tree to your installed setup. Commits on a branch, pushes, opens a PR, merges it when CI is green, pulls main in the main checkout and installs the mods. Use for "/ship-mod", "ship this mod", "commit, push, PR and install", "pull and install".
model: sonnet
effort: low
argument-hint: "[commit title] (default: written from the diff)"
---

# Ship mod

Take a finished change in `claude-config` to your installed setup. Never pass a failed check.

## Steps

1. **Check the change.** Run `git status --short` and `git diff --stat`. No change: stop and say so. Stage only the files of the change. Never stage stray files, for example a screenshot.
2. **Branch.** On `main`, create `feat/<topic>` first. Never commit to `main`.
3. **Commit.** One commit. The title says what the change does. Add the attribution line from the session reminder.
4. **Push and open the PR.** With the `ship` mod, load `mcp__ship__ship` with ToolSearch and call it with `title` and `body`: it pushes, opens the PR and hands it to ci-watch. Without it, `git push -u origin HEAD`, then `gh pr create`. The body says what changed and why, and what you did not test. Add the attribution line from the session reminder.
4b. **Smoke test the mod.** For each changed mod, run one read-only command of it from the worktree: `command claude --plugin-dir mods/<mod> -p "/<command> status"` (or the mod's own read-only word). `command` skips a shell alias. The answer must be the mod's text, not an error. A failure stops here; say so in the PR. Skip this step for a change with no mod.
5. **Merge.** Run `/merge-when-green`. If CI still runs, ci-watch starts the merge turn on green. Stop on red CI, a conflict or a rule.
6. **Pull.** After the merge, run `git pull --ff-only` in the main checkout, not in the worktree. The main checkout is the path in `~/.claude/claude-config.repo` (`~/Projects/claude-config` when the file is missing or empty). Run this one command. It sets `R` itself and stops when `R` has no `install.sh`: `R=$(cat ~/.claude/claude-config.repo 2>/dev/null); R=${R:-$HOME/Projects/claude-config}; [ -f "$R/install.sh" ] || { echo "Not the main checkout: $R" >&2; exit 1; }; git -C "$R" pull --ff-only`.
7. **Install.** Run `./install.sh --mods` in the main checkout. Each shell command starts fresh, so this command sets `R` again: `R=$(cat ~/.claude/claude-config.repo 2>/dev/null); R=${R:-$HOME/Projects/claude-config}; [ -f "$R/install.sh" ] || { echo "Not the main checkout: $R" >&2; exit 1; }; (cd "$R" && ./install.sh --mods)`. WARNING: mods change how every session works, so only do this when the user asked for it or this skill was called.
8. **Report.** Give the PR link, the merge commit and the install result. Say: restart Claude Code or run `/reload-plugins`. Say `/cleanup` removes the worktree.

## Boundaries

- Mod edits in the main checkout load in place, so step 7 matters only for new mods.
- Never use `--force`, and never skip hooks.
- Tests: if `vitest` does not start, say so in the PR body. Do not claim a pass.
