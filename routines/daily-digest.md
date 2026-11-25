---
name: daily-digest
description: Twice a day. One short message to the user - what merged, what is verified, what waits for the user. Each waiting item shows its decision record. At the deadline of a reversible record the loop takes the default; an irreversible record never resolves by itself.
schedule: ["15 8 * * 1-5", "0 18 * * *"]   # 08:15 Monday to Friday and 18:00 every day, local time
skills: [monitor]
---

You run alone. Nobody watches. Tell the user, in one short message, where the work stands.

Hard rules:
- Limits: at most 30 tool calls and 15 minutes. At a limit, stop, send what you have, and say which limit stopped you.
- Read-only for code: no merges, no pushes, no branches, no deploys, no ticket changes. The only things you change are the decision records (step 4) and the report.
- The message goes only to the user (the notification or the report). Never send a message to other people.
- An irreversible decision record (`"reversible": false`) never resolves by itself, also after its deadline. Only the user resolves it.
- Do not ask questions. If a source fails, skip it, say so in one line, and continue.
- A denied tool call is not a failure: write it in the report with the command, and go on or stop on doubt.

Decision records are in `~/.claude/autonomy/decisions.json`, a JSON array. Each record has `id`, `ticket` (a ticket id or null), `question`, `options` (two strings), `default` (one of the options), `deadline` (ISO time) and `reversible` (true or false). `routines/README.md` has the full format.

Steps:
1. Run `bash ~/.claude/autonomy.sh check`. If it fails, stop and say nothing.
2. Collect, since the last run of this loop (`bash ~/.claude/autonomy.sh status` shows it; else the last 24 hours), with the `monitor` skill, read-only:
   - Merged: the user's PRs that merged, one line each (repo, number, title).
   - Verified: the merged work that a staging verify passed (from the Work Monitor or the deploy reports in `~/.claude/routines/reports/`).
   - Waiting for the user: the `needsYou` lines of today's day document and the open decision records.
3. Read `~/.claude/autonomy/decisions.json`. If the file does not exist, there are no records. If it does not parse, change nothing in it and say so in the message.
4. For each record whose `deadline` is in the past:
   - `"reversible": true`: take the `default`. Do the step that the default names only when a loop is permitted to do it (see "Autonomy scope" in `routines/README.md`); else only record the choice. Remove the record from `decisions.json` and add one line to `~/.claude/autonomy/decisions-log.jsonl`: the record plus `"taken": "<default>"` and `"at": "<time>"`.
   - `"reversible": false`: change nothing. Show it as "deadline passed, needs you".
5. Write the message, 15 lines or less, with three parts: **Merged**, **Verified**, **Waits for you**. Each waiting item shows its decision record in one or two lines: the question, the two options, the default, the deadline, and "reversible" or "irreversible". Put the irreversible items with a passed deadline first. Write "nothing" for an empty part.
6. Send the message to the user as a push notification when the tool exists (load `PushNotification` with ToolSearch), else put it at the top of the report. Send one message only.
7. Write the report to `~/.claude/routines/reports/daily-digest-<YYYY-MM-DD>-<HHMM>.md`: the message, each default taken (record id and choice), and every skipped source.
8. Run `bash ~/.claude/autonomy.sh stamp daily-digest`.
