# Flows

The setup runs four flows. Each is a loop with no person in it. A person is needed only at the manual gates. Each flow has a trigger: a routine (time), an event (for example `ci-watch` sees a merge) or a manual run with `/autonomy run <loop>`.

## Kill switch and limits

- **Kill switch:** the file `~/.claude/autonomy.off`. While it exists, every loop stops at its next check. `/autonomy off [reason]` creates it. `/autonomy on` removes it. `/autonomy status` shows it with each loop, its last run and its next run.
- **Manual trigger:** `/autonomy run <loop>` runs one loop once, in the session. `/autonomy run lane <ticket>` runs the lane loop for one ticket. A manual run ignores the schedule, not the kill switch and not the limits.
- **Fix limit:** at most 3 automatic fix tries for each PR. Then the lane ends `needs-you` with a decision record.
- **Automatic in company repos:** merge on green under `merge-policy`, staging deploy, staging verify.
- **Manual gates:** a production release (a release tag), any message to other people, money, secrets, sign-ins and destructive data actions. These appear only as decision records.

## Decision records

A loop that cannot go on writes one record and ends `needs-you`:

```json
{"id": "d-0001", "ticket": "SN-123", "question": "...", "options": ["a", "b"], "default": "b", "deadline": "2026-11-26T09:00:00Z", "reversible": true}
```

A reversible record takes its `default` at the `deadline`. An irreversible one never does. The `flow-view` mod shows open records in its Decisions card. A ticket row can carry `next` (up to 90 characters): what the system does next and when.

## 1. Start the day

Skill `start-work`. Trigger: routine `morning-prep` (time), or `/start-work`, or `/autonomy run morning-prep`.

Loop: housekeeping → inbox → one plan → start the work for each ticket that is not `blocked` and not `needs-you` → lanes (flow 2). Other routines in this flow: `project-daily` (one project), `daily-digest` (what happened, what waits), `sweep` (open PRs of the person).

Person needed: a row that is `needs-you`; any manual gate.

## 2. Do the work

Skill `paralel` (lane loop), with `ci-watch` and `merge-when-green`. Trigger: a plan row starts a lane; `ci-watch` wakes the lane at each CI event; `/autonomy run lane <ticket>` runs one lane now.

Loop: work → PR → reviewer → fix red CI and conflicts (at most 3 tries) → merge on green under `merge-policy` → deploy check → verify on staging → close the ticket → cleanup. Each lane ends `done` or `needs-you` with a decision record. Each lane writes the `next` field of its ticket row.

Person needed: a fourth CI failure, a refused merge rule, any manual gate.

## 3. After the merge

Skills `deploy` and `cleanup`. Trigger: event. `ci-watch` sees the merge and starts `deploy`; `cleanup` runs right after for that lane. The routine `nightly-cleanup` is the net for all lanes.

Loop: wait for the staging deploy → test the PR test plan on staging → attach the evidence to the ticket → close the ticket → remove the worktree and branch.

Person needed: a failed deploy or failed verify (decision record), a sign-in page, and the production release. A release tag is never automatic.

## 4. Change the setup

Skills `ship-mod`, `setup-audit`, `sync-prefs`. Trigger: routines `weekly-setup-audit`, `weekly-claude-releases`, `config-loop`, `prefs-sync`; or `/ship-mod`.

**Local-first rule for a mod change:** edit the mod in the main checkout, run `/reload-plugins`, and use it. Open one PR only after the person approves the result. Then `ship-mod` commits, opens the PR, merges on green, pulls main and installs.

Person needed: the approval of a mod change. The loops open PRs for the setup; they do not install mods by themselves.

## Loops and their routines

| Loop | Flow | Trigger |
|---|---|---|
| `morning-prep` | Start the day | routine |
| `project-daily` | Start the day | routine |
| `project-morning` | Start the day | routine |
| `daily-digest` | Start the day | routine |
| `sweep` | Start the day | routine |
| lane loop | Do the work | event (`ci-watch`), `/autonomy run lane <ticket>` |
| `nightly-cleanup` | After the merge | routine |
| `config-loop` | Change the setup | routine |
| `weekly-setup-audit` | Change the setup | routine |
| `weekly-claude-releases` | Change the setup | routine |
| `prefs-sync` | Change the setup | routine |

Every loop runs by hand with `/autonomy run <loop>`.
