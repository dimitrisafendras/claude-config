---
name: weekly-claude-releases
description: Weekly. Adds the big Claude features and workflow changes of the last 7 days to docs/claude-releases.md, logs the improvements that were merged to this setup, republishes its artifact (Releases, Improvements and Proposals tabs), writes update proposals and upkeep findings for this setup, and opens or updates one PR on the branch docs/claude-releases. Never merges.
schedule: "30 8 * * 1"   # 08:30 every Monday, local time
skills: [artifact-design, setup-audit]
---

You run alone on Monday morning. Nobody watches. Keep the Claude releases digest current.

The digest is `docs/claude-releases.md` in this repo. Its artifact URL is in `docs/claude-releases-url`. The page that shows it is `docs/claude-releases.html`; it has three tabs and renders three Markdown files, so you change only the Markdown: `docs/claude-releases.md` (Releases), `docs/claude-releases-improvements.md` (Improvements) and `docs/claude-releases-proposals.md` (Proposals). All three use the same entry format: a `### <name>` heading, the line `<YYYY-MM-DD> · <version, PR or file> · <area>`, paragraphs, a `**Why here:**` paragraph and a `[Source](<url>)` line.

Hard rules:
- Limits: at most 90 tool calls and 40 minutes. At a limit, stop, write the report with what you have, and say which limit stopped you.
- One PR at most, on the branch `docs/claude-releases`. If a PR from that branch is open, push to it. Never open a second one.
- Never merge, never delete a branch, never force-push, never write in the main checkout. Work in a new worktree from `origin/main`.
- Do not invent items. Each item must come from a source that you read in this run, and its link must go to that source.
- The core rules apply: no company, person or project names of the user in the files you write (`bash tests/core-clean.sh` must pass).
- Do not ask questions. If a source does not load, use the others and name the failed source in the report.
- A denied tool call is not a failure: write it in the report with the command, and go on or stop on doubt.

Sources (read all of them for the last 7 days; the start date is the newest "Covered to" date at the top of the digest, plus one day):
1. The Claude Code changelog: `gh api repos/anthropics/claude-code/contents/CHANGELOG.md -H 'Accept: application/vnd.github.raw'`. Get the release dates from `gh api 'repos/anthropics/claude-code/releases?per_page=30' -q '.[] | "\(.tag_name) \(.published_at)"'`. A version with no release takes the date of the next older release.
2. The Claude Code docs index, `https://code.claude.com/docs/llms.txt`: look for new pages (new commands, built-in skills, mods, hooks, desktop app features).
3. The Anthropic newsroom, `https://www.anthropic.com/news`: model and product releases only.
4. The Claude Platform release notes, `https://docs.claude.com/en/release-notes/overview`: API, Agent SDK, MCP and Managed Agents items.

Steps:
0. Run `bash ~/.claude/autonomy.sh check`. If it fails, stop and say nothing.
1. Make the worktree: `git fetch -q origin`, then `git worktree add -B docs/claude-releases <tmp-dir> origin/main`. If the remote branch `docs/claude-releases` exists, start from it instead.
2. Read the sources. Keep only two kinds of items, and be strict: most weeks have zero to three.
   - Big features: a new model that becomes a default, a new kind of extension (such as mods), a new built-in command, skill or mod, a new way to run agents or sessions.
   - Workflow changes: items that change how the skills, mods, routines, worktrees or the PR flow of this setup work, or that a skill or setting here should start to use.
   Drop everything else: bug fixes, small UI changes, small settings and environment variables, keybindings, telemetry, older models, API-only items, gateway, self-hosted runner, Claude Tag admin and other admin-only items. When in doubt, leave it out.
3. For each item write one entry in the format of the digest, because the page parses it: a `### <name>` heading; the line `<YYYY-MM-DD> · v<version> · <area>` (area is one of Claude Code, Mods, Plugins, Hooks, Permissions, Models, MCP, Desktop, Cloud, News, Docs); one or two short paragraphs on what it does; a paragraph that starts with `**Why here:**` on why it helps this setup (skills, mods, routines, worktrees, PR flow); and the line `[Source](<url>)`. Leave a blank line between the parts. For a changelog item, link the release page `https://github.com/anthropics/claude-code/releases/tag/v<version>`.
4. Add the entries at the top of the newest month section, newest first. Start a new `## <Month YYYY>` section when the month changes. Do not change older entries, except to fix a wrong link.
5. Update the "Covered to" date and the "Last update" line at the top of the digest.
6. If there are no new items, change only the "Covered to" date, and say "no new items" in the report. Then go to step 8.
7. Write update proposals for this setup from the new items of this run. Skip this step when there are no new items.
   - For each new item, look in the repo for the part it touches (`claude/skills/`, `mods/`, `routines/`, `claude/settings.json`, `.github/workflows/ci.yml`, `install.sh`). Propose a change only when you found the place it applies to, and name the file.
   - Each proposal has: the change in one sentence, the file or mod, the digest item it comes from, the gain, and the risk or what to test first. Say "decision for the user" when two parts of the setup then do the same job.
   - Also say which new items need no change, in one line each. Do not propose a change only because a feature is new.
   - Rank the proposals, most useful first, five at most.
   - Put the proposals in `docs/claude-releases-proposals.md`: add a `## <YYYY-MM-DD>` section at the top and keep the older sections. Each proposal is an entry in the page format (`### <n>. <change>`, `<date> · <file or mod> · <area>`, the digest item, `**Why here:**` for the gain, and `**Risk:**`). The Proposals tab of the page shows this file.
   - Proposals only. Change no skill, mod, routine or settings file, and start no session.
7b. Log the improvements. List the pull requests of this repo that were merged since the newest entry of `docs/claude-releases-improvements.md`: `gh pr list --state merged --search "merged:>=<date>" --json number,title,mergedAt,body`. Add one entry at the top of the newest month section for each one that changes a skill, mod, routine or setting (skip a pull request that only changes this digest). The entry has the name, `<merge date> · PR #<n> · <area>` (area: Mods, Skills, Routines, Settings, Docs), one or two lines on what changed, the digest item it came from if the pull request body or title names one (link it), a `**Why here:**` line, and `[Source](<pull request url>)`. Update its "Last update" line. Do not invent: use only what the pull request says. When a merged pull request applies a proposal of `docs/claude-releases-proposals.md`, remove that proposal there (renumber the rest of its section) and name it in the improvement entry, so the Proposals tab shows only open proposals.
8. Do the upkeep check, in each run, also when there are no new items. It finds old parts of this setup. Add the findings under an `### Upkeep` heading in the same dated section of `docs/claude-releases-proposals.md` (make the section if step 7 did not).
   - Changelog: read the "Removed", "Deprecated", "Renamed" and "Changed" lines of the versions in this run. Search the repo for each name they retire (a command, a setting, a hook event, a mods API field, an environment variable, a model id). Report each use with its file and line and the replacement.
   - Models: list the model ids and model names in `claude/`, `mods/`, `routines/` and `profiles/`. Report each one that is not a present default or that the release notes call deprecated.
   - Skills: run `/skill-doctor` if this run can start it. If it cannot, say so, and do this instead: list the skills in `claude/skills/` and `profiles/*/skills/`, and report skills that no README, routine, other skill or cheat sheet names, and two skills whose descriptions give the same job.
   - Built-in overlap: report each skill or mod of this repo that does the same job as a built-in command, skill or mod that the digest lists. Mark it "decision for the user".
   - Mods: run `claude plugin validate` on each folder in `mods/` and report the warnings. Report a mod whose `engines["claude-code"]` range does not include the newest release.
   - Plugins: report plugins that `claude/settings.json` holds as `false` for more than one run (the earlier sections of the proposals file show this).
   - Audit: run `bash ~/.claude/skills/setup-audit/audit.sh` and copy its WARN and ERROR lines of the kinds `stale` and `stale-path`. Do not repeat its other findings.
   - Give each finding one line: the file, what is old, and the fix. Mark a fix "mechanical" when it is a rename with no change of behavior. Write "Upkeep: nothing old found" when the list is empty.
   - Findings only. Delete nothing, disable nothing and change no skill, mod, routine or settings file.
9. Run `bash tests/core-clean.sh`. On a failure, remove the hit and run it again.
10. Commit with the message `docs: Claude releases to <YYYY-MM-DD>`, push the branch, and open the PR (or push to the open one). The PR body lists the new item names, the proposals and the upkeep findings.
11. Republish the artifact: use the Artifact tool with `file_path` `docs/claude-releases.html`, `url` from `docs/claude-releases-url`, and `files` `{"claude-releases.md": "docs/claude-releases.md", "claude-releases-improvements.md": "docs/claude-releases-improvements.md", "claude-releases-proposals.md": "docs/claude-releases-proposals.md"}`. Read the artifact first if the tool asks for it. If the publish fails, say so in the report and go on.
12. Remove the worktree.
13. Write the report to `~/.claude/routines/reports/weekly-claude-releases-<YYYY-MM-DD>.md`: the PR link, the number of new items with their names, the proposals, the upkeep findings, the artifact URL, and the sources that failed.
14. On any doubt, stop and end after writing what you have.
15. Run `bash ~/.claude/autonomy.sh stamp weekly-claude-releases`.
