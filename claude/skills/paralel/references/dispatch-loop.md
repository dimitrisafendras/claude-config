# The dispatcher loop and the ledger (detail)

The full text of the core loop in `../SKILL.md`; its step numbers match.

## Dispatcher mode

Once invoked, this stays in force for the rest of the session. The main session becomes a **dispatcher**. It takes a request, sizes it, spawns a background agent on the cheapest model that can do the job well, and gets back to the user straight away. It does not do the work itself. It does own the branches: it creates each feature branch, merges reviewed agent work into it, and cleans up after it.

## The loop

For every request the user sends while this mode is on:

1. **Get just enough context to size it, cheaply and yourself.** Fetch the ticket (plus comments and subtasks) from whatever tracker is connected, run one `gh pr view --json ...`, or do one grep. That's all. Don't read the codebase to "understand it first". That is the agent's job, and doing it here burns the dispatcher's own (expensive) context.
2. **Size it** with the rubric in `sizing-tiebreakers.md`. Pick a model and its effort and write down the reason in one clause. A main task with subtasks is sized per subtask: each subtask gets its own agent, model and effort.
3. **Place it.** Code-changing work goes on a sub-branch of a feature branch (see `branches-and-worktrees.md`). Is an agent already working on this ticket, branch or file? Then send it a message (`SendMessage`) instead of spawning a second one. Will two agents touch the same files? Give each one a disjoint set of paths and say so in both prompts.
4. **Spawn it** with `Agent`, `run_in_background: true`, an explicit `model` and an explicit `effort`. Use the template in `prompt-template.md`.
5. **Tell the user in one line:** what was dispatched, on which model and effort, on which branch, and why. Then take the next request. Don't wait on the agent.
6. **Review before anything lands.** When a work agent reports a pushed sub-branch, dispatch a **separate reviewer agent**, never the author, before you merge it into the feature branch or tell the user it's done. The author's "tests pass" is a claim to check, not a review.
   - Reviewer sizing, what the reviewer gets, and what to do with its findings (CONFIRMED / PLAUSIBLE), plus when the gate may be skipped: read `review-protocol.md` before dispatching any reviewer.
   - After a clean review, merge the sub-branch into the feature branch, push, and **remove the sub-branch's worktree and branches in the same turn** (the hard rule in `../SKILL.md` and `cleaning-up-worktrees.md`).
7. **When it finishes, relay the outcome.** Give the branch and merge commit (or the PR URL), the verdict, the numbers, and any open questions. The user never sees the agent's own report, so passing it on is your job. Check any claim that matters (for example "CI green" or "merged") with one cheap call before repeating it.
8. **Escalate only on evidence.** If an agent comes back stuck because the task was harder than sized (not because of missing access or a real blocker), re-dispatch it one step up (first one effort level, then one tier) and include what the first attempt learned. Never pre-emptively "just use Opus to be safe".

## Ledger

The ledger is one live table. The coordinator reprints it in full, below a one-line reason, **every time a state changes**: a lane starts, queues or ends; an agent starts, finishes or fails; a review result arrives; a PR changes (draft, ready, CI, merged). Do not reprint it on a timer or when nothing changed. One row for each lane session, and one row for each agent in it:

```
Ledger (room 2, free 41%)                         changed: lane B merged #581
lane  item         where     branch / PR                    agents                                state
A     TICKET-1     session   feature/ask-ai · draft #580    [opus/high] --adr running             running
                                                            [sonnet/medium] --ui merged, removed
B     TICKET-3     session   feature/recall · #581          [sonnet/medium] --api merged, removed merged
C     TICKET-2     queued    —                              —                                     waits for memory
here  TICKET-4     this      —                              [haiku/low] status move               done
```

State is one of: queued, running, review, ready, merged, verified, blocked, failed, done. Write the ledger file (`keep-it-running.md`, 2) before you print the table. Agents show model and effort, sub-branch suffix and result. A cell comes from a verified fact (`gh pr view`, the lane's report that you checked), never from a guess. A lane you have not heard from keeps its last state and shows `no report`.

When the user asks "what's running?" or "status", answer with the table. For agents still running, say so. Don't guess at their results. The ledger is also the record of which branches and worktrees this session created, and the cleanup checks it before removing anything.

