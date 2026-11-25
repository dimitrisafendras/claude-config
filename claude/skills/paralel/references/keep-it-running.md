# Keep it running: prompts, the ledger file, silent lanes, deploy, mods

Read this when you start the first lane, and again when a lane stops, goes silent or merges.

## 1. A lane must not wait for the user

The user manages one session. A lane that stops on a permission prompt breaks that.

- **Same mode as the coordinator.** Right after you start a lane, set its permission mode to this session's mode (`set_session_permission_mode`). Never choose a looser mode than this session has. If the tool asks the user to approve the change, that is one approval here, in this session.
- **A refused action goes up.** The lane brief says: when a tool call is refused or needs a prompt you cannot answer, do not retry it and do not wait. Send the coordinator the exact action and why you need it (`SendMessage`), then continue with what is not blocked.
- **The coordinator decides.** It does the action itself only when its own permissions allow it and the user's request covers it. Otherwise it asks the user one question here, with the lane named and the exact action. It never runs, for a lane, an action that the lane's permission check refused, without the user's own yes in this session.
- **A lane that is stuck on a prompt anyway:** say which lane and what the prompt asks, in one line. Set its ledger state to `blocked`.

## 2. The ledger file

The chat ledger can be lost in a crash or a compaction. Keep a copy on disk.

- **File:** `~/.claude/paralel/<repo>-<YYYY-MM-DD>.json`. Create the folder if it is missing.
- **Write it on every state change**, before you print the table. Write the whole file each time.
- **Content:**

```json
{
  "repo": "owner/name", "started": "2026-11-16T09:12:00Z", "updated": "2026-11-16T10:40:00Z",
  "coordinator": "<this session id>",
  "lanes": [
    { "lane": "A", "items": ["TICKET-1"], "session": "<session id or null>", "name": "lane-a-web",
      "worktree": ".claude/worktrees/ask-ai", "branch": "feature/ask-ai", "pr": 580,
      "env": "start-web-dev", "state": "running", "lastReport": "2026-11-16T10:31:00Z",
      "agents": [ { "model": "sonnet", "effort": "medium", "sub": "--ui", "state": "merged, removed" } ],
      "restarts": 0 }
  ],
  "queue": [ { "lane": "C", "items": ["TICKET-2"], "why": "memory" } ]
}
```

- **Resume:** at the start of `/paralel` and of `/paralel status`, look for today's file (and yesterday's, if it has a lane that is not `done`). If one exists and this session has no ledger, load it, check every lane against the facts (`list_sessions` with `linked: true`, `gh pr view`, `git worktree list`), correct the states, and print the table with "resumed from file". Never trust a state in the file over a fact.
- Keep no secrets in the file. Delete nothing: old files are small and are the history.

## 3. Silent, stopped and dead lanes

A lane report is a `SendMessage` to the coordinator. `lastReport` is the time of the newest one.

| What you see | Do |
|---|---|
| The lane is `running` and `lastReport` is older than 20 minutes | Check once: `list_sessions` (linked) for its state. If it works, leave it. If it is idle, send "status?" with `SendMessage` |
| No answer to "status?" at your next turn, or the session ended with no report | Read the facts yourself: the lane's pushed branches, its PR, `git log origin/<branch>`. Put them in the ledger |
| The session stopped or failed (crash, memory) | Restart it **once**: a new lane session with the same brief, plus "resume from the pushed work on `<branch>`; check for saved WIP before you dispatch anything". Count it in `restarts` |
| It stops or fails a second time | Do not restart again. Take the remaining piece over with an agent here if it is small, else set the lane to `blocked` and tell the user in one line with the reason |
| A lane says "done" or "merged" | It is a claim. Verify with one call before the ledger changes |

Check the lanes when a report arrives and when you are about to start something new. Do not poll on a timer, and do not sleep to wait.

## 4. After the merge: deploy and verify

A merged PR is not the end for work that users see.

- **Lane with `env`** (web or mobile UI): after its PR merges (`ci-watch` starts this by itself), run the `deploy` skill for that PR, with the evidence attached to the ticket: wait for the staging deploy, test the PR's test plan in the app, and say how far it got. The ledger state goes `merged` to `verified`. The ticket moves to done only after `verified` (`keep-the-board-current.md`).
- **Lane with no `env`** (backend, infra): run `deploy status` for the PR. A failed deploy puts the lane back to `blocked` with the reason. It does not need a browser check unless the ticket asks for one.
- **Docs, review and ticket-only lanes:** no deploy step. `merged` goes to `done`.
- The coordinator runs this step, or gives it to the lane before the lane is archived. It needs one heavy slot only when it opens the app.
- A verification that fails is a new row in the same lane (the fix), not a silent reopen.

## 5. Work with the installed mods

Some mods already do part of this work. When a mod is installed, use it and do not do the same work twice. When it is not installed, the rule in parentheses applies.

| Mod | What it does | So the coordinator and lanes |
|---|---|---|
| `ci-watch` | Watches the checks of each pushed PR and starts a turn when CI changes | Never poll CI and never sleep to wait for it. Push, then go on; act when the CI event arrives. (No mod: `finishing-ci-and-merge.md`) |
| `memory-governor` | Refuses a heavy agent or job when there is no room | Treat a refusal as "wait": queue the lane or the job and try again when a lane ends. Do not retry in a loop. Still run `mem-budget.sh` for the plan, because the plan needs the number |
| `merge-policy` | Answers the permission check for `gh pr merge` from the user's rule file | Obey its answer. A refusal is final for that PR until the cause changes; report the reason |
| `ops-board` | A pane with agents, tasks and open PRs with CI | The ledger stays the record for lanes. In `/paralel status`, use the pane's data for CI state when it is there |
| `context-keeper` | Keeps the task state through a compaction | Put the ledger file path in the state it keeps, so the next context finds the ledger |
| `ticket-closer` | Asks the session to close the ticket when a PR merges | Answer it from the ledger: close the ticket only when the lane is `verified` or `done` |
| `automodel` | Sets the model and effort for each turn, and for an agent that has no model | It runs in every lane (each lane is a new session). Lanes start on the model that the plan names and let it pick per turn. Agents always get an explicit model and effort from the sizing, so `automodel` never changes them (it sets the model and effort only of an agent that has no model). Check a lane with `/automodel status` when its cost or speed looks wrong. If a lane or the coordinator sets `/model` by hand, that choice wins and the lane keeps it |
| `ship` | Commit, push, open or find the PR and hand it to ci-watch, in one tool call (`mcp__ship__ship`) | A lane opens its PR with the tool (section 7). It refuses the default branch and secret files, and obeys the repo attribution rules. Sub-branches never get a PR, so never call it on a sub-branch. (No mod: `git push`, then `gh pr create`) |

**Work Monitor.** If `~/.claude/work-monitor-url` exists and today's day document exists (the `start-work` skill made it), write each lane as a row there on every state change, with the `start-work` row fields (`title`, `url`, `repo`, `surface`, `state`, `branch`, `pr`, `ci`, `session`, `note`). Only the coordinator writes. With no day document, write nothing: the ledger file is enough.

## 6. The check of each lane (done criteria and the gate)

A lane finishes when a check passes, not when it says it is done. This is the "sprint contract" and the "Stop hook" of the Anthropic harness work.

- **The coordinator writes the done criteria** for each lane in the plan: one line, what "done" means, and the **check command** that proves it (the project's test, typecheck or lint command, or a script; for a UI lane also the browser check from `start-web-dev`). Take the command from the repo's `CLAUDE.md` or the ticket. If you cannot find one, the lane's first task is to write a failing test or a check script, and the plan says so.
- **The lane brief carries both.** The lane's first act, before any edit: call the tool `mcp__verify-gate__set` with the check command and the one-line criteria (the `verify-gate` mod). It runs the check after each turn that edits files and sends the lane back to work on a failure, three tries at most, then the lane stops and reports `blocked`. Without the mod, the lane runs the check itself before it reports and shows the output.
- **The check is not the lane's to loosen.** A lane never edits, skips or weakens the check or its tests to make it pass. A change to the check goes to the coordinator.
- **The reviewer gets the criteria.** The reviewer agent receives the done criteria and the check output, reviews the diff against them, skips style, and asks for evidence. The author never reviews its own work.
- **Evidence in the PR.** The PR body names the check command and its result. The ledger state goes `review` only after the check passes.
- **Fix the cause, then the rule.** When a lane repeats a mistake (two corrections for the same thing), the coordinator lists it at the end of the run and proposes one line for the repo's `CLAUDE.md` or a hook. It changes nothing without the user's yes. If a rule keeps being ignored, propose a hook or a deny rule instead of louder words.

## 7. Open the PR and fix it until CI is green

Each lane ends with a green PR, not with "pushed". The steps, in order:

1. **Open the PR** when the check passes (section 6) and the reviewer has no open CONFIRMED finding. The PR body has the ticket id, what changed, and the check command with its result. Follow the repo's rules for the title, the branch name and attribution (read its `CLAUDE.md`). With the `ship` mod, load `mcp__ship__ship` with ToolSearch and call it with `title` and `body` (and `draft: true` where needed): it commits what is left, pushes, opens the PR and hands it to ci-watch. Open it as a draft where the repo skips CI on drafts, then mark it ready at once, because a draft gives no CI result (`finishing-ci-and-merge.md`). A plan that says "draft" keeps it a draft, and the lane then reports `review` and stops.
2. **Watch it without polling.** `ci-watch` starts a turn when the PR turns red, conflicts or turns green. In the desktop app, Auto-fix for the PR does the same. Never sleep or poll CI.
3. **On red, read the failed log first** (`gh run view <run> --log-failed`), then decide:
   - A code failure the PR caused: fix it where the work went (a sub-branch when the lane uses them, else a commit on the lane's own branch; never on `main`, never a force-push), run the lane check again, push.
   - An infrastructure failure (a rate-limited download, a runner outage): re-run once with `gh run rerun <run> --failed`. If it fails again, report it with the log and stop.
   - "draft: CI not run", or a run that was cancelled and replaced by a newer run on the same commit: not a failure. Do nothing.
   - A conflict or a branch behind `main`: merge `origin/main` in (a merge commit), then run the check again.
4. **Limit the tries.** At most 3 automatic fix tries for each PR, over all checks. After that the lane stops, ends `needs-you` with a decision record, and sends the coordinator the check name, the log tail and what it tried. Never apply `ci-break-glass`, never post `/ci-bypass`, never weaken a check or a test to get green.
5. **Green means every required check passed on the head commit.** Check it with one call (`gh pr view <n> --json statusCheckRollup,mergeable,headRefOid`), not from memory. Then the ledger state goes `ready` and the lane reports the PR link and the head commit.
6. **The merge is a different step.** In a loop run, the lane merges on green under `merge-policy` (the `merge-when-green` rules), with no approval, in a company repo. Where there is no such policy, the coordinator merges only as `finishing-ci-and-merge.md` and the user's standing rules say. A refusal of the policy is final: `needs-you`.

The ledger shows the PR line as "CI running", "red: <check>, fixing (round 2 of 3)", "green, waits for <who>", or "blocked: <check>".
