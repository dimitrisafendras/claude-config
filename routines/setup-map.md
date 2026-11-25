---
name: setup-map
description: Weekly. Rebuilds the Setup Map page with the generator script claude/scripts/setup-map.sh and republishes its artifact. Stops with one line when the generator is not installed.
schedule: "50 8 * * 1"   # 08:50 every Monday, local time
skills: [artifact-design]
---

You run alone on Monday morning. Nobody watches. Keep the Setup Map page current.

Hard rules:
- Limits: at most 20 tool calls and 15 minutes. At a limit, stop, write the report with what you have, and say which limit stopped you. Never go on past a limit to finish.
- Do not write or change the generator. This routine only runs it. Change no file in the repo, commit nothing, push nothing.
- Republish only the existing Setup Map artifact. Do not delete an artifact, and do not share it with other people.
- Do not ask questions. A denied tool call is not a failure: write it in the report with the command, and go on or stop on doubt.

Steps:
1. Run `bash ~/.claude/autonomy.sh check`. If it fails, stop and say nothing.
2. Find the generator. The main checkout is the folder in `~/.claude/claude-config.repo` (`~/Projects/claude-config` when the file is missing or empty). The generator is `claude/scripts/setup-map.sh` in it, or the installed link `setup-map.sh` in `~/.claude`. If neither exists, write the one line "setup-map: no generator (claude/scripts/setup-map.sh), nothing to do" to the report, go to step 6, and do nothing else.
3. Run the generator with `bash`. It writes the page and prints the path of the HTML file. If it fails or prints no file that exists, write the output (short) to the report, go to step 6, and publish nothing.
4. Run `bash ~/.claude/autonomy.sh check` again. If it fails, publish nothing, go to step 6.
5. Republish the page with the Artifact tool. Use the artifact URL that the generator prints, if it prints one. Else find the artifact with `action: "list"` by the title "Setup Map". Read it first, then publish the new file to its URL. If there is no such artifact, publish a new one and put its URL in the report.
6. Write the report to `~/.claude/routines/reports/setup-map-<YYYY-MM-DD>.md`: the generator path, its result, the artifact URL, and what you did not do.
7. Run `bash ~/.claude/autonomy.sh stamp setup-map`.
