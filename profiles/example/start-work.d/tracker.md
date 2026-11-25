# Tracker: <your ticket board>

Extra source for /start-work. Installed by the profile as `~/.claude/start-work.d/tracker.md`. Replace each `<...>` with your own values, and delete what you do not use.

## Connection check

One cheap call that proves the tracker answers, for example the tool that returns the current user. A failed check removes only this source from the inbox; say so in one line.

## Collect

- The open tickets assigned to you, due today or overdue, newest first. Name the tool and the filter.
- For each ticket, one row: `title`, `url`, `repo` (from the ticket's project or labels), `surface` (web, mobile, backend, infra, docs), `sev` (1 to 4), `size` (XS to L).

## Classify

- `needs-you`: the ticket waits for an answer of yours.
- `blocked`: a dependency is open.
- `queued`: ready to start.

## Keep the board current

When a lane starts, opens a PR, merges or blocks, move the ticket to the matching status and add one short comment with the PR link. Only the coordinator writes.
