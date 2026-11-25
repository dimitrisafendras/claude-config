import type { EngineInterface, Register } from 'claude-code'

// verify-gate: a session may not finish while its check command fails.
//
// This is the "Stop hook" of the Anthropic best practices, as a mod:
//   1. A check command is set for a working folder (the tool
//      mcp__verify-gate__set, /verify-gate set <cmd>, or the file
//      .claude/verify.sh after the person approves it with
//      /verify-gate set file). With no check the mod does nothing.
//   2. When a turn ends after the session edited files, the mod runs the check.
//   3. A passing check ends the matter. A failing check starts another turn
//      ($.prompt.submit) with the tail of the output.
//   4. After MAX_TRIES failures in a row the mod stops: it tells the model to
//      stop and report that it is blocked. It never loops without end.
//
// The set tool is NOT auto-allowed: the command runs later outside the
// permission check, so the person (or the auto-mode classifier) sees it once,
// when it is set, like any Bash command.
//
// The file .claude/verify.sh never runs on its own: a cloned repo, or the
// agent with the Write tool, could put any code in it. The person approves it
// with /verify-gate set file; the mod keeps the approved text and refuses to
// run the file when its text changed.

const TOOL = 'mcp__verify-gate__set'
const MAX_TRIES = 3
const TIMEOUT_MS = 10 * 60 * 1000
const TAIL_LINES = 40
const TAIL_CHARS = 4000
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const FILE_CHECK = '.claude/verify.sh'

type Gate = { command: string; criteria?: string; fileText?: string }

let enabled = true
let gates: Record<string, Gate> = {}
let dirty = false
let fails = 0
let isRunning = false
let gaveUp = false
let last = 'no check run yet'

export const tail = (text: string): string => {
  const lines = text.trim().split('\n')
  const cut = lines.slice(-TAIL_LINES).join('\n')
  return cut.length > TAIL_CHARS ? cut.slice(-TAIL_CHARS) : cut
}

export const failText = (command: string, code: number, output: string, n: number): string =>
  `verify-gate: the check \`${command}\` failed (exit ${code}, try ${n} of ${MAX_TRIES}). ` +
  `Fix the cause, not the check: do not edit, skip or loosen the check or its tests. ` +
  `Output (last lines):\n\n${tail(output)}`

export const giveUpText = (command: string): string =>
  `verify-gate: the check \`${command}\` still fails after ${MAX_TRIES} tries. Stop work now. ` +
  `Do not try again. Report that you are blocked: what you changed, the last output, and what you think is wrong.`

async function load($: EngineInterface) {
  const stored = await $.store.get('enabled')
  enabled = stored !== false
  const g = (await $.store.get('gates')) as Record<string, Gate> | undefined
  gates = g && typeof g === 'object' ? g : {}
}

function save($: EngineInterface) {
  return $.store.set('gates', gates).catch(() => {})
}

function show($: EngineInterface, text?: string) {
  try {
    $.ui.status(enabled ? text : undefined)
  } catch {
    // status is cosmetic
  }
}

async function readFile($: EngineInterface, cwd: string): Promise<string | undefined> {
  try {
    const text = await $.fs.read(`${cwd}/${FILE_CHECK}`)
    return typeof text === 'string' && text.trim().length > 0 ? text : undefined
  } catch {
    return undefined
  }
}

// Only a check the person set or approved. A file check runs only while the
// file text is the approved text.
function gateFor(cwd: string): Gate | undefined {
  return gates[cwd]
}

async function fileChanged($: EngineInterface, cwd: string, gate: Gate): Promise<boolean> {
  if (gate.fileText === undefined) return false
  return (await readFile($, cwd)) !== gate.fileText
}

const CHANGED = `${FILE_CHECK} changed after you approved it. It does not run. Read it, then approve it again with /verify-gate set file.`

async function runCheck($: EngineInterface, cwd: string, gate: Gate) {
  const r = await $.process.run(['bash', '-lc', gate.command], { cwd, timeoutMs: TIMEOUT_MS })
  return { code: r.exitCode, output: `${r.stdout}\n${r.stderr}` }
}

async function check($: EngineInterface): Promise<void> {
  if (isRunning) return
  isRunning = true
  try {
    const cwd = await $.session.cwd()
    const gate = gateFor(cwd)
    if (gate === undefined) return
    if (await fileChanged($, cwd, gate)) {
      last = `refused: ${FILE_CHECK} changed`
      show($, 'verify: file changed')
      void $.ui.notify(`verify-gate: ${CHANGED}`, { title: 'verify-gate' }).catch(() => undefined)
      return
    }
    show($, 'verify: running')
    const { code, output } = await runCheck($, cwd, gate)
    if (code === 0) {
      fails = 0
      gaveUp = false
      dirty = false
      last = `passed: ${gate.command}`
      show($, 'verify: pass')
      return
    }
    fails += 1
    last = `failed (${code}) try ${fails}: ${gate.command}`
    if (fails < MAX_TRIES + 1) {
      dirty = false
      show($, `verify: fail ${fails}/${MAX_TRIES}`)
      await $.prompt.submit({ text: failText(gate.command, code, output, fails) })
    } else if (!gaveUp) {
      gaveUp = true
      dirty = false
      show($, 'verify: blocked')
      void $.ui.notify(`verify-gate: the check still fails after ${MAX_TRIES} tries`, { title: 'verify-gate' }).catch(() => undefined)
      await $.prompt.submit({ text: giveUpText(gate.command) })
    }
  } finally {
    isRunning = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await load($)
      await $.command.register({
        name: 'verify-gate',
        description: 'The check that a session must pass before it finishes: status | set <command> | run | on | off | clear',
        argumentHint: 'status | set <command> | run | on | off | clear',
      })
      await $.tool.register({
        name: 'set',
        description:
          'Set the check command of this working folder. After a turn that edited files, verify-gate runs it; if it fails, a new turn starts with its output, up to 3 tries. Use the project check (tests, typecheck, lint) that proves the task is done. Call it once at the start of a task, before you edit.',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command; exit 0 means the work is done' },
            criteria: { type: 'string', description: 'One line: what done means for this task' },
          },
          required: ['command'],
        },
      })
      show($, 'verify: ready')
    } catch {
      // never block the session start
    }
    return next(e)
  })

  // Remember that the session changed files since the last check.
  on('tool.call', async ($, e, next) => {
    try {
      if (EDIT_TOOLS.has(String(e.tool))) dirty = true
      if (String(e.tool) === TOOL) {
        const args = e as unknown as Record<string, unknown>
        const command = typeof args.command === 'string' ? args.command.trim() : ''
        if (command === '') return { result: 'verify-gate: the command is empty. Nothing was set.' }
        const cwd = await $.session.cwd()
        if (command.includes(FILE_CHECK))
          return { result: `verify-gate: a check that runs ${FILE_CHECK} needs the person's approval. Ask them to run /verify-gate set file. Nothing was set.` }
        const criteria = typeof args.criteria === 'string' ? args.criteria.trim() : undefined
        gates = { ...gates, [cwd]: { command, ...(criteria ? { criteria } : {}) } }
        fails = 0
        gaveUp = false
        await save($)
        show($, 'verify: set')
        return {
          result: `verify-gate: the check for ${cwd} is \`${command}\`. After a turn that edits files it runs; a failure starts another turn (max ${MAX_TRIES} tries). Do not change the check to make it pass.`,
        }
      }
    } catch {
      // observe only
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    try {
      if (enabled && e.agentId === undefined && e.reason === 'answer' && dirty) void check($).catch(() => undefined)
    } catch {
      // never block the turn
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'verify-gate' }, async ($, e) => {
    try {
      const [sub = 'status', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
      const cwd = await $.session.cwd()
      switch (sub) {
        case 'on':
          enabled = true
          await $.store.set('enabled', true)
          return { text: 'verify-gate is on.' }
        case 'off':
          enabled = false
          await $.store.set('enabled', false)
          show($, undefined)
          return { text: 'verify-gate is off. A session may finish with a failing check.' }
        case 'clear': {
          const { [cwd]: _removed, ...kept } = gates
          gates = kept
          fails = 0
          gaveUp = false
          await save($)
          return { text: `The check for ${cwd} is cleared.` }
        }
        case 'set': {
          const command = rest.join(' ').trim()
          if (command === '') return { text: 'Usage: /verify-gate set <command> | set file' }
          if (command === 'file') {
            const fileText = await readFile($, cwd)
            if (fileText === undefined) return { text: `No ${FILE_CHECK} in ${cwd}.` }
            gates = { ...gates, [cwd]: { command: `bash ${FILE_CHECK}`, fileText } }
            fails = 0
            gaveUp = false
            await save($)
            return { text: `Approved ${FILE_CHECK} as the check for ${cwd}. It runs only while its text stays the same:\n\n${tail(fileText)}` }
          }
          gates = { ...gates, [cwd]: { command } }
          fails = 0
          gaveUp = false
          await save($)
          return { text: `The check for ${cwd} is: ${command}` }
        }
        case 'run': {
          const gate = gateFor(cwd)
          if (gate === undefined) return { text: 'No check is set. Use /verify-gate set <command>.' }
          if (await fileChanged($, cwd, gate)) return { text: CHANGED }
          const { code, output } = await runCheck($, cwd, gate)
          return { text: `${gate.command}: exit ${code}\n${tail(output)}` }
        }
        case 'status':
        default: {
          const gate = gateFor(cwd)
          const unapproved = gate === undefined && (await readFile($, cwd)) !== undefined
          return {
            text: [
              `verify-gate is ${enabled ? 'on' : 'off'}.`,
              `Check for ${cwd}: ${gate?.command ?? 'none'}${gate?.criteria ? ` (done = ${gate.criteria})` : ''}.`,
              `Last: ${last}. Failures in a row: ${fails} of ${MAX_TRIES}${gaveUp ? ' (blocked)' : ''}.`,
              ...(unapproved ? [`${FILE_CHECK} exists but is not approved. Read it, then run /verify-gate set file.`] : []),
            ].join('\n'),
          }
        }
      }
    } catch (err) {
      return { text: `verify-gate: the command failed (${String(err)}).` }
    }
  })
}
