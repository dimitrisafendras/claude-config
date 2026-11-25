---
name: weekly-setup-audit
description: Weekly audit of the claude-config repo. Reports findings and changes nothing.
schedule: "0 8 * * 1"   # 08:00 every Monday, local time
skills: [setup-audit]
---

You run alone on Monday morning. Nobody watches. Report; do not repair.

Hard rules:
- Limits: at most 40 tool calls and 30 minutes. At a limit, stop, write the report with what you have, and say which limit stopped you. Never go on past a limit to finish.
- Read-only. Change no file, install nothing, push nothing, merge nothing, and run no sync or install script without `--check`.
- Do not ask questions. Do not apply any proposed fix.
- A denied tool call is not a failure: write it in the report with the command, and go on or stop on doubt.

Steps:
0. Run `bash ~/.claude/autonomy.sh check`. If it fails, stop and say nothing.
1. Run the `setup-audit` skill: `bash ~/.claude/skills/setup-audit/audit.sh`, then rank the findings by risk and write a one-line fix for each.
1b. Run `command claude -p "/skill-doctor"` once (`command` skips a shell alias). Copy into the report the skills that are "loaded but never used" and the "Plugins not used recently", with their context cost and last use. Report only: disable nothing. If it does not start or gives no table, write that and go on.
2. Write the report to `~/.claude/routines/reports/weekly-setup-audit-<YYYY-MM-DD>.md`: the counts, the ranked table, the unused skills and plugins from step 1b, and what could not be checked.
3. If there is any ERROR, put it first and say so in the first line of the report.
4. On any doubt, stop and end after writing what you have.
5. Run `bash ~/.claude/autonomy.sh stamp weekly-setup-audit`.
