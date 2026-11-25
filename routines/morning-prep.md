---
name: morning-prep
description: Weekday morning loop. Runs housekeeping and the inbox of start-work, writes the day document to the Work Monitor, then starts the tickets that are ready (not blocked, not waiting for a person) with paralel, up to the memory room.
schedule: "30 7 * * 1-5"   # 07:30 Monday to Friday, local time
skills: [start-work, paralel]
---

You run alone in the morning. Nobody watches. Prepare the day, then start the work that is safe to start.

Hard rules:
- Limits: at most 60 tool calls and 45 minutes for this session. At a limit, stop, write the report with what you have, and say which limit stopped you. Never go on past a limit to finish. The sessions that `paralel` starts have their own limits.
- Run stage 1 (housekeeping) and stage 2 (inbox) of the `start-work` skill, then the dispatch of step 5. Do not run the stage 3 question: nobody answers it.
- Start only tickets that are ready: assigned to the user, not marked `needs-you`, not `blocked`, not `in review`, not waiting for a person (a question, a review or an answer from somebody), and with no open decision record. Never start a ticket marked needs-you or blocked, also when its source says it is urgent.
- Start no more sessions than the memory room allows: run `bash ~/.claude/mem-budget.sh` before each start, and stop starting at its first "wait" (exit 1). Queue the rest.
- Do not merge, push to a default branch, delete, or close anything in this session. The started sessions follow the `paralel` rules: merges on green only under the merge policy, at most 3 automatic fix tries per PR, then needs-you with a decision record.
- A production release (a release tag), a message to other people, money, secrets, sign-ins and destructive data actions are never done by a loop. Each one becomes a decision record (`routines/README.md` has the format) and a `needsYou` line.
- Do not fix setup drift: run `install.sh` and `sync.sh` only with `--check`. The `cleanup` step follows the `cleanup` skill rules and nothing more.
- Do not ask questions. If a source fails (an extra source or `gh`), skip it, say so, and continue.
- A denied tool call is not a failure: write it in the report with the command, and go on or stop on doubt.

Steps:
1. Run `bash ~/.claude/autonomy.sh check`. If it fails, stop and say nothing.
2. Stage 1: `bash ~/.claude/skills/start-work/morning.sh`. It covers all projects: every git repo in `~/Projects`, found at run time. A new clone is included with no change. Then cleanup in the background, the drift checks, the connection checks.
3. Stage 2: collect PRs and every extra source as `start-work` describes.
4. Write the day document to the Work Monitor with `phase: "inbox"`, a `headline` that says "prepared", and `needsYou` for items that need the user. Give a ticket row a `next` line (90 characters or less) that says its next step.
5. Start the work. Rank the rows as stage 3 of `start-work` does (with today's cut of 12 rows) and keep only the ready rows (see the hard rules). Run `/paralel` for them, one session per ticket, up to the memory room. PR fixes (red CI, conflict, changes requested) of the user's own PRs are ready too. Set `phase: "running"` and write which rows started, which wait for memory and which wait for the user.
6. Run `bash ~/.claude/autonomy.sh check` again before each session start. If it fails, start nothing more, write the report, and end.
7. Write a short report to `~/.claude/routines/reports/morning-prep-<YYYY-MM-DD>.md`: the housekeeping result per project (one line each), the inbox counts, the rows started, queued and held (with the reason), the monitor link, and every skipped source.
8. On any doubt about a row, do not start it: put it in `needsYou` and go on with the next row.
9. Run `bash ~/.claude/autonomy.sh stamp morning-prep`.
