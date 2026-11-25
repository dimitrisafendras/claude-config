# Cleaning up worktrees

Each agent worktree holds 1–2 GB once dependencies are installed, and a parallel session has filled the disk before. So clean up as you go, not only at the end.

Sub-branch worktrees that are merged but not removed pile up (`.claude/worktrees/*--impl`, `*--drive` and so on). They never get a PR, by design, and their branch is never on `main` by itself (it reaches `main` only through the feature branch), so no PR-based cleanup ever finds them. The removal is therefore part of the merge, not a later chore.

## Right after each sub-branch merges (mandatory)

Do this in the same turn as the merge, as soon as the push of the feature branch (`git -C .claude/worktrees/<topic> push`) succeeds, before you take the next request. Run it from the main checkout, never from inside the worktree being removed:

```
git fetch origin

# (a) Prove the work is in the pushed feature branch. Check the remote sub-branch
#     and the local one: the local one can hold commits the agent never pushed.
git merge-base --is-ancestor origin/feature/<topic>--<sub> origin/feature/<topic> && echo remote-ok
git merge-base --is-ancestor feature/<topic>--<sub> origin/feature/<topic> && echo local-ok

# (b) Remove the worktree. Never --force.
git worktree remove .claude/worktrees/<topic>--<sub>

# (c) Delete the local sub-branch. -d, never -D.
git branch -d feature/<topic>--<sub>

# (d) Delete the remote sub-branch, if it was pushed.
git ls-remote --exit-code --heads origin feature/<topic>--<sub> \
  && git push origin --delete feature/<topic>--<sub>

git worktree prune
```

- **If (a) fails for either tip, stop.** The sub-branch has work that is not in the feature branch: commits after the reviewed head, or commits the agent did not push. Remove nothing. Look at what is missing (`git log origin/feature/<topic>..feature/<topic>--<sub>`), then have it reviewed and merged, or ask the user.
- **If (b) refuses**, the tree has changes. Look at them (`git -C <path> status --short`, `git -C <path> log @{u}..`). Do not use `--force`: send uncommitted or unpushed work back to the author agent, or ask the user. Never force a tree with unpushed commits.
- **`-d`, not `-D`, in (c).** `-d` refuses a branch with commits that are neither merged nor pushed, and that refusal is the safety net. After the `--no-ff` merge and the push, the sub-branch tip is in the feature branch, so `-d` succeeds. If it refuses, treat it like a failed (a).
- **A sub-branch with no remote** (the agent never pushed it) skips (d). That case normally fails (a) first.
- Then update the ledger: `--<sub>: merged, worktree removed`.

## Wind-down sweep

A skipped step above leaves an orphan. Sweep for orphans when the session winds down, before the feature PR leaves draft, and again once it merges:

```
git fetch origin
git worktree list --porcelain
```

For every entry whose branch is a sub-branch (`feature/<topic>--*`) of a feature branch in the ledger, run `git merge-base --is-ancestor <sub-branch> origin/feature/<topic>` (and the same for `origin/<sub-branch>` if it exists). If it passes, remove the entry with steps (b), (c) and (d) above, then `git worktree prune`. If it fails, keep it and list it for the user with its branch, its unpushed commits (`git -C <path> log @{u}..`, or "no upstream") and its size (`du -sh <path>`).

## At the end, once the feature PR merges

Once the feature PR shows as merged (`gh pr view <n> --json state`): run the sweep above, then stop any dev server running from the feature worktree, remove that worktree the same way, delete the local feature branch (`-D` is needed after a squash merge, which leaves its commits off `main`), delete the remote one if the merge didn't, and prune.

## Only remove what this session created

Before removing anything, read `git worktree list --porcelain` and check that the worktree's branch is one you created or one an agent you spawned created (it's in the ledger). Leave every other worktree alone: another session's, one serving someone's dev server, an `agent-*` tree you didn't spawn, an orphan sub-branch from an earlier session. List those for the user with branch and size (`du -sh <path>`) and let them decide.
