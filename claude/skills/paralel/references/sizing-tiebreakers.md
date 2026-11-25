# Sizing rubric, tie-breakers and agent types

## Sizing rubric

Pick the **lowest** tier where every statement in the row is true. Write down the reason in one clause. A main task with subtasks is sized per subtask: each subtask gets its own agent, model and effort.

| Model | Effort | Use when the task is... | Typical examples |
|---|---|---|---|
| `haiku` | `low` | Mechanical, with a known procedure. It needs no judgement about design or correctness, is easy to verify, and a wrong answer is cheap and obvious. | Move or comment on a ticket. Summarise CI status or a PR's checks. Look up who merged what. Run the tests and report the results. Rename, reformat or bump a version. Fix a lint warning. Apply small doc or copy edits. Collect links or IDs. |
| `sonnet` | `medium` | Routine engineering, with the goal clear and the scope local (one area, a handful of files). It needs judgement, but the mistakes a reviewer would catch are ordinary ones. | Fix a bug whose root cause is known or can be found quickly. Build a small feature or UI change inside existing patterns. Write or repair tests. Do a standard PR review. Triage an error-tracker issue with access. Refactor inside one module. Clean up styles or tokens. Resolve a merge conflict between two reviewed branches. |
| `opus` | `high` | Hard, ambiguous or high-stakes. **Any one** of these is enough: it touches auth, permissions, security, payments or data deletion. It spans services or repos. The root cause is unknown after a first look. It involves design or architecture decisions. It runs migrations or changes infrastructure. It's a large multi-slice implementation. It's a review whose job is to find subtle correctness or security bugs. | Implement a security policy. Design an API or schema. Chase a race condition or render loop with no known cause. Plan and carry out a multi-part feature. Review an auth change adversarially. |
| `fable` | `high` | Only when the user asks for it by name. | — |

## Tie-breakers

- **Risk beats size.** A two-line change to an access check is `opus`. A 40-file mechanical rename is `haiku`.
- **Uncertainty goes up one tier.** If you can't tell whether the root cause is known, size it as if it isn't.
- **Split mixed tasks.** "Investigate this bug, then update the ticket" is one sonnet or opus agent for the fix. The ticket update is either a haiku step afterwards or something you do yourself in one call.
- **An investigation that ends in a risk claim or a written answer is sonnet, not haiku.** Haiku read legacy IaC and stated EventBridge schedules for jobs that actually run as Kubernetes CronJobs, and it claimed a missing renewal job that exists. Haiku is fine for "is X set / where is Y" lookups with one clear source of truth. Spot-check its claims against that source before relaying them.
- **Effort moves before the tier.** The effort in the table is the default of the tier. A task that sits between two tiers stays on the lower tier with one effort level more (`sonnet`/`high`, `opus`/`xhigh`): that costs less than the next model. A task of the tier that is very plain can take one level less (`sonnet`/`low`). Use `max` only when the user asks for it by name.
- **Tiny tasks aren't delegated at all.** If it takes one or two tool calls (fetch a ticket, check a PR state), do it yourself. Spawning an agent costs more than the task.

Built-in agent types: `Explore` is read-only and good for "where is X" at `haiku` or `sonnet`. `Plan` is for design work at `opus`. `general-purpose`, `frontend-web-expert` and `ui-ux-expert` are for work. The `model` parameter overrides an agent type's default, so always pass it explicitly.

**Pass `effort` on every `Agent` call**, next to `model`: `Agent({ ..., model: "sonnet", effort: "medium" })`. An agent with no `effort` takes the default of the session (`CLAUDE_CODE_SUBAGENT_EFFORT`, or the effort of the dispatcher), which is usually wrong in one of the two directions. A model that takes no effort level ignores the value, so pass it for `haiku` too. An `Agent` tool that has no `effort` parameter (an old Claude Code) means: leave it out and write the effort in the ledger only.
