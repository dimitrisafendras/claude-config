---
name: deploy
description: From a merged PR to a verified release: wait for the staging deploy, test the PR's test plan in the browser, then say how far it got to users. Use for "/deploy", "verify on staging", "check the deploy", "did the deploy work", "is it released", "is PR 123 live", "did it ship". "status" gives only the release answer.
argument-hint: "<PR number | commit sha | version tag> [repo] [status|mobile|production]"
model: sonnet
effort: medium
---

# Deploy

Follow a change after the merge: deploy, verify, release.

## Rules

- **Staging only.** Production only when the user names it in this turn. A release tag is never a loop step: it is a decision record.
- **Can start by itself.** `ci-watch` starts this skill after a merge in a lane loop. It then needs no approval for the staging wait and the staging verify. Check `bash ~/.claude/scripts/autonomy.sh check` first.
- **Never bypass CI or a failed deploy.** A failed deploy run stops the skill: report the run and the failing job. Do not re-run. Do not verify against the old build.
- **Read-only in the app.** No data changes, unless a test-plan item needs test data. Then use marked test data and say what was created.
- **Sign-in is the user's job.** At a login page stop and ask. Never enter passwords or codes. In a loop run, end `needs-you` with a decision record instead of a question.
- **No sleep loop.** One background `gh run watch <id> --exit-status`.
- Do not merge here. If the PR is open, say so and stop (`/paralel` finishes it; the merge rule of the repo applies).

## Steps

1. **Resolve.** `gh pr view <n> -R <repo> --json state,mergedAt,mergeCommit,body,url`. Not merged: stop, say "not merged".
2. **Deploy run.** `gh run list -R <repo> --commit <sha> --json databaseId,name,status,conclusion,url`. Pick the staging deploy by name. None yet: check once more after a short wait, then report "no deploy run found".
3. **Wait** with one background `gh run watch <id> --exit-status -R <repo>`. On a failure stop.
4. **Verify** (skip with `status`): build the checklist from the PR test plan, find the staging URL from the repo docs or the run, test each item in a tab the session controls. Details: `references/verify.md`.
5. **Release answer.** Tags that contain the commit, release runs, GitHub Releases, and for mobile the EAS builds. Details: `references/release.md`.

## Evidence and the loop

Attach the evidence to the ticket: the table below, the run link and a screenshot for each failed item. Set the `next` field of the ticket row ("staging verify running", "verified, ticket closes"). `verified` closes the ticket and lets `cleanup` run for the lane. A failed deploy or a failed item ends the lane `needs-you` with a decision record (options: fix forward, revert; irreversible: false).

## Report

Table: stage (merged, deploy, verify, tagged, released), state, link. Screenshots for each failed item. One sentence verdict. One line of what was not checked.

## Next

- Verify failed → `/paralel` with the failed items.
- All green and released → `/cleanup`.
- Want to watch other work → `/monitor`.
