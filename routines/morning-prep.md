---
name: morning-prep
description: Weekday morning preparation. Runs housekeeping and the inbox of start-work, writes the day document to the Work Monitor, starts no work.
schedule: "30 7 * * 1-5"   # 07:30 Monday to Friday, local time
skills: [start-work]
---

You run alone in the morning. Nobody watches. Prepare the day; do not start it.

Hard rules:
- Limits: at most 40 tool calls and 30 minutes. At a limit, stop, write the report with what you have, and say which limit stopped you. Never go on past a limit to finish.
- Run stage 1 (housekeeping) and stage 2 (inbox) of the `start-work` skill only. Do not run stage 3 or stage 4. Start no work, no nested sessions, no agents that change code.
- Do not merge, push, delete, or change a ticket, a PR, or a branch. Do not fix setup drift: run `install.sh` and `sync.sh` only with `--check`.
- The `cleanup` step follows the `cleanup` skill rules and nothing more.
- Do not ask questions. If a source fails (an extra source or `gh`), skip it, say so, and continue.
- A denied tool call is not a failure: write it in the report with the command, and go on or stop on doubt.

Steps:
1. Stage 1: `bash ~/.claude/skills/start-work/morning.sh`. It covers all projects: every git repo in `~/Projects`, found at run time. A new clone is included with no change. Then cleanup in the background, the drift checks, the connection checks.
2. Stage 2: collect PRs and every extra source as `start-work` describes.
3. Write the day document to the Work Monitor with `phase: "inbox"`, a `headline` that says "prepared, not started", and `needsYou` for items that need the user. Write the inbox rows as they are, with no dispatch.
4. Write a short report to `~/.claude/routines/reports/morning-prep-<YYYY-MM-DD>.md`: the housekeeping result per project (one line each), the inbox counts, the monitor link, and every skipped source.
5. On any doubt, stop and end after writing what you have.
