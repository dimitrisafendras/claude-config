# Profile: example

A profile holds what is yours or your company's: rules, extra skills, ticket sources, mods, permissions, the pages you use. The core of this repo is generic and holds none of that.

This folder is a small example to copy. Keep your real profile in a private repo and install it by path: `./install.sh --profile ~/Projects/my-profile`. Or copy this folder to `profiles/<yours>/` in a private fork and install it by name: `./install.sh --profile <yours>`.

| Part | Where | What |
|---|---|---|
| Rules | `profile.md` | Linked to `~/.claude/profile.md`; the core `CLAUDE.md` imports it. Your organization's rules for every project |
| Permissions and plugins | `settings.json` | Merged into `~/.claude/settings.json` after the core settings; the permission lists are joined |
| Projects | `projects.conf` | Surfaces and roles of your projects (`<folder> <surfaces> [board]`); copied once to `~/.claude/`, yours to edit |
| Pages | `work-monitor-url`, `cheat-sheet-url`, `cheat-buttons.json` | The Work Monitor and cheat sheet artifacts, and the button row; copied once to `~/.claude/` |
| Merge policy | `merge-policy.json` | The rules of the `merge-policy` mod: for the repos in it, `gh pr merge` needs no prompt. Copied once to `~/.claude/`, never overwritten. It gives permission, so only its owner writes it. The example names a fake repo, `acme/web-app`: replace the file with your own repos, or delete it |
| Extra sources | `start-work.d/*.md` | One file per source for `/start-work` (a ticket board, an error tracker): how to check its connection, collect rows, classify them |
| Skills | `skills/*/SKILL.md` | Skills that only your projects need; linked into `~/.claude/skills/` |
| Mods | `mods/*/` with `.claude-plugin/marketplace.json` | Mods that only your projects need; `./install.sh --mods` installs them from the profile's own marketplace |
| Sync | `sync.sh` (optional) | Copies skills from a source repo of yours; `/start-work` and `/setup-audit` run `sync.sh --check` when it exists |

## What goes in a profile, and what does not

- In: company names, project names, people, board ids, channel names, URLs of your pages, repos that a permission names.
- Out: anything that works the same for everyone. That goes in the core, and `tests/core-clean.sh` refuses a name there.
