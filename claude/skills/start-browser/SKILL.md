---
name: start-browser
description: Start a browser session that Claude can drive: check that Chrome and the claude-in-chrome bridge work on this computer, open one new tab for this session, optionally go to a URL, and confirm that the page rendered. Use for "/start-browser", "start a browser session", "open the browser", "start a chrome session", "use the browser", "drive Chrome", or before the first mcp__claude-in-chrome__* call without a verified tab.
argument-hint: "[url] (optional, opens that page)"
model: haiku
effort: low
---

# Start browser

Get from "no browser" to "Claude controls one tab". Start no dev server and change no code. For an app, use `start-web-dev` (it runs this phase first, then the server).

## Steps

1. **Chrome.** Check that Chrome is installed. If it is missing, stop and give the user `https://www.google.com/chrome/`. Do not install it. If Chrome runs, leave it: a relaunch closes the user's tabs.
2. **Load the tools.** One `ToolSearch` call with `select:` and these names: `mcp__claude-in-chrome__list_connected_browsers`, `select_browser`, `tabs_context_mcp`, `tabs_create_mcp`, `navigate`, `read_page`, `read_console_messages`, `tabs_close_mcp`.
3. **Pick the browser.** Call `list_connected_browsers`. Use the entry with `onThisComputer: true`. If it is not the one in use, call `select_browser` with its `deviceId`. If no entry or more than one entry has `onThisComputer: true`, show the list and ask the user. If the list is empty, the extension is not paired: tell the user to pair it in Claude Desktop, Settings, Chrome Extension, then stop.
4. **Probe.** Call `tabs_context_mcp` with `{}`. A failure here means the bridge does not work; say so and stop.
5. **Open this session's tab.** Always create a new tab with `tabs_create_mcp` and keep its ID. Never reuse or close a tab of the user.
6. **Go to the URL** (if the user gave one): `navigate` in that tab. Then `read_page` and `read_console_messages`. A 200 status does not prove that the page works.
7. **Report** in three lines: the browser (device name), the tab ID, and what the page shows. Give the number of the user's other open tabs, never their URLs.

## Boundaries

- Use the extension only. Do not use `--remote-debugging-port` or a debug profile.
- A browser dialog freezes the bridge until the user closes it. Warn the user before a click that can open one.
- Never sign in for the user, and never enter passwords or payment data.

## Next

- An app to run: `/start-web-dev` (it starts the dev server and opens it here).
- Many tasks in parallel: `/paralel`.
- See what runs: `/monitor`.
