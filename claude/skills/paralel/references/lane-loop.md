# Lane loop: one ticket, no person in it

Read this when a lane starts, when `ci-watch` wakes a lane, and when `/autonomy run lane <ticket>` runs. Each stage ends in the next stage or in `needs-you`. The kill switch (`~/.claude/autonomy.off`) is checked first: `bash ~/.claude/autonomy.sh check` (exit non-zero = stop).

## The claim

A ticket has one owner at a time, across all sessions of this computer (a morning loop, a manual `/start-work`, a lane, a person). The claim is the lock: `bash ~/.claude/claims.sh` (`claim`, `heartbeat`, `release`, `check`, `list`). The key is `<board>:<ticket>`, for example `my-app:TICKET-123`. The owner is the name of this lane session.

- **Stage 0, before any edit:** `bash ~/.claude/claims.sh claim <board>:<ticket> --owner <lane name> --note "<ticket title>"`. When the coordinator started this lane, it already holds the claim for this owner: the call renews it. Exit 1 means another session owns the ticket. Stop, work on nothing, and report "claimed by <owner>" in one line. Do not take the claim by force.
- **At each stage change:** the same time that the lane writes `next`, run `claims.sh heartbeat <key> --owner <lane name>`. A claim ends after 4 hours without a heartbeat, so a dead lane frees its ticket by itself. A heartbeat that fails (exit 1) means the claim went to another session: stop and report it.
- **At the end** (`done` or `needs-you`): `claims.sh release <key> --owner <lane name>`. The ticket state, not the claim, then keeps a `needs-you` ticket from a new start.
- Another computer does not see this folder. There the status `in progress` of the ticket is the signal.

## The stages

1. **Work.** Agents on sub-branches, reviewer per sub-branch, the lane check (`keep-it-running.md`, 6).
2. **PR.** Open it with `mcp__ship__ship` (`keep-it-running.md`, 7). Write `next` on the ticket row: "CI running, ci-watch wakes the lane".
3. **Reviewer.** A separate agent reviews the PR against the done criteria. A CONFIRMED finding goes back to stage 1.
4. **Fix red CI and conflicts.** At most **3 automatic tries for each PR**, counted over all checks. The fourth failure ends the lane as `needs-you`. Each try reads the lessons file of the repo (`~/.claude/ci-lessons/<repo>.md`) and the failed log before it names a cause, and adds one entry after the push. Try 2 and 3 run in a fresh subagent that gets the log, the lessons file and one line for each earlier try, not this conversation. When the same checks stay red two times in a row, `ci-watch` stops the tries early: `needs-you`.
5. **Merge on green.** Run the `merge-when-green` rules. Run `gh pr merge` as one Bash call with only that command: `merge-policy` approves only the plain shape, and any other shape asks a person. In a company repo the merge runs with no approval when the repo merge policy (`merge-policy`) allows it. A refusal is final: `needs-you`.
6. **Deploy check.** The `deploy` skill starts by itself when `ci-watch` sees the merge: wait for the staging deploy.
7. **Verify on staging.** The `deploy` skill tests the PR test plan. Evidence goes on the ticket.
8. **Close the ticket.** Only after `verified` (or `done` for a lane with no deploy).
9. **Cleanup.** Run `cleanup` for this lane at once (its worktree and branch).

## The end state

Each lane ends in one of two states:

- `done`: merged, verified, ticket closed, worktree removed.
- `needs-you`: the loop cannot go on by itself. The lane writes one decision record (`SKILL.md`, "Decisions") and stops. It does not wait and does not ask the person in chat.

## The `next` field

Each lane writes the `next` field of its ticket row at every stage change: up to 90 characters, what the system does next and when. Examples: "CI running, fix try 1 of 3 if red", "merge on green under merge-policy", "staging verify after deploy". At `needs-you`, `next` names the decision: "waits for a decision, default at <time>". At `done`, `next` is empty.

### What the Steps tab reads

The Steps tab of the `flow-view` pane puts each ticket on a way of 10 steps: plan, dispatch, environment, work, review, CI, merge, deploy, verify, close. It finds the step from the ticket row: the state, the session, the branch, the PR and the words of `next`. So write these words:

| Stage of the lane | State of the row | `next` must contain |
|---|---|---|
| Reviewer runs (before the PR, or stage 3) | `running` | "review" |
| PR open, CI runs or a fix try runs | `review` | "CI" (not the word "merge") |
| CI green, the merge is next | `review` | "merge" |
| Merged, the deploy runs | `merged` | "deploy" |
| Deploy done, the verify runs | `merged` | "verify" |
| Verified, close and cleanup are next | `merged` | "close" |

A lane that started with no plan row (a manual `/paralel` or `/autonomy run lane <ticket>`) still shows in the tab: the tab reads `claims.sh list` and puts each claim with no row at the step Dispatch, with the note of the claim as its title. So always give `--note "<ticket title>"` with the claim. When the Work Monitor has a day for the project, also write a row for the ticket: only a row lets the tab show the steps after Dispatch.

## Where a person is still needed

Never automatic, only a decision record: a production release (a release tag), any message to other people, money, secrets, sign-ins, destructive data actions, a rule of an ADR that the work would break, and a fourth CI failure.
