# Memory budget (check before every spawn)

Parallelism is capped by RAM, not by the number of tickets. On 2026-10-29 the desktop app ran out of memory with ~8 sessions whose subagents ran full test suites and `npm ci` at once. Rough costs on this setup:

| Thing | Approx. memory |
|---|---|
| One session (its process + ~15 MCP servers), idle | 1–1.5 GB |
| One heavy job: full vitest/jest suite, `npm ci`, a dev server, Metro, `nx run-many` | 3–4 GB peak |
| A running subagent doing reads/edits only | small |

## The script

Run `bash ~/.claude/mem-budget.sh` from any folder. `install.sh` links it from `claude/scripts/`, so it works in every repo. A repo may also hold its own copy in `.claude/skills/paralel/`; it works the same. It prints free %, total memory, heavy processes (vitest, jest, `npm ci`, `npm install`, vite, `tsc -b`, `nx run-many`, `expo start`, metro), and `room_for_heavy_jobs`. Exit 0 means there is room for another heavy job, exit 1 means wait. Tune with `MEM_FLOOR_PCT` (default 30, the % of memory to keep free) and `MEM_JOB_MB` (default 3500, the rough peak of one heavy job). It works on macOS (`memory_pressure`) and Linux (`/proc/meminfo`).

## Rules

1. **Measure first.** Run the script before every spawn. Exit 1 means wait.
2. **Sessions:** start no more lanes than `room_for_heavy_jobs + 1`, and never more than 4 active sessions on a 24 GB machine, counting sessions already running. Archive a session as soon as its PRs merge: idle sessions still hold their MCP servers.
3. **Agents:** the plan sets the count per session: `min(independent subtasks, room, 3 per lane)` (`plan-the-fan-out.md`). Reads and edits cost little; every heavy job still waits on the script.
4. **Heavy jobs:** every lane runs the script before a full suite, `npm ci`, a dev server or a simulator, and waits (re-check every few minutes) on exit 1. Locally run targeted tests for touched files; CI runs the full suite. Never two `npm ci` at once in one lane; stop dev servers and Metro when done.
5. **Coordinator watch:** re-run the script whenever a lane reports and before starting anything new. If free memory drops under the floor, tell the busiest lane to pause its next heavy step, and do not start new lanes until it recovers.
6. **After a crash:** sessions' background agents die with the app. Message each lane to resume under these limits and to check its pushed sub-branches for saved WIP before re-dispatching.
