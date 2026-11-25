import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CheatButton } from '../types'

// The link of your skills cheat sheet page is one line in ~/.claude/cheat-sheet-url. No file: no link is shown.
const SHEET_FILE = '.claude/cheat-sheet-url'

async function sheetUrl($: EngineInterface): Promise<string> {
  try {
    const home = (await $.env.get('HOME')) ?? ''
    return String(await $.fs.read(`${home}/${SHEET_FILE}`)).trim()
  } catch {
    return ''
  }
}

const buttons = atom({ plugin: 'cheatsheet', key: 'buttons' } as const, [] as CheatButton[])
const isHidden = atom({ plugin: 'cheatsheet', key: 'isHidden' } as const, false)

/** Buttons when ~/.claude/cheat-buttons.json is missing. A button fills the prompt: the person presses Enter. */
export const DEFAULT_BUTTONS: CheatButton[] = [
  { label: 'day', command: '/start-work', isSend: false },
  { label: 'PRs', command: '/pr-sweep', isSend: false },
  { label: 'monitor', command: '/monitor', isSend: true },
  { label: 'deploy', command: '/deploy', isSend: false },
  { label: 'audit', command: '/setup-audit', isSend: false },
  { label: 'clean', command: '/cleanup', isSend: false },
]

/** Reads { "buttons": [{ "label", "command", "send"?, "hint"? }] }. A bad entry is dropped; at most 8 buttons. A hint (at most 120 characters) shows on hover. */
export function parseButtons(text: string): CheatButton[] | undefined {
  try {
    const raw = (JSON.parse(text) as { buttons?: unknown }).buttons
    if (!Array.isArray(raw)) return undefined
    const out: CheatButton[] = []
    for (const b of raw) {
      const x = b as { label?: unknown; command?: unknown; send?: unknown; hint?: unknown }
      if (typeof x.label !== 'string' || typeof x.command !== 'string') continue
      const label = x.label.trim().slice(0, 16)
      const command = x.command.trim()
      if (label === '' || !/^\/[A-Za-z0-9:_-]+( [^\n]{0,80})?$/.test(command)) continue
      const hint = typeof x.hint === 'string' ? x.hint.trim().slice(0, 120) : ''
      out.push(hint === '' ? { label, command, isSend: x.send === true } : { label, command, isSend: x.send === true, hint })
      if (out.length === 8) break
    }
    return out
  } catch {
    return undefined
  }
}

async function loadButtons($: $): Promise<CheatButton[]> {
  try {
    const home = (await $.env.get('HOME')) ?? ''
    if (home === '') return DEFAULT_BUTTONS
    const t = await $.fs.read(`${home}/.claude/cheat-buttons.json`)
    return typeof t === 'string' ? (parseButtons(t) ?? DEFAULT_BUTTONS) : DEFAULT_BUTTONS
  } catch {
    return DEFAULT_BUTTONS
  }
}

async function press($: $, b: CheatButton): Promise<void> {
  try {
    if (b.isSend) {
      // The engine refuses a prompt that starts with "/": a slash command runs through $.command.run.
      const [name, ...rest] = b.command.slice(1).split(' ')
      await $.command.run({ command: name as string, args: rest.join(' ') })
    }
    else await $.prompt.fill({ text: `${b.command} `, mode: 'replace' })
  } catch (err) {
    $.ui.toast(`cheatsheet: could not run ${b.command} (${err instanceof Error ? err.message.slice(0, 120) : 'error'})`)
  }
}

type Entry = { name: string; summary: string; hint: string; phrases: string[] }
type $ = EngineInterface

/** Reads the frontmatter of one SKILL.md. Handles quoted values and `>` or `|` blocks. */
export function entryOf(dirName: string, text: string): Entry | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (m === null) return undefined
  const fm: Record<string, string> = {}
  let key: string | undefined
  for (const line of (m[1] as string).split(/\r?\n/)) {
    const kv = /^([A-Za-z-]+):\s*(.*)$/.exec(line)
    if (kv !== null) {
      key = kv[1] as string
      fm[key] = (kv[2] as string).replace(/^[>|]-?$/, '').trim().replace(/^["']|["']$/g, '')
    } else if (key !== undefined && /^\s+\S/.test(line)) {
      fm[key] = `${fm[key] ?? ''} ${line.trim()}`.trim()
    }
  }
  const desc = fm.description ?? ''
  const first = /^(.+?[.!?])(\s|$)/.exec(desc)
  const phrases = [...desc.matchAll(/"([^"]{3,60})"/g)].map(x => x[1] as string).filter(p => !p.startsWith('/')).slice(0, 4)
  return { name: (fm.name ?? '').trim() || dirName, summary: (first?.[1] ?? desc).slice(0, 160), hint: fm['argument-hint'] ?? '', phrases }
}

async function load($: $): Promise<Entry[]> {
  const home = (await $.env.get('HOME')) ?? ''
  if (home === '') return []
  const dir = `${home}/.claude/skills`
  let list
  try {
    list = await $.fs.list(dir)
  } catch {
    return []
  }
  const found = await Promise.all(
    list
      .filter(x => x.kind === 'dir' || x.isLink === true)
      .map(async x => {
        try {
          const t = await $.fs.read(`${dir}/${x.name}/SKILL.md`)
          return typeof t === 'string' ? entryOf(x.name, t) : undefined
        } catch {
          return undefined
        }
      }),
  )
  return found.filter((x): x is Entry => x !== undefined).sort((a, b) => a.name.localeCompare(b.name))
}

export function render(entries: Entry[], term: string, url = ''): string {
  const t = term.trim().toLowerCase()
  const hit = entries.filter(e => t === '' || `${e.name} ${e.summary} ${e.phrases.join(' ')}`.toLowerCase().includes(t))
  const lines = hit.map(e => `/${e.name}${e.hint === '' ? '' : ' ' + e.hint.slice(0, 40)}\n    ${e.summary}`)
  const head = t === '' ? `${entries.length} skills` : `${hit.length} of ${entries.length} skills match "${term.trim()}"`
  return `${head}\n\n${lines.join('\n')}${url === '' ? '' : `\n\nCheat sheet: ${url}`}`
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'cheat', description: 'List your skills: /cheat <word>. /cheat show|hide|reload controls the button row.' })
      const loaded = await loadButtons($)
      await update($, buttons, () => loaded)
      const hidden = await $.store.get('hidden')
      await update($, isHidden, () => hidden === true)
    } catch {
      // The command is a convenience. A failure must not stop the session.
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      const list = await read($, buttons)
      if (e.props.hasSurvey || list.length === 0 || (await read($, isHidden))) return next(e)
      const { Box, Button, Text } = $.ui.resolve(e)
      return (
        <Box>
          <Text dimColor>skills </Text>
          {list.map((b, i) => (
            // The keyed Box is the hover scope: its hint is drawn hidden and shows while the pointer is over the button.
            <Box key={`cheat-${i}`} marginRight={1}>
              <Button key={b.command} label={b.label} onPress={() => press($, b)} />
              {b.hint !== undefined ? (
                <Box position="absolute" top={1} left={0} display="none" hover={{ display: 'flex' }}>
                  <Text dimColor>{b.hint}</Text>
                </Box>
              ) : null}
            </Box>
          ))}
          <Button
            key="hide"
            label="hide"
            onPress={async () => {
              await $.store.set('hidden', true)
              await update($, isHidden, () => true)
              $.ui.toast('cheatsheet: buttons hidden. /cheat show brings them back.')
            }}
          />
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  on('command.run', { command: 'cheat' }, async ($, e) => {
    try {
      const arg = (e.args ?? '').trim()
      if (arg === 'show' || arg === 'hide') {
        await $.store.set('hidden', arg === 'hide')
        await update($, isHidden, () => arg === 'hide')
        return { text: arg === 'show' ? 'Buttons shown.' : 'Buttons hidden. /cheat show brings them back.' }
      }
      if (arg === 'reload') {
        const loaded = await loadButtons($)
        await update($, buttons, () => loaded)
        return { text: `${loaded.length} buttons loaded from ~/.claude/cheat-buttons.json (or the defaults).` }
      }
      return { text: render(await load($), arg, await sheetUrl($)) }
    } catch {
      return { text: 'Could not read the skills.' }
    }
  })
}
