# Review before anything lands (step 6 detail)

These sub-points belong to step 6 of the core loop in `../SKILL.md` (full text: `dispatch-loop.md`).

   - **Size the reviewer by the diff's risk, not its length:**
     - **opus, `high`:** auth, permissions, security, data deletion, migrations, access checks, anything cross-service.
     - **sonnet, `medium`:** routine code, query rewrites, error-handling and reporting changes.
     - **haiku, `low`:** trivial config or docs changes with a test already asserting the change.
   - **The reviewer gets:** the diff to read (`git diff origin/feature/<topic>...origin/feature/<topic>--<sub>`, or the PR URL when the task is someone else's PR), the ticket's acceptance criteria, and the author's claims to check (test counts, "fails on main", "kill switch off"). Its job is correctness bugs, regressions against the ticket, over-broad changes, missing tests, and repo-rule violations (attribution, branch names, weakened checks). It runs the tests itself. It does not rewrite the code. It reports findings as CONFIRMED (with a reproduction or file:line) or PLAUSIBLE.
   - **Then:**
     - No CONFIRMED findings: merge the sub-branch into the feature branch (see "Merging a sub-branch in" in `branches-and-worktrees.md`) and relay.
     - CONFIRMED findings: send them to the **same** author agent with `SendMessage`, so it fixes them with its context intact (spawn a fresh one only if it's gone). Then have the delta re-reviewed by resuming the **original** reviewer with `SendMessage`, which still holds its first pass.
     - PLAUSIBLE only: relay them to the user alongside the result and let them decide.
   - **Skip the gate only** for changes you made yourself in one or two commands and can see in full, like a re-authored cherry-pick of an already-reviewed diff. Say so when you relay.

## Done criteria and evidence

Give every reviewer the lane's done criteria and the check output (`keep-it-running.md`, 6). The reviewer checks the diff against them, skips style, and asks for evidence: the command and its result, not "tests pass". It is read-only (`claude/agents/pr-reviewer.md`).
