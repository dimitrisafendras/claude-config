---
name: project-morning
description: Morning loop for one project. Prepares the day of that project (housekeeping and inbox of start-work), then starts its ready tickets with the dispatcher of the project, up to the memory room.
schedule: "30 8 * * 1-5"   # a default; each project's scheduled task sets its own time
skills: [start-work, paralel]
---

First run `bash ~/.claude/autonomy.sh check`. If it fails, stop and say nothing.

This is a template. One scheduled task per project uses it. The scheduled task gives you the project folder (called PROJECT below). If it gives none, or the folder is not a line of `bash ~/.claude/list-projects.sh`, stop and write one line that says why.

You run alone. Nobody watches. Prepare the day of PROJECT, then start the work that is safe to start.

Hard rules:
- Limits: at most 60 tool calls and 45 minutes for this session. At a limit, stop, write the report with what you have, and say which limit stopped you. The sessions that the dispatcher starts have their own limits.
- Touch only PROJECT. Do not fetch, clean or read the inbox of another project.
- Run stage 1 (housekeeping) and stage 2 (inbox) of the `start-work` skill in the scope of PROJECT, then the dispatch of step 5. Do not run the stage 3 question: nobody answers it. Do not run the setup drift checks.
- The dispatcher is the skill that the `Dispatcher` line of a source file of PROJECT names, else `paralel`. The cleanup skill comes from the same file in the same way, else `cleanup`.
- Start only tickets that are ready: assigned to the user, not marked `needs-you`, not `blocked`, not `in review`, not waiting for a person, and with no open decision record. Never start a needs-you or blocked ticket, also when its source says it is urgent.
- Start no more sessions than the memory room allows: run `bash ~/.claude/mem-budget.sh` before each start, and stop at its first "wait" (exit 1). Queue the rest.
- Do not merge, push to a default branch, delete, or close anything in this session. The started sessions follow the dispatcher rules: merges on green only under the merge policy, at most 3 automatic fix tries per PR, then needs-you with a decision record.
- A production release, a message to other people, money, secrets, sign-ins and destructive data actions are never done by a loop. Each one becomes a decision record (`routines/README.md` has the format) and a `needsYou` line.
- Follow the ticket rules of the source files of PROJECT (ticket id, PR title, no AI attribution where a source says so).
- Do not ask questions. If a source fails, skip it, say so, and continue. A denied tool call is not a failure: write it in the report and go on, or stop on doubt.

Steps:
1. Stage 1: `bash ~/.claude/skills/start-work/morning.sh PROJECT`. Then cleanup in the background and the connection checks of the sources of PROJECT (the files in `~/.claude/start-work.d/` with the line `Project: PROJECT`, and the files with no `Project:` line).
2. Stage 2: collect the PRs of PROJECT and those sources as `start-work` describes.
3. Write the day document `<date>_PROJECT` to the Work Monitor with `phase: "inbox"`, a `headline` that says "prepared", and `needsYou` for items that need the user. Give a ticket row a `next` line (90 characters or less).
4. Rank the rows as stage 3 of `start-work` does and keep only the ready rows.
5. Start the work: run the dispatcher for the ready rows, one session per ticket, up to the memory room. PR fixes (red CI, conflict, changes requested) of the user's own PRs are ready too. Set `phase: "running"` and write which rows started, which wait for memory and which wait for the user.
6. Run `bash ~/.claude/autonomy.sh check` again before each session start. If it fails, start nothing more, write the report, and end.
7. Write a short report to `~/.claude/routines/reports/morning-PROJECT-<YYYY-MM-DD>.md`: the housekeeping result, the inbox counts, the rows started, queued and held (with the reason), the monitor link, and every skipped source.
8. On any doubt about a row, do not start it: put it in `needsYou` and go on with the next row.
9. Run `bash ~/.claude/autonomy.sh stamp project-morning`.
