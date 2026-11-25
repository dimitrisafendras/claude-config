# Routines

A routine is a prompt that runs on a schedule with no one watching. Each file has frontmatter (`name`, `description`, `schedule`, `skills`) and the prompt the scheduled agent gets.

Routines are registered as scheduled tasks (the `scheduled-tasks` tool, or `/schedule`). The file in this repo is the source of the prompt: to change a routine, edit the file, then update the scheduled task with the same prompt.

Rules for every routine:
- The first step is `bash ~/.claude/autonomy.sh check`: when it fails, the routine stops and says nothing. The last step is `bash ~/.claude/autonomy.sh stamp <name>`.
- Safe when unattended: no deletes beyond what `/cleanup` allows. Merges and pushes only inside the autonomy scope below.
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
| `config-loop` | 03:00 every day | `setup-audit`, `merge-when-green` | In the main checkout, only when it is clean and on `main`: pulls, `./install.sh --mods`, `./install.sh --check`, `setup-audit` read-only; sends the safe fixes as one PR on `config/nightly` that merges on green. Else it only reports the state |
| `morning-prep` | 07:30 Monday to Friday | `start-work` (stages 1 and 2), `paralel` | Housekeeping and inbox; writes the day document to the Work Monitor; then starts the ready tickets (not blocked, not needs-you, not waiting for a person) with `/paralel`, up to the memory room |
| `daily-digest` | 08:15 Monday to Friday and 18:00 every day | `monitor` | One short message: what merged, what is verified, what waits for you, with the decision record of each waiting item. Takes the default of a reversible record at its deadline; never resolves an irreversible one |
| `sweep` | 12:00 every day | `pr-sweep`, `merge-when-green` | `pr-sweep` with fixes: updates PRs that are behind, repairs conflicts and red CI (3 tries at most per PR); merges only where the merge policy permits; writes a decision record for each other PR |
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

## Kill switch and manual run

`claude/scripts/autonomy.sh` (installed as `~/.claude/autonomy.sh`) controls all loops. The `/autonomy` skill wraps it.

| Command | What it does |
|---|---|
| `autonomy.sh check` | Exit 0 when loops may run. Exit 1, with the reason, when `~/.claude/autonomy.off` exists |
| `autonomy.sh off [reason]` | Makes `~/.claude/autonomy.off` with the reason and the time: all loops stop at their first step |
| `autonomy.sh on` | Removes `~/.claude/autonomy.off` |
| `autonomy.sh status` | The kill switch state, then each loop with its schedule, last run and next run |
| `autonomy.sh stamp <loop>` | Records a run in `~/.claude/autonomy/last-run.json` |
| `autonomy.sh run <loop>` | Manual run: prints the path of `routines/<loop>.md` and its prompt with no frontmatter, so a session can run it once now, then stamps it. Refuses (exit 1) when the kill switch is on |

To run a loop once now, run `bash ~/.claude/autonomy.sh run <loop>` in a session and follow the prompt that it prints. A routine with two times has a list: `schedule: ["15 8 * * 1-5", "0 18 * * *"]`. Register one scheduled task for each time.

## Autonomy scope

- At most 3 automatic fix tries per PR. Then the PR is needs-you, with a decision record.
- With no approval: merges on green where the merge policy permits (`~/.claude/merge-policy.json`, read by the `merge-policy` mod), a staging deploy and a staging verify.
- Always manual, and shown only as decision records: a production release (a release tag), a message to other people, money, secrets, sign-ins and destructive data actions.
- A ticket marked needs-you or blocked is never started by a loop.

## Decision records

A loop that needs the user writes a decision record to `~/.claude/autonomy/decisions.json` (a JSON array) and does not wait. The format:

```json
{"id": "sweep-owner-repo-42", "ticket": "ABC-123", "question": "CI is red after 3 tries. Close the PR or keep it?", "options": ["keep open", "close"], "default": "keep open", "deadline": "2026-01-02T09:00:00Z", "reversible": true}
```

- `ticket` is a ticket id or `null`. `options` has two strings; `default` is one of them. `deadline` is an ISO time.
- `daily-digest` shows each open record. At the deadline of a record with `"reversible": true` it takes the default and logs it to `~/.claude/autonomy/decisions-log.jsonl`. A record with `"reversible": false` never resolves by itself.
- A ticket row of the Work Monitor can carry `next`: its next step, 90 characters or less.
