# Routines

A routine is a prompt that runs on a schedule with no one watching. Each file has frontmatter (`name`, `description`, `schedule`, `skills`) and the prompt the scheduled agent gets.

Routines are registered as scheduled tasks (the `scheduled-tasks` tool, or `/schedule`). The file in this repo is the source of the prompt: to change a routine, edit the file, then update the scheduled task with the same prompt.

Rules for every routine:
- Safe when unattended: no merges, no pushes, no deletes beyond what `/cleanup` allows.
- It writes a report to `~/.claude/routines/reports/<name>-<date>.md` at the end.
- It stops on any doubt.
- Times are cron lines in local time.
- A denied tool call is not a failure: the routine writes it in its report and goes on, or stops on doubt.

## Permission prompts in a run

Nobody answers a prompt in a scheduled run, so a prompt stalls the run. In the desktop app each scheduled task has its own permission mode: set it when you create or edit the task, then press **Run now** once and choose "always allow" for the prompts that the routine needs. Later runs skip them.

Do not set `permissions.denyInsteadOfPrompting` for this. The setting is read only from `~/.claude/settings.json` or `--settings`, so it would also deny the prompts of your own sessions. A routine that runs with `claude -p` can use `--permission-prompts none` instead.

| Routine | Schedule | Skills | What it does |
|---|---|---|---|
| `nightly-cleanup` | 02:30 every day | `cleanup` | Removes dead worktrees and archives finished sessions |
| `morning-prep` | 07:30 Monday to Friday | `start-work` (stages 1 and 2) | Housekeeping and inbox; writes the day document to the Work Monitor; starts no work |
| `weekly-setup-audit` | 08:00 every Monday | `setup-audit` | Audits this repo and reports; changes nothing |
| `weekly-claude-releases` | 08:30 every Monday | `artifact-design` | Adds the big Claude features and workflow changes of the last 7 days to `docs/claude-releases.md`, logs the merged improvements to `docs/claude-releases-improvements.md`, republishes its artifact (three tabs), writes update proposals and upkeep findings (old skills, retired names, old models) to `docs/claude-releases-proposals.md`, and opens one PR on `docs/claude-releases`; never merges |
| `prefs-sync` | 19:00 every day | `sync-prefs` | Sends changed local preferences to the repo as one PR on `prefs/sync`; never merges |
| `project-daily` (template) | set per project | `start-work` (stages 1 and 2, one project) | Housekeeping and inbox of one project; writes the day document `<date>_<folder>`; starts no work |

## One routine per project

`project-daily.md` is a template, not a task. To add a daily routine for a project:

1. Make sure the project is a line of `bash ~/.claude/list-projects.sh`.
2. Tie the project's extra sources to it: add the line `Project: <folder>` to each of its files in `start-work.d/`.
3. Create one scheduled task with the id `daily-<folder>`. Its prompt says: read `routines/project-daily.md` from the main checkout of this repo, follow it, and PROJECT is `<folder>`. Give it its own cron line.
4. In the morning, `/start-work <folder>` uses the prepared day document and goes to the plan.

`morning-prep` does the same for all projects in one run. Use one or the other for a project, not the two.
