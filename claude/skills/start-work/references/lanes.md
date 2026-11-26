# Lanes in nested sessions

Read this when stage 4 has two or more lanes.

## Memory budget

`morning.sh` reports `memory.room_for_heavy_jobs`. Before each new session, run `bash ~/.claude/mem-budget.sh` again:
- exit 0: start the next lane;
- exit 1: wait. Start the lane when a session ends and the budget has room.

A web lane (dev server) and a mobile lane (simulator, Metro) are heavy. A backend, library or docs lane without a dev server is light: two light lanes count as one heavy lane.

## Claim before you start

For each row of the lane, run `bash ~/.claude/claims.sh claim <board>:<ticket> --owner <lane name> --note "<title>"` before `start_session`. The key is the board name of the extra source file and the ticket id. A row that returns exit 1 is not in the lane: another session owns it. Name that owner in the plan and start the lane with the other rows. If `start_session` fails, release the claims of that lane at once. The lane renews each claim with a heartbeat and releases it at the end (`paralel`, `lane-loop.md`, "The claim").

## Start each lane

Use `mcp__ccd_session__start_session` with:
- `initiation: "user_asked"` (running `/start-work` is the ask), `context: "fresh"`, `use_worktree: true`;
- `cwd` set to the lane's repo folder when it is not this session's repo;
- title `<Surface>: <repo> <date>`, and a short `name` such as `web-shop`.

The brief holds:
1. The first instruction: invoke the dispatcher skill as a lane (the project's dispatcher when a source names one, else `paralel`) and dispatch the rows below. The dispatcher decides the environment of the lane and runs it first when the work must be seen running.
2. The lane's plan rows with links, sizes, models and the "why" column, so the session does not fetch or rank again.
3. The board owner, and the rules of the extra source's file in `~/.claude/start-work.d/` about keeping its items current.
4. The cap: at most two work agents at once in that session.
5. What done means: each row merged into the lane's feature branch, verified in the app (browser or simulator) or marked not verifiable with the reason, the PR's CI green, and a closing report with a state for each row.
6. Report each row state change to the coordinator in one line (row number, state, PR, CI). Do not write to the Work Monitor.

## Coordinate

- Keep the monitor current from the session reports (see SKILL.md, "Work Monitor"). Check a claimed merge with `gh pr view` before you write it.
- Relay the user's reorders or drops to the session that owns the row, with `SendMessage` to its `local_…` id.
- Answer a session's question, or bring it to the user.
- A shared contract (`libs/`, an API used by two lanes): change it first in its own PR from the coordinator, then tell the lanes when it merges. No lane edits it.
- If `start_session` is refused, say so and run the lanes one at a time in this session, most urgent first.
