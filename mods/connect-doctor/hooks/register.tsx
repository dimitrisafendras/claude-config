import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DoctorReport, DoctorRow, DoctorState } from '../types'

const START_DELAY_MS = 10 * 1000
const RETRY_GAP_MS = 2 * 60 * 1000

// Errors that mean the server's connection, not the call's arguments.
const CONNECTION_ERROR =
  /not connected|connection (?:closed|refused|reset|lost|error|failed)|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|fetch failed|network error|transport (?:closed|error)|server (?:disconnected|not found|is not running)|session (?:not found|expired|terminated)|MCP error -3200[01]|request timed out|no such tool available|unauthori[sz]ed|\b401\b|needs? (?:auth|authentication|sign-in)/i

const report = atom({ plugin: 'connect-doctor', key: 'report' } as const, null, { shape: 'report-1' })
const seen = atom({ plugin: 'connect-doctor', key: 'seen' } as const, [], { shape: 'seen-1' })

type $T = EngineInterface

// Module caches: rebuilt by the next check after a reload.
let toolServer = new Map<string, string>()
const triedAt = new Map<string, number>()
let isChecking = false

export function norm(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

function segmentOf(tool: string): string | undefined {
  const m = /^mcp__(.+?)__/.exec(tool)
  return m?.[1]
}

type Candidate = { name: string; isLive: boolean }

function addName(found: Map<string, Candidate>, name: string, isLive: boolean): void {
  const key = norm(name)
  const had = found.get(key)
  // Keep the spelling /mcp lists (with spaces or colons) over the tool-name one.
  const nicer = had === undefined || (had.name === key && name !== key) ? name : had.name
  found.set(key, { name: nicer, isLive: isLive || (had?.isLive ?? false) })
}

/** The user's home folder: HOME, else USERPROFILE (Windows apps have no HOME), with `\` as `/`. */
async function homeDir($: $T): Promise<string> {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
  return home.replace(/\\/g, '/')
}

async function configNames($: $T, cwd: string): Promise<string[]> {
  const names: string[] = []
  const home = await homeDir($)
  try {
    // Only the keys are read: values can hold tokens and stay untouched.
    const data = JSON.parse(String(await $.fs.read(`${home}/.claude.json`))) as {
      mcpServers?: Record<string, unknown>
      projects?: Record<string, { mcpServers?: Record<string, unknown> }>
    }
    names.push(...Object.keys(data.mcpServers ?? {}))
    names.push(...Object.keys(data.projects?.[cwd]?.mcpServers ?? {}))
  } catch {
    // No user config.
  }
  try {
    const data = JSON.parse(String(await $.fs.read(`${cwd}/.mcp.json`))) as { mcpServers?: Record<string, unknown> }
    names.push(...Object.keys(data.mcpServers ?? {}))
  } catch {
    // No project config.
  }
  return names
}

async function collect($: $T): Promise<Candidate[]> {
  const found = new Map<string, Candidate>()
  const nextMap = new Map<string, string>()
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    for (const t of usage.context.breakdown?.mcpTools ?? []) {
      addName(found, t.serverName, true)
      nextMap.set(t.name, t.serverName)
    }
  } catch {
    // The breakdown is optional.
  }
  try {
    for (const t of await $.tool.list()) {
      const seg = t.mcp ? segmentOf(t.name) : undefined
      if (seg === undefined) continue
      if (!nextMap.has(t.name)) nextMap.set(t.name, found.get(seg)?.name ?? seg)
      if (!found.has(seg)) addName(found, seg, true)
      else addName(found, found.get(seg)?.name ?? seg, true)
    }
  } catch {
    // The tool list is optional.
  }
  toolServer = nextMap
  try {
    for (const name of await read($, seen)) addName(found, name, false)
  } catch {
    // Nothing seen.
  }
  try {
    for (const name of await configNames($, await $.session.cwd())) addName(found, name, false)
  } catch {
    // No config.
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function rowOf(name: string, isLive: boolean, r: Awaited<ReturnType<$T['mcp']['connect']>>): DoctorRow {
  if (r.isConnected) {
    return isLive
      ? { server: name, state: 'connected', action: '-', todo: '-' }
      : { server: name, state: 'connected now', action: 'connected once', todo: '-' }
  }
  const map: Record<string, { state: DoctorState; action: string; todo: string }> = {
    auth: { state: 'needs sign-in', action: 'none (no sign-in tried)', todo: 'run /mcp and sign in' },
    failed: { state: 'failed', action: 'connect tried once', todo: 'run /mcp, then reconnect' },
    disabled: { state: 'turned off', action: '-', todo: '- (turn on in /mcp if you need it)' },
    unapproved: { state: 'not approved', action: '-', todo: 'approve it in /mcp' },
    policy: { state: 'blocked by policy', action: '-', todo: '-' },
    unlisted: { state: 'not in this session', action: '-', todo: '-' },
  }
  const one = map[r.reason] ?? { state: 'failed' as const, action: 'connect tried once', todo: r.message }
  return { server: name, ...one }
}

async function checkGh($: $T): Promise<{ isOk: boolean; text: string }> {
  try {
    const r = await $.process.run(['gh', 'auth', 'status'], { timeoutMs: 20000 })
    const out = `${r.stdout}\n${r.stderr}`
    const account = /Logged in to (\S+) (?:account|as) (\S+)/.exec(out)
    if (r.exitCode === 0) return { isOk: true, text: account ? `OK (${account[2]})` : 'OK' }
    if (/not logged in|gh auth login/i.test(out)) return { isOk: false, text: 'not signed in: run `gh auth login`' }
    const line = out.split('\n').map(s => s.trim()).find(s => /invalid|expired|failed|error/i.test(s))
    return { isOk: false, text: `${line ?? 'gh auth status failed'}: run \`gh auth login\`` }
  } catch (err) {
    return { isOk: false, text: `gh did not run: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export async function runCheck($: $T): Promise<DoctorReport> {
  const candidates = await collect($)
  const rows: DoctorRow[] = []
  for (const c of candidates) {
    try {
      const r = await $.mcp.connect(c.name)
      if (!r.isConnected && r.reason === 'unlisted' && c.isLive) continue
      rows.push(rowOf(c.name, c.isLive, r))
    } catch (err) {
      rows.push({
        server: c.name,
        state: 'check failed',
        action: '-',
        todo: err instanceof Error ? err.message : String(err),
      })
    }
  }
  const gh = await checkGh($)
  const done: DoctorReport = { at: await $.clock.now(), rows, gh }
  await update($, report, () => done)
  return done
}

function namesIn(r: DoctorReport, state: DoctorState): string[] {
  return r.rows.filter(row => row.state === state).map(row => row.server)
}

export function statusOf(r: DoctorReport): string {
  const auth = namesIn(r, 'needs sign-in').length
  const failed = namesIn(r, 'failed').length + namesIn(r, 'check failed').length
  const unapproved = namesIn(r, 'not approved').length
  const parts: string[] = []
  if (auth > 0) parts.push(`${auth} need sign-in`)
  if (failed > 0) parts.push(`${failed} failed`)
  if (unapproved > 0) parts.push(`${unapproved} not approved`)
  const mcp = parts.length === 0 ? 'mcp ok' : `mcp ${parts.join(', ')}`
  return r.gh.isOk ? mcp : `${mcp} · gh not signed in`
}

export function messageOf(r: DoctorReport): string | undefined {
  const auth = namesIn(r, 'needs sign-in')
  const failed = [...namesIn(r, 'failed'), ...namesIn(r, 'check failed')]
  const unapproved = namesIn(r, 'not approved')
  const now = namesIn(r, 'connected now')
  if (auth.length + failed.length + unapproved.length === 0 && r.gh.isOk) return undefined
  const parts: string[] = []
  if (auth.length > 0) parts.push(`sign in needed for ${auth.join(', ')} (run /mcp).`)
  if (failed.length > 0) parts.push(`Failed: ${failed.join(', ')} (run /mcp, reconnect).`)
  if (unapproved.length > 0) parts.push(`Not approved: ${unapproved.join(', ')} (approve in /mcp).`)
  if (now.length > 0) parts.push(`Reconnected: ${now.join(', ')}.`)
  parts.push(`gh: ${r.gh.text}`)
  return `connect-doctor: ${parts.join(' ')}`
}

export function tableOf(r: DoctorReport): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|')
  const lines = ['| Server | State | Action taken | What you must do |', '| --- | --- | --- | --- |']
  for (const row of r.rows) {
    lines.push(`| ${cell(row.server)} | ${row.state} | ${cell(row.action)} | ${cell(row.todo)} |`)
  }
  lines.push(`| gh (CLI) | ${r.gh.isOk ? 'signed in' : 'not signed in'} | gh auth status | ${cell(r.gh.isOk ? '-' : r.gh.text)} |`)
  if (r.rows.length === 0) lines.push('', 'No MCP server was found in this session or its config.')
  return lines.join('\n')
}

async function check($: $T, isAtStart: boolean): Promise<DoctorReport | undefined> {
  if (isChecking) return undefined
  isChecking = true
  try {
    const r = await runCheck($)
    $.ui.status(statusOf(r))
    const message = messageOf(r)
    if (isAtStart && message !== undefined) {
      $.ui.toast(message, { timeoutMs: 10000 })
      await $.ui.notify(message, { title: 'connect-doctor' }).catch(() => undefined)
    }
    return r
  } finally {
    isChecking = false
  }
}

async function serverOfTool($: $T, tool: string): Promise<string | undefined> {
  const known = toolServer.get(tool)
  if (known !== undefined) return known
  const seg = segmentOf(tool)
  if (seg === undefined) return undefined
  try {
    const last = await read($, report)
    const row = last?.rows.find(one => norm(one.server) === seg)
    if (row !== undefined) return row.server
  } catch {
    // Fall back to the tool-name spelling.
  }
  return seg
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        // /doctor is Claude Code's own command: $.command.register refuses it.
        name: 'mcp-doctor',
        description: 'Check MCP servers and gh auth now; show what needs you',
      })
      // Off the first prompt's path: servers need a few seconds to join.
      $.clock.after(START_DELAY_MS, () => {
        void check($, true).catch(() => undefined)
      })
    } catch {
      // /mcp-doctor is not listed; nothing else changes.
    }
    return next(e)
  })

  on('command.run', { command: 'mcp-doctor' }, async $ => {
    try {
      const r = (await check($, false)) ?? (await runCheck($))
      return { text: `connect-doctor (${statusOf(r)})\n\n${tableOf(r)}` }
    } catch (err) {
      return { text: `connect-doctor: the check failed (${err instanceof Error ? err.message : String(err)}).` }
    }
  })

  // Learn the names of the servers the engine joins, the ones with no tools too.
  on('mcp.connect', ($, e, next) => {
    try {
      const name = e.server
      void update($, seen, list => (list.includes(name) ? list : [...list, name].slice(-100))).catch(() => undefined)
    } catch {
      // The name is only a hint.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      const tool = String(e.tool)
      if (!tool.startsWith('mcp__') || ran.isError !== true) return ran
      const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : JSON.stringify(ran.result ?? ''))
      if (!CONNECTION_ERROR.test(text)) return ran
      const server = await serverOfTool($, tool)
      if (server === undefined) return ran
      const now = await $.clock.now()
      const last = triedAt.get(server)
      if (last !== undefined && now - last < RETRY_GAP_MS) return ran
      triedAt.set(server, now)
      const c = await $.mcp.connect(server)
      const hint = c.isConnected
        ? `connect-doctor reconnected ${server}; retry the call once.`
        : `connect-doctor: ${server} is not connected (${c.reason}: ${c.message}). Do not retry; ask the person to run /mcp${c.reason === 'auth' ? ' and sign in' : ''}.`
      if (!c.isConnected) $.ui.status(`mcp ${server}: ${c.reason}`)
      return { ...ran, context: [...(ran.context ?? []), hint] }
    } catch {
      return ran
    }
  }).catch(($, e, next) => next(e))
}
