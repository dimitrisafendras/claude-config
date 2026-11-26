# Plan the fan-out (step 0, before any dispatch)

Run this once per request that reaches `/paralel`, before the core loop. The coordinator (this session) decides **whether a new session is needed**, and how many agents each session gets. It does this itself, cheaply, in one pass. It does not block on a question unless a rule below says so.

A session you start as a lane skips this step: it is a lane (see "Lane sessions").

## 1. Measure

Gather these facts without reading the codebase (one ticket fetch, one `gh pr view`, one grep per item):

| Fact | How |
|---|---|
| Items | The tickets, PRs or subtasks in the request. Split a big item into its independent subtasks |
| Files each item touches | One grep or the ticket's own file list. Only the area is needed |
| Order | Which item needs another item's output |
| Surface and repo | web, mobile, backend, infra; this repo or another |
| Room | `bash ~/.claude/mem-budget.sh`: free %, running sessions, `room_for_heavy_jobs` |
| This session's weight | Is its context already large (long chat, many files read)? A heavy session should not also coordinate |

## 2. Decide: one session per ticket or unique task

**Default: every ticket and every unique task gets its own new session** (a lane). A unique task is one ticket, one bug, one PR to review or one self-contained piece of work. The coordinator keeps only the coordination.

Exceptions. Put the item in another item's session, or keep it here, when:

| Case | Decision |
|---|---|
| Two items edit the same files, or one needs the other's output | Same session, in order (two sessions would conflict) |
| The item is trivial: one or two tool calls (a status move, a one-line answer) | Do it here with one agent, or yourself |
| The user said `single`, "stay here" or "no new sessions" | Stay. Agents only |
| The memory budget has no room for another session | Queue it. Start it when a session ends (`memory-budget.md`) |

Sessions that span two surfaces or repos start from their own checkout. A long item always has its own session, so its context cannot crowd the coordinator.

## 3. Size each session's agents

Inside each session (this one or a lane), the number of agents is the number of independent subtasks that can run at once, capped by the room:

`agents = min(independent subtasks, room, 3 per lane)`

**Start model of a lane.** The plan names the model each lane session starts on. A lane is a dispatcher and does little hard thinking, so the default is `sonnet`. Use `opus` only for a lane with one hard item (design, risk, a large refactor). Never `haiku` for a lane: it reads reports and reviews. Pass it as the `model` of the start tool, and show it in the plan table. If the `automodel` mod is installed it then picks the model for each turn from there; if not, the start model stays.

Use more than one agent in a lane only when the subtasks touch disjoint paths. Give each agent its own sub-branch and tell it the paths it owns. Review, merge and cleanup stay as in `SKILL.md`.

## 3b. Environment per lane

The surface of a lane is decided here and nowhere else. A lane whose work must be seen running gets `env`. The lane runs its environment skill first, so its agents and its reviewer can see the app:

| Lane work | `env` | Skill the lane runs first |
|---|---|---|
| Web UI or a web flow | yes | `start-web-dev` |
| Mobile screen or flow | yes | `start-mobile-dev` |
| Backend, infra, docs, review, ticket moves | no | none |

Rules:
- One dev server or simulator per lane, from the lane's own worktree. Agents of the lane share it and use their own browser tab (`start-web-dev`).
- A dev server or simulator is a heavy job. Count it in the room (`memory-budget.md`): a lane with `env` takes one heavy slot while its app runs. If there is no slot, queue the lane.
- Two lanes on one surface get two environments on two ports, never a shared one. Same files means the same lane, so that case does not arise.
- A project can name its own environment skill for a surface in its file in `~/.claude/start-work.d/` (the line with `environment skill`). Use that skill in place of the one in the table.
- An environment skill is a leaf. It boots the app, opens it, verifies it and reports. It does not plan, dispatch, start sessions or merge, and it does not start this skill. When it returns, the lane goes on with its rows.
- An older environment skill can still end with "invoke `/paralel`". In a lane, and in a session where this skill is on, that step is already met: do not plan again and do not start sessions.
- Reuse before you start: an environment that is up for this worktree is used as it is. Do not run the environment skill a second time for it.
- The "stay" plan (one lane in this session) follows the same rule: when its work must be seen running, this session runs the environment skill first, then the core loop.
- One iOS simulator device runs one app. Two mobile lanes need two devices; with one device, run the mobile lanes one after another and queue the second.
- The coordinator never runs an environment itself. It stays light.
- At the end, the lane stops its app (`lanes.md`, Phase 5, step 3).

## 3c. Done criteria and the check

Each lane gets one line of done criteria and one check command (`keep-it-running.md`, 6). No check means the lane starts by writing one. Show the check in the plan table.

## 4. Say the plan in one block, then act

Print one short table, then start. Do not wait for approval.

```
Plan: 2 sessions now, 1 queued (room 2, free 41%)
lane A  web   TICKET-1             new session [sonnet]  env start-web-dev · check "pnpm test web" · 2 agents (sonnet/medium, sonnet/medium)
lane B  api   TICKET-3             new session [opus]    no env · 1 agent  (opus/high)
lane C  web   TICKET-2             queued (room)  starts when A ends
here    TICKET-4 (status move)     this session  1 agent  (haiku/low)
why: one session per ticket; TICKET-2 waits for memory; TICKET-4 is trivial.
```

If the answer is "stay", say so in one line with the reason, and run the core loop.

## 5. The user can override

Arguments or words in the request win over the plan:

| User says | Do |
|---|---|
| `single`, "no new sessions", "stay here" | Stay. Agents only |
| `sessions=N` or `max-sessions=N` | Cap the sessions at N |
| "one session per ticket" | One lane per item, still capped by the room |

## 6. Ask only when it matters

Ask the user one question (with the plan as the options) only if:
- there are 5 or more tickets (more sessions than the memory budget allows at once), or
- the free memory is under the floor and the plan needs a session anyway, or
- two items might edit the same files and you cannot tell from one grep.

Otherwise decide and go.

## Lane sessions

A session started with the lane brief (`lanes.md`) does **not** run this step. It is already one lane. It uses agents only, sized by section 3, and never starts sessions of its own. Two levels (coordinator, lane) are the limit.

## Re-plan

Run the plan again when a lane reports that its work is larger than it looked, when a lane finishes and frees room, or when the user adds work. Add a session, or give a free session more work with `SendMessage`, instead of starting a second session for the same area.

## One session for the user

The user manages **one** session: the coordinator. Everything below keeps it that way.

- **Questions go up, not out.** A lane never asks the user. It sends the coordinator its question and the options with `SendMessage`, and keeps working on what is not blocked. The coordinator answers from the request and the repo rules when it can. Otherwise it asks the user one consolidated question here, with the lane named, and passes the answer down.
- **Status comes here.** The coordinator keeps the ledger table (`dispatch-loop.md`), reprints it on every state change, and answers "status?" or `/paralel status` with it plus the monitor view. Each lane reports a merge or a block to the coordinator, who verifies it with one call (`lanes.md`, Phase 4) and tells the user in one line.
- **The user opens no lane.** A lane session exists, and the app lists it, but nothing needs the user there. Start lanes with the coordinator's permission mode when the start tool allows it, so a lane does not stop on a prompt that only the user can answer. If a lane does stop on a prompt, the coordinator says which lane and what it needs, in one line.
- **Closing.** When the work is done, the coordinator gives one summary and offers one line: archive the finished lane sessions. It archives only on the user's yes.
