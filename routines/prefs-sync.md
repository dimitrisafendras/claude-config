---
name: prefs-sync
description: Daily. Sends changed local Claude preferences to the repo as one PR on the branch prefs/sync. Never merges.
schedule: "0 19 * * *"   # 19:00 every day, local time
skills: [sync-prefs]
---

You run alone on a schedule. Nobody watches. Follow the `sync-prefs` skill exactly.

Hard rules:
- Limits: at most 25 tool calls and 15 minutes. At a limit, stop and say which limit stopped you.
- One PR at most, on the branch `prefs/sync`. If a PR from that branch is open, update it. Never open a second one.
- Never merge, never delete a branch, never change a local file, never write in the main checkout.
- Do not commit when the safety check finds a secret or a company name in the core. Stop and report the file.
- Do not ask questions. If the desktop settings tool is not available, sync only the files and say so.
- A denied tool call is not a failure: write it in the report with the command, and go on or stop on doubt.
- Write the report to `~/.claude/routines/reports/prefs-sync-<YYYY-MM-DD>.md`: the PR link or "in sync", and the files in it.
