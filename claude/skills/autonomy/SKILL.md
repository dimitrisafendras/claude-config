---
name: autonomy
description: Control the autonomy loops. Show their state, stop all loops with the kill switch, start them again, or run one loop once by hand (the manual trigger). Use for "/autonomy", "autonomy status", "autonomy off", "autonomy on", "stop all loops", "kill switch", "pause the automation", "run morning-prep now", "run the lane loop for a ticket", "trigger a loop".
argument-hint: "status | off [reason] | on | run <loop> | run lane <ticket>"
model: sonnet
effort: low
---

# Autonomy

The loops run flows with no person in them. This skill shows them, stops them and runs one by hand. The script `~/.claude/autonomy.sh` holds the state. Never write the state files yourself.

## Commands

- **`/autonomy status`**: run `bash ~/.claude/autonomy.sh status`. Show each loop with its last run and next run, and the kill switch. Add one line: what needs the person (open decision records).
- **`/autonomy off [reason]`**: run `bash ~/.claude/autonomy.sh off "<reason>"`. This creates `~/.claude/autonomy.off`. Every loop stops at its next check. Say so in one line.
- **`/autonomy on`**: run `bash ~/.claude/autonomy.sh on`. This removes the file. Then run `status`.
- **`/autonomy run <loop>`**: the manual trigger. See below.
- **`/autonomy run lane <ticket>`**: run the lane loop for one ticket now (see below).

## Manual trigger

Loops: `morning-prep`, `project-daily`, `daily-digest`, `sweep`, `config-loop`, `weekly-setup-audit`, `weekly-claude-releases`, `nightly-cleanup`, `prefs-sync`.

1. Run `bash ~/.claude/autonomy.sh run <loop>`. The script checks the kill switch, writes the stamp and prints the prompt of the loop.
2. If the script refuses (kill switch on, unknown loop), say why and stop. Do not work around it.
3. Else do what the printed prompt says, once, in this session. Use the same rules as the scheduled run. Do not schedule anything.
4. Report in two lines: what the loop did, and what it left for the person.

A manual run ignores the schedule, not the kill switch and not the limits.

## Lane loop for one ticket

`/autonomy run lane <ticket>` (for example `SN-123`):

1. Run `bash ~/.claude/autonomy.sh run lane <ticket>`. Stop if it refuses.
2. Read the ticket. A ticket that is blocked or `needs-you` does not start: say why. Then claim it: `bash ~/.claude/claims.sh claim <board>:<ticket> --owner <this session> --note "<title>"`. Exit 1 means another session owns it (a morning loop, a lane, a person): say who, and stop. Never take it by force.
3. Run the `paralel` lane loop for this one ticket (see "Lane loop" in the `paralel` skill): work, PR, reviewer, CI fixes, merge on green, deploy check, staging verify, close, cleanup.
4. End with `done` or `needs-you` and the decision record.

## Limits

- At most 3 automatic fix tries for each PR. Then `needs-you` with a decision record.
- Allowed with no approval in company repos: merge on green under merge-policy, staging deploy, staging verify.
- Always manual, and shown only as a decision record: a production release (a release tag), a message to other people, money, secrets, sign-ins, destructive data actions.

## Next

- A decision is open → answer it in the Decisions card of `flow-view`, or in the ticket.
- Loops look wrong → `/setup-audit`.
