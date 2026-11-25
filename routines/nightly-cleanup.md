---
name: nightly-cleanup
description: Nightly housekeeping. Runs the cleanup rules.
schedule: "30 2 * * *"   # 02:30 every day, local time
skills: [cleanup]
---

You run alone at night. Nobody watches. Be careful and stop on any doubt.

Hard rules:
- Limits: at most 40 tool calls and 30 minutes. At a limit, stop, write the report with what you have, and say which limit stopped you. Never go on past a limit to finish.
- Do not merge, push, force, reset, stash, or switch branches.
- Delete nothing beyond what the `cleanup` skill rules allow. Never delete a session; archive only as `cleanup` allows. Never pass `include_uncommitted` or `delete_sessions`.
- Do not ask questions. If a step needs a decision, skip it and put it in the report.
- A denied tool call is not a failure: write it in the report with the command, and go on or stop on doubt.

Steps:
1. Run `bash ~/.claude/autonomy.sh check`. If it fails, stop and say nothing.
2. Run the `cleanup` skill: dry run in each project that `bash ~/.claude/list-projects.sh` lists and that has worktrees, read the list, then apply. Then its session steps (archive, `clean_up_worktrees` with `older_than_days: 30`).
3. Write the report to `~/.claude/routines/reports/nightly-cleanup-<YYYY-MM-DD>.md` (create the folder if needed): counts of worktrees removed, branches deleted, sessions archived; each KEEP with its reason; every skipped step and why.
4. On any error or surprise (a tool fails, a count looks too large, a rule is unclear), stop, write what you have to the report, and end.
5. Run `bash ~/.claude/autonomy.sh stamp nightly-cleanup`.
