---
name: cleanup
description: Remove dead git worktrees and archive finished Claude Code sessions without losing work. It removes only clean, pushed worktrees whose PR merged or closed, deletes merged local branches, archives (never deletes) idle sessions, and reports what it kept and why. Use for "/cleanup", "clean up worktrees", "clean up old sessions", "free disk", or a long worktree list.
model: haiku
effort: low
---

# Cleanup

Remove dead worktrees and archive finished sessions. Never lose work, and say what was kept and why.

## Rules

- **Never delete a session.** Archive it. Archiving can be undone; deleting can't.
- **Never remove a worktree that has any of these:**
  - uncommitted or untracked files;
  - commits that aren't on a remote (squash-merged branches count as pushed when the local HEAD is the merged PR's head);
  - an open PR;
  - a running process inside it;
  - a per-worktree environment record (`.worktree-env/`): the repo's own reset tears it down first, and a profile skill for that repo (for example `<project>-cleanup`) owns that step;
  - an entry in `keep.txt`.
- **Never use `--force`** for `git worktree remove`, and never delete remote branches.
- **Never archive a session** that:
  - is running;
  - has an open PR;
  - has no PR and was active in the last 14 days (it may be waiting on a decision);
  - is the current session or pinned;
  - was active in the last hour.
- **Archiving a parent also archives its finished side sessions.** Before archiving, check for side sessions that are still in use. List any that went with it in the report.
- **Leave other people's background work alone:** a worktree a running agent of this session is using shows up as "a process is running inside it". Leave it.

## Steps

1. **Dry run in every repository with worktrees.** From inside the repository, run `~/.claude/skills/cleanup/cleanup.sh`.
   - It lists each worktree as REMOVE or KEEP, with the reason.
   - Worktrees on `claude/*` branches belong to app sessions. It skips them (step 3 handles those).
   - Read the list. If a REMOVE looks wrong, add its path to `keep.txt` or pass `--keep <substring>`.
2. **Apply:** run `~/.claude/skills/cleanup/cleanup.sh --apply`.
   - It runs `git worktree remove` (never `--force`).
   - It deletes the local branch only when it is merged.
   - It prunes stale worktree records.
3. **Sessions:**
   - Call `mcp__ccd_session_mgmt__list_sessions` with `limit: 100`.
   - Archive with `mcp__ccd_session_mgmt__archive_session`, giving a short reason (e.g. "PR #123 merged"), each session that is not running and either:
     - has `prState` MERGED or CLOSED and no activity in the last hour; or
     - has no PR and no activity in the last 14 days.
   - Archiving also removes the session's worktree.
   - Keep everything else, and say why.
4. **App-made worktrees of long-inactive sessions:** call `mcp__ccd_host__clean_up_worktrees` with `older_than_days: 30`.
   - Never pass `include_uncommitted` or `delete_sessions` unless the user asked for exactly that.
5. **Report:** `mcp__ccd_host__get_storage_usage` with `refresh: true`. Then give:
   - counts of worktrees removed, branches deleted and sessions archived;
   - each KEEP with its reason (uncommitted changes and unpushed commits are the ones the user may want to rescue or discard by hand);
   - the disk freed.

## Files

- `cleanup.sh`: classifies the worktrees and, with `--apply`, removes them.
  - `--keep <substring>` keeps one more worktree.
  - `--include-app` also considers `claude/*` worktrees. Use it only after archiving their sessions.
- `keep.txt`: path substrings that are always kept, one per line, `#` for comments. For example, `nx-ci-dashboard-metrics` is used by the CI dashboard refresh.
