# Keep the board current

This is the canonical version of the board rules. Skills that touch tickets carry a short copy that points back here. The board's extra source file in `~/.claude/start-work.d/` adds what is specific to that board: the tool calls, the exact status names, the ids, and any release rule. Read it when a ticket is involved.

The board should show where each task really stands, so someone who only looks at the board knows what is happening without asking. The status says *where* the work is. A comment says *something the status can't*. The agent makes the moves that happen while it works; the dispatcher makes the ones that follow a merge or a release, one call each.

**Status, in order.** Statuses differ between boards: read the exact names once (the source file says how) and pass them in the agent's prompt.

| Status | Means | Who moves it |
|---|---|---|
| **in progress** | Work on it has started | agent, when it starts |
| **blocked** | Stopped on something outside the task; the comment names it | agent, when it stops |
| **in review** | The code is written, reviewed and merged into the feature branch, whose draft PR is open | dispatcher, after the merge |
| **done** | Merged to the default branch, unless the board's source file says otherwise | dispatcher, after the feature PR merges |
| **closed** | Released to production, with release evidence | dispatcher, once the evidence exists |

- **done means merged**, even when a deploy, a measurement or a flag switch is still pending. A ticket with more of its own work still in flight on another feature stays **in review** until that one merges too.
- **closed means released.** Close a ticket only when its merge commit is in a production release and that release went out. The source file says how to prove it. No release evidence, no **closed**. A `done` ticket that waits for a release is in the right state, not a stale one.

**Comment only when the status can't say it.** A comment that repeats the status ("started", "merged", "in review now") is noise people learn to skip, and then they miss the one that mattered. Write one when:
- **The scope moved.** Part of the ticket was dropped, split off into a new ticket (link it), or more was done than it asked for. Say what changed and why.
- **The implementation diverged** from what the ticket or its design described. It took a different approach, layer, data model or API shape than written, or a stated assumption turned out wrong. Say what was built instead and why. A reviewer reading the ticket against the PR should not be surprised.
- **It's blocked.** Name the blocker and what unblocks it.
- **A decision is needed** from the user or a teammate. Ask the question. Don't guess.
- **Verification couldn't be done or failed** (see the dev skills' verify sections), or something is still outstanding after **done**: a deploy step, a migration to apply by hand, a flag to switch, a follow-up ticket.
- **A triage verdict with no code change.** The comment is the result. The status stays where it is for the user to decide.

When you do comment, include the evidence: links, commit SHAs, PR numbers, test counts, error-tracker facts. Never write "should be fixed". The PR link itself needs no comment when the ticket id is in the PR body (`Refs: <ticket id>`).

**Limits:**
- Only touch tickets the task covers. Never reassign, re-date or re-prioritise a ticket, and never set **done** or **closed** without the evidence above.
- Changing a status or posting a comment is outward-facing. Invoking this skill, or any skill that points here, authorises the transitions and comments above for the tasks in hand, and nothing beyond them.
