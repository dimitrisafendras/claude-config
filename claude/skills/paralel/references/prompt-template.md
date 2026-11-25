# Prompt template for a dispatched agent


The agent starts with **none** of this conversation. Every prompt must stand alone. For a task that changes no code (a review, an investigation), drop the branch lines and make "Done means" the verdict or report.

```
Task: <one sentence, with the ticket/PR URL>
Repo and checkout: <absolute path of the fresh, non-stale checkout>. Run `git fetch origin`, then create
  your worktree with `git worktree add .claude/worktrees/<topic>--<sub> -b feature/<topic>--<sub>
  origin/feature/<topic>` (EnterWorktree is not available to you) and work only there. Don't switch any
  checkout's branch, and don't touch other worktrees, least of all the feature worktree .claude/worktrees/<topic>.
Owns: <paths this agent may change>. Off-limits: <paths other agents own>. Reserved: <e.g. RDS migration 0225>.
Read first: the repo's CLAUDE.md, plus <spec/doc paths>.
Context already established: <facts you gathered, so it doesn't redo them>.
Done means: feature/<topic>--<sub> is pushed and its verification passes. No PR: do not open a pull request
  to main, to the feature branch or anywhere else. The dispatcher reviews and merges it.
Before reporting: `git fetch origin && git merge-tree --write-tree origin/feature/<topic> HEAD`. On a conflict,
  merge origin/feature/<topic> into your branch (no rebase), resolve, re-verify and push.
Verify: <commands: tests, lint, typecheck; measure, don't eyeball>.
Attribution: <the repo's rule, e.g. "none: follow CLAUDE.md, attribution-guard enforces it"; or,
  only where the repo allows it, the Co-Authored-By / Generated-with lines>
Author: <name> <work email>, set with `git config --local user.email` in every checkout the agent commits in.
  Reviewers reject commits from a personal address.
Review: an independent reviewer will check your work, so list every claim precisely (test names and counts, what
  you proved and how, what you could not run).
Local infra: don't start Docker, containers or local clusters. Rely on CI and mark local-only checks unverified.
Ticket: <ticket id> — statuses <exact list>. Move it to in progress when you start, or to blocked with a
  comment if you stop on a real problem. The dispatcher makes every other move. Don't comment on routine
  progress. In your report, flag any divergence from the ticket's scope or described implementation, so the
  dispatcher can record it on the ticket.
Do NOT: open a PR, merge, push to the feature branch or main, deploy, or change hosted config or data,
  unless the user authorised that exact action in chat (quote it).
If a product or security decision is open: implement the rest and list the question. Don't guess.
Report: the branch and head SHA, what was verified (with numbers), open questions, and what wasn't verified.
```


