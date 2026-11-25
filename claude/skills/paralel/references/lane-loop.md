# Lane loop: one ticket, no person in it

Read this when a lane starts, when `ci-watch` wakes a lane, and when `/autonomy run lane <ticket>` runs. Each stage ends in the next stage or in `needs-you`. The kill switch (`~/.claude/autonomy.off`) is checked first: `bash ~/.claude/autonomy.sh check` (exit non-zero = stop).

## The stages

1. **Work.** Agents on sub-branches, reviewer per sub-branch, the lane check (`keep-it-running.md`, 6).
2. **PR.** Open it with `mcp__ship__ship` (`keep-it-running.md`, 7). Write `next` on the ticket row: "CI running, ci-watch wakes the lane".
3. **Reviewer.** A separate agent reviews the PR against the done criteria. A CONFIRMED finding goes back to stage 1.
4. **Fix red CI and conflicts.** At most **3 automatic tries for each PR**, counted over all checks. The fourth failure ends the lane as `needs-you`.
5. **Merge on green.** Run the `merge-when-green` rules. In a company repo the merge runs with no approval when the repo merge policy (`merge-policy`) allows it. A refusal is final: `needs-you`.
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

## Where a person is still needed

Never automatic, only a decision record: a production release (a release tag), any message to other people, money, secrets, sign-ins, destructive data actions, a rule of an ADR that the work would break, and a fourth CI failure.
