# Release answer (read-only)

Fetch first: `git fetch --tags -q origin`. Never switch a branch.

1. **Tags** that contain the merge commit: `git tag --contains <sha> --sort=creatordate | head`. The first is the first release that has it.
2. **Workflow runs** for the commit and for the first tag's commit: `gh run list -R <repo> --commit <sha> --json databaseId,name,status,conclusion,url,updatedAt`. Pick the release and deploy ones by name.
3. **GitHub Releases:** `gh release list -R <repo> --limit 10`, then `gh release view <tag>` for the first containing tag.
4. **Mobile only** (when the user asks about mobile or the app; facts from `start-mobile-release`): a `mobile-v*` tag triggers the EAS production workflow. It builds both apps, sends iOS to App Store Connect and Android to the Play internal track. Check the tag, then `cd apps/mobile && eas build:list --profile production --limit 6 --json --non-interactive`. There is no command to list store submissions, and `eas workflow:logs` prompts. Store review and Play rollout stay unchecked unless the user opens the consoles.
5. **Not checkable here:** ArgoCD or cluster sync (needs the browser), store review state, production traffic. Name each one that applies.
