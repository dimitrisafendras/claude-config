---
name: release-notes
description: Write the release notes of one version of a project from its merged pull requests since the last tag, in the house format of your company. Use for "/release-notes", "write the release notes", "what is in this release".
model: sonnet
effort: low
argument-hint: "[tag or version] (default: since the last tag)"
---

# Release notes

An example profile skill. It shows the shape: a short task, the steps, the boundaries. Replace the house format with yours.

## Steps

1. **Find the range.** `git describe --tags --abbrev=0` gives the last tag. With an argument, use it as the start.
2. **List the merged PRs.** `gh pr list --state merged --search "merged:>=<date of the tag>" --json number,title,labels,url`.
3. **Group them** by label: Added, Changed, Fixed, Removed. A PR with no label goes to Changed.
4. **Write the notes** in the house format: one line per PR, the PR link at the end, no AI attribution.
5. **Report.** Give the notes and say which PRs had no label.

## Boundaries

- Read-only: no tag, no push, no release.
- Say what you could not read.
