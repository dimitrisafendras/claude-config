# Verify on staging

Use a browser tab that the session controls (`start-web-dev`: Chrome bridge, then `tabs_context_mcp` with `createIfEmpty`, or `tabs_create_mcp`). Never reuse the user's own tabs.

1. **Checklist.** One item for each checkbox or step in the PR body's test plan. With no test plan, derive 3 to 5 items from the diff and say they are derived.
2. **Staging URL.** From the repo docs or the deploy run (environment URL). If you cannot find it, ask. Do not guess a host.
3. **Each item.** Navigate, act, read the page and the console. Take a screenshot for each failed item. Keep each pass to one line.
4. **Sign-in needed.** Stop and ask the user to sign in, then continue.
5. **Not checked.** Name each item that needs data, a role, or production.
