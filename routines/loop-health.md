---
name: loop-health
description: Weekly check of the loops. Reads autonomy.sh status, lists each loop that never ran or is late (no run within twice its period), and writes a decision record or a needs-you line for each. Changes nothing else.
schedule: "45 8 * * 1"   # 08:45 every Monday, local time
skills: [autonomy]
---

You run alone on Monday morning. Nobody watches. Find the loops that stopped; do not repair them.

Hard rules:
- Limits: at most 20 tool calls and 15 minutes. At a limit, stop, write the report with what you have, and say which limit stopped you. Never go on past a limit to finish.
- Read-only. The only files you write are the decision records in `~/.claude/autonomy/decisions.json` and the report. Run no loop, register or change no scheduled task, and do not stamp another loop.
- Do not ask questions. A denied tool call is not a failure: write it in the report with the command, and go on or stop on doubt.

Steps:
1. Run `bash ~/.claude/autonomy.sh check`. If it fails, stop and say nothing.
2. Run `bash ~/.claude/autonomy.sh status`. Each loop row gives its schedule (one or more cron lines), its last run and its next run.
3. Find the period of each loop from its schedule: the shortest time between two runs. A loop with two times uses the shorter period. For a Monday-to-Friday schedule (`1-5`), count only weekdays, so a Friday run is not late on Monday.
4. Mark each loop:
   - **never ran**: the last run is `never`.
   - **late**: the last run is older than twice its period.
   - **ok**: all the others.
5. For each loop that never ran or is late:
   - A loop that never ran: write a needs-you line in the report: "<loop>: never ran. Register its scheduled task, or remove the routine." For a template (`project-daily`, `project-morning`) add: "a template runs only when a project task uses it".
   - A loop that is late: add one decision record to `~/.claude/autonomy/decisions.json` (`routines/README.md` has the format): id `loop-health-<loop>`, ticket `null`, question "<loop> last ran <time>, its period is <period>. Run it now?", options `["run it now with /autonomy run <loop>", "leave it"]`, default `"leave it"`, deadline the next day 09:00, `"reversible": true`. If an open record with that id is there, do not add a second one.
   - Do not write a record or a line for an `ok` loop.
6. Write the report to `~/.claude/routines/reports/loop-health-<YYYY-MM-DD>.md`: the kill switch state, a table (loop, schedule, last run, period, mark), the needs-you lines and the ids of the new decision records. If all loops are `ok`, say so in the first line.
7. On any doubt about a loop, mark it in the report as unsure and write no record for it.
8. Run `bash ~/.claude/autonomy.sh stamp loop-health`.
