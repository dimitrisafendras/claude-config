# Work Monitor: data and write rules

Read this before the first write to the monitor.

The monitor is one artifact for every day. Only the coordinating session writes to it, with the `ArtifactData` tool (load it with ToolSearch once). The page only reads.

| Collection | Doc id | Fields |
|---|---|---|
| `days` | `<YYYY-MM-DD>`, or `<YYYY-MM-DD>_<folder>` for a project run | `date` (the same text as the doc id), `phase` (housekeeping, inbox, plan, running, done), `headline` (one sentence), `needsYou` (array of strings), `housekeeping` (object), `report` (text, end of day), `updatedAt` (ISO time) |
| `days/<id>/rows` | `r01`, `r02`, … | `n`, `title`, `url`, `source` (`pr` or the name of an extra source), `repo`, `surface`, `sev`, `size`, `model`, `state`, `branch`, `pr` (URL), `prNumber`, `ci` (green, red, pending, none), `session`, `note`, `updatedAt` |
| `days/<id>/sessions` | session or agent name | `name`, `kind` (coordinator, session, agent), `title`, `surface`, `model`, `state` (running, idle, done, failed), `branch`, `updatedAt` |

Row `state` is one of: queued, running, review, merged, verified, blocked, needs-you, failed.

Rules:
- Write the plan in one `batch` (up to 50 entries per call). Keep the `version` that each write returns, and pass it as `if_version` on the next write to that document. If a pinned write fails, read the document and write again.
- Write when a state really changes: a row starts, goes to review, merges, is verified, blocks or fails; a session starts or ends; a PR's CI changes. Never write on a timer or for unchanged data.
- An extra source file can name a board to keep current. Then update its item at the same state changes, as that file says.
- With nested sessions, the sessions report to the coordinator, and the coordinator writes. Check a session's claim (PR, diff) before you mark a row merged or verified.
- When the day ends: `phase: "done"` and a `report` (what merged, the verdicts, what is left for tomorrow).

