---
name: setup-audit
description: Audit the claude-config repo itself, read-only. Runs install and sync drift checks, shellcheck, syntax and JSON checks, skill size and description limits, missing model/effort, stale text, uncloned repos, main-checkout state, open PRs and mod validation. Ranks findings by risk and proposes fixes. Use for "/setup-audit", "audit my setup", "check claude-config", "is my setup healthy".
model: sonnet
effort: medium
---

# Setup audit

Check the claude-config repo (its main checkout: the path in `~/.claude/claude-config.repo`) for drift and rot. Report, propose, and change nothing.

## Rules

- **Read-only.** Do not edit, commit, push, install, sync or fix anything unless the user says so in this turn. Run `install.sh` and `sync.sh` only with `--check`.
- Never switch branches or touch worktrees in the repo.
- Do not print secrets from `settings.json`. Name the key only.
- A finding the script cannot judge (a stale path that is only an example) is "unsure". Say so; do not call it a defect.

## Steps

1. Run `bash ~/.claude/skills/setup-audit/audit.sh` (add `--no-network` when offline). It prints one line per finding: `LEVEL<TAB>area<TAB>message`. Exit 1 means at least one ERROR.
   - It covers: `install.sh --check`, `sync.sh --check`, `shellcheck -S warning` and `bash -n` on every `*.sh`, `jq .` on `settings.json`, SKILL.md size (flag over 10 KB), description length (flag over 500 characters), missing `model` or `effort`, removed plugin names, paths that do not exist, routine template drift (a hard rule in `routines/project-daily.md` or `routines/project-morning.md` that the other has not; the start-work rules may differ; `audit.sh --routine-drift` runs only this check), `projects.conf` entries for folders that do not exist, main checkout on `main` and current, open PRs, `claude plugin validate` for each mod.
2. Look at each ERROR and WARN. Open the file when the message is not enough to judge it.
3. Rank by risk:
   1. ERROR: broken scripts, invalid JSON, a skill without `SKILL.md`, main checkout not on `main`.
   2. Drift: `install.sh` or `sync.sh` differences, main behind `origin/main`.
   3. Quality: skill size, description length, shellcheck, stale text, routine template drift.
   4. INFO: missing `model` or `effort`, open PRs.
4. For each finding give a fix in one line (the command or the edit). Do not run it.
5. Ask whether to apply any fix. Apply only the ones the user names.

## Report

- One line first: counts of ERROR, WARN and INFO.
- A table ranked by risk: level, area, finding, proposed fix.
- A short list of what could not be checked (no network, no `claude` CLI, no `gh`).
