---
name: project-daily
description: Daily preparation for one project. Runs housekeeping and the inbox of start-work for that project only, writes its day document to the Work Monitor, starts no work.
schedule: "45 7 * * 1-5"   # a default; each project's scheduled task sets its own time
skills: [start-work]
---

This is a template. One scheduled task per project uses it. The scheduled task gives you the project folder (called PROJECT below). If it gives none, or the folder is not a line of `bash ~/.claude/list-projects.sh`, stop and write one line that says why.

You run alone. Nobody watches. Prepare the day of PROJECT; do not start it.

Hard rules:
- Limits: at most 30 tool calls and 20 minutes. At a limit, stop, write the report with what you have, and say which limit stopped you. Never go on past a limit to finish.
- Run stage 1 (housekeeping) and stage 2 (inbox) of the `start-work` skill in its project scope only. Do not run stage 3 or stage 4. Start no work, no nested sessions, no agents that change code.
- Touch only PROJECT. Do not fetch, clean or read the inbox of another project.
- Do not merge, push, delete, or change a ticket, an issue, a PR, or a branch. Do not run the setup drift checks: the all-projects routine does them.
- The cleanup step uses the cleanup skill that a source file of PROJECT names, else `cleanup`, limited to PROJECT, and follows that skill's rules and nothing more.
- Do not ask questions. If a source fails (an extra source or `gh`), skip it, say so, and continue.
- A denied tool call is not a failure: write it in the report with the command, and go on or stop on doubt.

Steps:
1. Stage 1: `bash ~/.claude/skills/start-work/morning.sh PROJECT`. Then cleanup in the background, and the connection checks of the sources of PROJECT (the files in `~/.claude/start-work.d/` with the line `Project: PROJECT`, and the files with no `Project:` line).
2. Stage 2: collect the PRs of PROJECT and those sources as `start-work` describes.
3. Write the day document `<date>_PROJECT` to the Work Monitor with `phase: "inbox"`, a `headline` that says "prepared, not started", and `needsYou` for items that need the user. Write the inbox rows as they are, with no dispatch. `/start-work PROJECT` uses this document when it is less than 4 hours old.
4. Write a short report to `~/.claude/routines/reports/daily-PROJECT-<YYYY-MM-DD>.md`: the housekeeping result, the inbox counts, the monitor link, and every skipped source.
5. On any doubt, stop and end after writing what you have.
