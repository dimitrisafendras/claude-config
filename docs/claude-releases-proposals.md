# Proposals for this setup

Changes that the items of the Claude releases digest suggest for this setup. Each one names the file, the digest item it comes from, the gain and the risk. These are proposals only: nothing changes until you say so. The weekly routine adds a dated section each Monday, with the upkeep findings.

Last update: 2026-11-25 (applied proposals moved to Improvements)

## 2026-11-25

First set, written from the digest and a search of the repo. Ranked, most useful first. Three of the five (deny instead of prompting, `--plugin-dir` in `ship-mod`, `/skill-doctor` in the weekly audit) were applied in PR #54 and moved to the Improvements tab.

### 1. Ask before an Opus subagent starts
2026-11-25 · claude/settings.json · Permissions

Add the rule `Agent(model:opus)` to the `ask` list, so a person approves each Opus subagent.

Digest item: [Permission rules on tool parameters](https://github.com/anthropics/claude-code/releases/tag/v2.1.178) (v2.1.178).

**Why here:** The model policy of `paralel` keeps Opus for hard work, and a rule can now enforce it.

**Risk:** Decision for the user. Lanes that size an agent as Opus will wait for approval, so use `ask`, not `deny`.

### 2. Test that skills trigger with claude plugin eval
2026-11-25 · claude/skills/ · Skills

Write an eval for the two skills with the most overlap in their trigger words, for example `merge-when-green` and `deploy`, and run `claude plugin eval` on them.

Digest item: [claude plugin eval](https://code.claude.com/docs/en/plugin-evals) (v2.1.269).

**Why here:** The `skill-router` mod and the descriptions decide which skill runs, and nothing tests this now.

**Risk:** It calls the model, so it costs tokens. Start with one skill and read the cost first.

### No change needed
2026-11-25 · digest items · Note

- **Code Mode (experimental):** off by default and can change. Try it on a branch when a change repeats across all mods.
- **Idle compaction, continue at usage limit reset:** they work with no setting.
- **Claude Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5:** the skills and the mod code use the model aliases (`haiku`, `sonnet`, `opus`) and no old model id. Old ids (`claude-sonnet-4-6`, `claude-opus-4-7`, `claude-haiku-4-5`) are only in test data: 33 uses in `mods/automodel/tests/automodel.test.ts` and 1 in `mods/memory-governor/tests/memory-governor.test.ts`. They are sample strings, so no fix is needed; the weekly upkeep check will keep looking.
