import type { EngineInterface, Register } from 'claude-code'

// automodel: picks the model and effort for each main-loop turn, and for each
// subagent and workflow agent, from the class of the prompt.
//
// TOKEN COST (the second rule this mod lives by):
//   1. RULES FIRST. A set of plain rules (ruleClass) places most prompts at no
//      token cost. A slash command is left alone: the skill sets its own model.
//   2. HAIKU ONLY WHEN UNSURE, and only in a short conversation. A long
//      conversation (messageCount >= SHORT_CONVERSATION) never calls the model:
//      the cache guard would keep the model anyway, so the call buys nothing.
//      The turn keeps the previous class (and so changes effort only).
//   3. An acknowledgement ("yes") keeps the previous class, as before.
//   /automodel status shows how many turns each path took.
//
// CACHE GUARD (the rule this mod lives by):
//   The prompt cache is kept per model. A model switch in a long conversation
//   writes the whole context to the cache again, which costs money and time.
//   Effort is cheap to change. So, for each main-loop turn:
//   1. The decision is made ONCE, at the turn's first step (index 0), and the
//      same model/effort is sent on every step of that turn. At most one switch
//      per turn.
//   2. The model changes only when the target model differs from the model of
//      the previous step AND either
//        a. the request is still short (messageCount < SHORT_CONVERSATION), or
//        b. the switch goes to a cheaper model and this is a mechanical
//           stretch (this turn and the turn before were both `mechanical`).
//   3. Otherwise the mod keeps the previous step's model (no cache re-write)
//      and changes only the effort. The status line shows "(cache)" then.
//
// THE PERSON'S CHOICE WINS:
//   - A model the person set (/model, the picker, the SDK) stays: the mod
//     leaves that turn alone, and on later turns changes the effort only.
//     /automodel on releases it.
//   - A hard class (debug, architecture) never goes below the session's
//     model: on a session model above the class's model, the session's stays.
//
// A SKILL'S CHOICE WINS:
//   A typed slash command is left alone from the start. A skill that starts in
//   the middle of a turn can bring its own model or effort: the engine then
//   sends another model or effort than at the turn's first step. From that
//   step the mod leaves the turn alone.
//
// SUBAGENTS:
//   Only the engine's own agent types (provider tier `core`) get a model, and
//   only from a haiku call. The plain rules are made for a person's short
//   prompt; a subagent brief is long and names errors and designs in passing.
//   An agent from a plugin or from the person's own files keeps the model of
//   its definition. A workflow agent (a workflow script's `agent()`, e.workflow)
//   goes by the same rules: `agent.spawn` applies a model rewrite to it.
//
// SUBAGENT EFFORT:
//   `agent.spawn` has no effort field: a hook can set the model only. So the
//   effort is set where the API has it, at `turn.step`, which also runs for a
//   subagent's requests (e.agentId). The mod does this only for an agent whose
//   model it picked, and never when the Agent call gave an `effort` of its own.

type Klass = 'mechanical' | 'implement' | 'debug' | 'architecture'
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type Choice = { model?: string; effort?: Effort }
type ClassMap = Record<Klass, Choice>
type AgentMap = Record<Klass, string>
type AgentEffortMap = Record<Klass, Effort>

type Counts = {
  turns: Record<Klass, number>
  switches: number
  skippedByGuard: number
  agents: number
  workflowAgents: number // of `agents`: started by a workflow script
  rules: number // placed by the rules: 0 tokens
  haiku: number // placed by a haiku call: tokens spent
  kept: number // unsure in a long conversation: previous class kept, no call
}

type Decision = {
  model?: string
  effort?: Effort
  // What the engine sent at the turn's first step. A later step with another
  // model or effort means the engine changed it in the turn (a skill with a
  // model or effort of its own): the mod then leaves the rest of the turn alone.
  baseModel: string
  baseEffort: unknown
}

type Last = {
  klass?: Klass
  model?: string
  effort?: Effort
  reason: string
}

const CLASSES: readonly Klass[] = ['mechanical', 'implement', 'debug', 'architecture']
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const SHORT_CONVERSATION = 40

const DEFAULT_MAP: ClassMap = {
  mechanical: { model: 'sonnet', effort: 'low' },
  implement: { effort: 'medium' }, // model left out: the session's model
  debug: { model: 'opus', effort: 'high' },
  architecture: { model: 'opus', effort: 'high' },
}

const DEFAULT_AGENT_MAP: AgentMap = {
  mechanical: 'haiku',
  implement: 'sonnet',
  debug: 'opus',
  architecture: 'opus',
}

// The effort of a subagent whose model the mod picked (haiku takes none).
const DEFAULT_AGENT_EFFORT: AgentEffortMap = {
  mechanical: 'low',
  implement: 'medium',
  debug: 'high',
  architecture: 'high',
}

// Engine agent types with a model of their own: left alone. (An agent from a
// plugin or from the person's files is left alone by its provider tier.)
const AGENT_SKIP = new Set(['Explore', 'statusline-setup', 'claude-code-guide'])

const RUBRIC =
  'Classify this request to a coding assistant by the work it needs.\n' +
  'mechanical = rename, format, small edit, git chore (commit, push, branch), status question.\n' +
  'implement = normal feature work, write or change code.\n' +
  'debug = failing tests, errors, crashes, investigate why something breaks.\n' +
  'architecture = design, plan, refactor across many files, review of risky changes.\n' +
  'Request:\n'

// Prompts that carry no new intent: the turn keeps the previous turn's class.
const ACK =
  /^(y|ya|yes|yep|yeah|ok|okay|k|go|go on|go ahead|continue|cont|proceed|do it|sure|thanks|thank you|next|again|retry|status|lgtm|fine|agreed|right)\b[\s.!?]*$/i

const emptyCounts = (): Counts => ({
  turns: { mechanical: 0, implement: 0, debug: 0, architecture: 0 },
  switches: 0,
  skippedByGuard: 0,
  agents: 0,
  workflowAgents: 0,
  rules: 0,
  haiku: 0,
  kept: 0,
})

export const family = (model: string | undefined): string => {
  const m = (model ?? '').toLowerCase()
  for (const f of ['haiku', 'sonnet', 'opus', 'fable']) if (m.includes(f)) return f
  return m
}

const RANK: Record<string, number> = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }
const rank = (model: string | undefined) => RANK[family(model)] ?? 2

export const isAck = (text: string): boolean => {
  const t = text.trim()
  return t.length === 0 || t.length < 4 || ACK.test(t)
}

export const isPersonOverride = (text: string): boolean =>
  /^\s*!model\b/i.test(text) || /\bultrathink\b/i.test(text)

const RE_ARCH =
  /\b(architect\w*|design(s|ed|ing)?|refactor\w*|redesign\w*|restructur\w*|rfc|adr|trade-?offs?|roadmap|migrat(e|ion|ing)|plan (the|a|for)|across (the )?(repo|repos|codebase|services|apps))\b/i
const RE_DEBUG =
  /\b(fail(s|ed|ing|ure)?|crash(es|ed|ing)?|stack ?trace|traceback|regression|flaky|not working|doesn'?t work|broken|bug|why (does|is|did|are|do)|segfault|throws?|exception|(an? )?error (when|on|in|at)|got an error|getting an error)\b/i
const RE_TRACE = /(^|\n)\s*(at .+\(.+:\d+:\d+\)|Traceback \(most recent call last\)|[A-Za-z]*Error: )/
const RE_MECH =
  /^(git |gh |commit|push|pull|rebase|merge|rename|format|lint|prettier|status|list|show|open|bump|delete|remove (the )?(branch|worktree)|move|add (a )?comment|fix (a )?typo|run (the )?(tests?|lint|build))\b/i
const RE_IMPL = /\b(implement|add|create|build|write|change|update|support|feature|endpoint|component|handler|hook|tests?)\b/i

// The class of a prompt from plain rules: no model call. 'skip' = a slash
// command (the skill sets its own model). undefined = not sure.
export const ruleClass = (text: string): Klass | 'skip' | undefined => {
  const t = text.trim()
  if (t.startsWith('/')) return 'skip'
  const arch = RE_ARCH.test(t)
  const debug = RE_DEBUG.test(t) || RE_TRACE.test(t)
  const mech = t.length <= 160 && RE_MECH.test(t)
  if (arch && debug) return undefined
  if (arch) return 'architecture'
  if (debug) return 'debug'
  if (mech) return 'mechanical'
  if (RE_IMPL.test(t)) return 'implement'
  return undefined
}

// The classes that need the strong model: never placed below the session's.
const isHard = (k: Klass): boolean => k === 'debug' || k === 'architecture'

// The model a class runs on, before the cache guard: the class's model, or
// the session's when the class has none or when a hard class would go down.
export const targetModel = (klass: Klass, want: Choice, sessionModel: string): string => {
  const target = want.model ?? sessionModel
  return isHard(klass) && rank(target) < rank(sessionModel) ? sessionModel : target
}

const isKlass = (s: string): s is Klass => (CLASSES as readonly string[]).includes(s)
const isEffort = (s: string): s is Effort => (EFFORTS as readonly string[]).includes(s)

const fmt = (c: Choice) => `${c.model ?? 'session'}/${c.effort ?? '-'}`

// Module state. A hot reload resets it; the map, the switch and the counts
// live in $.store.
let enabled = true
let map: ClassMap = { ...DEFAULT_MAP }
let agentMap: AgentMap = { ...DEFAULT_AGENT_MAP }
let agentEffort: AgentEffortMap = { ...DEFAULT_AGENT_EFFORT }
let counts: Counts = emptyCounts()
let prevClass: Klass | undefined
let mechStreak = 0
let lastSessionModel: string | undefined
let personSetModel = false
// The person picked the model: later turns change the effort only.
let pinned = false
let lastStepModel: string | undefined
let lastMessageCount = 0
let last: Last = { reason: 'no turn yet' }
// haiku takes no effort level.
const fmtAgent = (k: Klass) => `${agentMap[k]}/${family(agentMap[k]) === 'haiku' ? '-' : agentEffort[k]}`
// Per turn: what turn.start found, what turn.step index 0 decided.
const turnClass = new Map<string, { klass?: Klass; skip?: string }>()
const turnDecision = new Map<string, Decision | null>()
// Agent calls that gave an `effort` of their own, by tool_use_id: left alone.
const explicitEffort = new Set<string>()
// Subagents whose model the mod picked, by agentId: the effort of their steps.
const agentStepEffort = new Map<string, Effort>()
const KEEP = 200

function trim(c: Set<string> | Map<string, unknown>) {
  while (c.size > KEEP) {
    const first = c.keys().next().value
    if (first === undefined) return
    c.delete(first)
  }
}

async function loadStore($: EngineInterface) {
  const stored = await $.store.get('enabled')
  enabled = stored !== false
  const m = (await $.store.get('map')) as Partial<ClassMap> | undefined
  if (m && typeof m === 'object') map = { ...DEFAULT_MAP, ...m }
  const a = (await $.store.get('agentMap')) as Partial<AgentMap> | undefined
  if (a && typeof a === 'object') agentMap = { ...DEFAULT_AGENT_MAP, ...a }
  const ae = (await $.store.get('agentEffort')) as Partial<AgentEffortMap> | undefined
  if (ae && typeof ae === 'object') agentEffort = { ...DEFAULT_AGENT_EFFORT, ...ae }
  const c = (await $.store.get('counts')) as Counts | undefined
  if (c && typeof c === 'object' && c.turns) counts = { ...emptyCounts(), ...c }
}

function saveCounts($: EngineInterface) {
  return $.store.set('counts', counts).catch(() => {})
}

function show($: EngineInterface, text?: string) {
  try {
    $.ui.status(enabled ? text : undefined)
  } catch {
    // status is cosmetic
  }
}

async function classify($: EngineInterface, text: string): Promise<Klass | undefined> {
  const label = await $.model.classify(RUBRIC + text.slice(0, 2000), CLASSES, { model: 'haiku' })
  return label !== undefined && isKlass(label) ? label : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await loadStore($)
      await $.command.register({
        name: 'automodel',
        description: 'Automatic model/effort per turn: on, off, status, map',
        argumentHint: 'on | off | status | map [class=model/effort] [agent.class=model/effort]',
        immediate: true,
      })
      show($, 'auto: ready')
    } catch {
      // never block the session start
    }
    return next(e)
  })

  // A model switch the person made: no override on the next turn, and the
  // cache baseline restarts from the new model.
  on('classic.PostModelSwitch', async ($, e, next) => {
    try {
      if (e.source === 'command' || e.source === 'picker' || e.source === 'sdk') {
        personSetModel = true
        pinned = true
        lastStepModel = undefined
      }
    } catch {
      // observe only
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    try {
      if (!enabled) return next(e)
      // Also catch a /model the hook above did not see: the session model moved.
      const sessionModel = await $.session.model()
      if (lastSessionModel !== undefined && sessionModel !== lastSessionModel) {
        personSetModel = true
        lastStepModel = undefined
      }
      lastSessionModel = sessionModel

      if (personSetModel) {
        personSetModel = false
        turnClass.set(e.turnId, { skip: 'you set the model' })
        return next(e)
      }
      if (isPersonOverride(e.text)) {
        turnClass.set(e.turnId, { skip: '!model or ultrathink in the prompt' })
        return next(e)
      }

      let klass: Klass | undefined
      if (isAck(e.text)) {
        klass = prevClass
      } else {
        const byRule = ruleClass(e.text)
        if (byRule === 'skip') {
          turnClass.set(e.turnId, { skip: 'slash command: the skill sets its own model' })
          return next(e)
        }
        if (byRule !== undefined) {
          klass = byRule
          counts.rules += 1
        } else if (lastMessageCount >= SHORT_CONVERSATION) {
          // Long conversation, unsure: the cache guard would keep the model, so
          // a call would cost tokens and change nothing. Keep the last class.
          klass = prevClass
          counts.kept += 1
        } else {
          const byModel = await classify($, e.text).catch(() => undefined)
          if (byModel !== undefined) counts.haiku += 1
          klass = byModel ?? prevClass
        }
      }
      if (klass === undefined) {
        turnClass.set(e.turnId, { skip: 'no class yet' })
        return next(e)
      }
      mechStreak = klass === 'mechanical' && prevClass === 'mechanical' ? mechStreak + 1 : klass === 'mechanical' ? 1 : 0
      prevClass = klass
      counts.turns[klass] += 1
      void saveCounts($)
      turnClass.set(e.turnId, { klass })
    } catch {
      // fall through to the engine unchanged
    }
    return next(e)
  })

  // Decide at index 0, keep it for every later step of the turn (see the
  // CACHE GUARD comment at the top of this file).
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) lastMessageCount = e.messageCount
    if (e.agentId !== undefined) {
      // A subagent's request: the effort of its class, when the mod sized it.
      // No effort on the request (a model that takes none, or effort unset)
      // stays that way.
      const want = enabled ? agentStepEffort.get(e.agentId) : undefined
      if (want === undefined || e.effort === undefined || family(e.model) === 'haiku') return yield* next(e)
      return yield* next({ ...e, effort: want })
    }
    if (!enabled) return yield* next(e)
    let decision: Decision | null | undefined
    try {
      decision = turnDecision.get(e.turnId)
      if (decision && (e.model !== decision.baseModel || e.effort !== decision.baseEffort)) {
        decision = null
        turnDecision.set(e.turnId, null)
        last = { ...last, reason: 'left alone: a skill set its own model or effort in this turn' }
        show($, 'auto: off this turn (a skill set the model)')
      }
      if (decision === undefined) {
        decision = null
        const tc = turnClass.get(e.turnId)
        turnClass.delete(e.turnId)
        if (tc?.skip !== undefined) {
          last = { reason: `skipped: ${tc.skip}`, model: e.model, effort: typeof e.effort === 'string' ? e.effort : undefined }
          show($, `auto: off this turn (${tc.skip})`)
        } else if (tc?.klass !== undefined) {
          const klass = tc.klass
          const want = map[klass]
          const target = targetModel(klass, want, e.model)
          const prev = lastStepModel ?? e.model
          let model: string | undefined
          let reason: string
          if (pinned) {
            model = undefined
            reason = 'you set the model: effort only (/automodel on releases it)'
          } else if (family(target) === family(prev)) {
            model = family(target) === family(e.model) ? undefined : prev
            reason = 'same model as the last step'
          } else {
            const isCheaper = rank(target) < rank(prev)
            const isShort = e.messageCount < SHORT_CONVERSATION
            const isMechStretch = klass === 'mechanical' && mechStreak >= 2
            if (isShort || (isCheaper && isMechStretch)) {
              model = target
              counts.switches += 1
              reason = isShort
                ? `switched: ${e.messageCount} messages < ${SHORT_CONVERSATION}`
                : 'switched: cheaper model for a mechanical stretch'
            } else {
              model = family(prev) === family(e.model) ? undefined : prev
              counts.skippedByGuard += 1
              reason = `cache guard: kept ${family(prev)} (${e.messageCount} messages); effort only`
            }
            void saveCounts($)
          }
          const sent = model ?? e.model
          // haiku takes no effort level.
          const effort = family(sent) === 'haiku' ? undefined : want.effort
          decision = { model, effort, baseModel: e.model, baseEffort: e.effort }
          last = { klass, model: sent, effort: effort ?? (typeof e.effort === 'string' ? e.effort : undefined), reason }
          const guarded = reason.startsWith('cache guard') ? ' (cache)' : pinned ? ' (yours)' : ''
          show($, `auto: ${klass} → ${family(sent) || sent}/${effort ?? '-'}${guarded}`)
        }
        turnDecision.set(e.turnId, decision)
        // Keep the maps small.
        if (turnDecision.size > 50) {
          const first = turnDecision.keys().next().value
          if (first !== undefined) turnDecision.delete(first)
        }
      }
    } catch {
      decision = null
    }

    if (decision === null || decision === undefined) {
      lastStepModel = e.model
      return yield* next(e)
    }
    const rewritten = {
      ...e,
      ...(decision.model !== undefined ? { model: decision.model } : {}),
      ...(decision.effort !== undefined ? { effort: decision.effort } : {}),
    }
    lastStepModel = rewritten.model
    return yield* next(rewritten)
  })

  on('turn.complete', ($, e, next) => {
    try {
      if (e.agentId === undefined) turnDecision.delete(e.turnId)
    } catch {
      // observe only
    }
    return next(e)
  })

  // An Agent call with an `effort` of its own: remember it, so the mod leaves
  // that agent's effort alone.
  on('tool.call', { tool: 'Agent' }, ($, e, next) => {
    try {
      if ((e as { effort?: unknown }).effort !== undefined) {
        explicitEffort.add(e.tool_use_id)
        trim(explicitEffort)
      }
    } catch {
      // observe only
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Subagents and workflow agents: pick a model when the call gave none.
  on('agent.spawn', async ($, e, next) => {
    let klass: Klass | undefined
    try {
      if (
        !enabled ||
        e.fork ||
        e.model !== undefined ||
        e.resume !== undefined ||
        e.subagentType === 'fork' ||
        e.provider.tier !== 'core' ||
        AGENT_SKIP.has(e.subagentType) ||
        e.prompt.trim().length === 0
      ) {
        return next(e)
      }
      klass = await classify($, e.prompt).catch(() => undefined)
      if (klass === undefined) return next(e)
      counts.haiku += 1
      counts.agents += 1
      if (e.workflow !== undefined) counts.workflowAgents += 1
      void saveCounts($)
    } catch {
      return next(e)
    }
    const model = agentMap[klass]
    const started = await next({ ...e, model })
    try {
      // The effort goes on the agent's steps (turn.step): agent.spawn has no
      // effort field. A workflow shares one tool_use_id (the Workflow call's),
      // which never carries an effort.
      const isExplicit = e.workflow === undefined && explicitEffort.has(e.tool_use_id)
      if (started.agentId !== undefined && !isExplicit && family(started.model ?? model) !== 'haiku') {
        agentStepEffort.set(started.agentId, agentEffort[klass])
        trim(agentStepEffort)
      }
    } catch {
      // the agent started: the effort is a bonus
    }
    return started
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'automodel' }, async ($, e) => {
    try {
      const [sub = 'status', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
      switch (sub) {
        case 'on':
          enabled = true
          pinned = false
          await $.store.set('enabled', true)
          show($, 'auto: on')
          return { text: 'automodel is on. It picks the model again.' }
        case 'off':
          enabled = false
          await $.store.set('enabled', false)
          show($, undefined)
          return { text: 'automodel is off. The session model and effort apply.' }
        case 'map': {
          const changed: string[] = []
          const bad: string[] = []
          for (const pair of rest) {
            const m = /^(agent\.)?([a-z]+)=([^/\s]*)(?:\/([a-z]+))?$/.exec(pair)
            const k = m?.[2]
            if (!m || k === undefined || !isKlass(k)) {
              bad.push(pair)
              continue
            }
            const modelPart = m[3] ?? ''
            const effortPart = m[4]
            if (effortPart !== undefined && !isEffort(effortPart)) {
              bad.push(pair)
              continue
            }
            if (m[1]) {
              if (!modelPart && effortPart === undefined) {
                bad.push(pair)
                continue
              }
              if (modelPart) agentMap = { ...agentMap, [k]: modelPart }
              if (effortPart !== undefined) agentEffort = { ...agentEffort, [k]: effortPart }
              changed.push(`agent.${k}=${fmtAgent(k)}`)
              continue
            }
            const model = modelPart === '' || modelPart === 'session' || modelPart === '-' ? undefined : modelPart
            map = { ...map, [k]: { model, effort: effortPart ?? map[k].effort } }
            changed.push(`${k}=${fmt(map[k])}`)
          }
          if (rest[0] === 'reset') {
            map = { ...DEFAULT_MAP }
            agentMap = { ...DEFAULT_AGENT_MAP }
            agentEffort = { ...DEFAULT_AGENT_EFFORT }
            await $.store.delete('map')
            await $.store.delete('agentMap')
            await $.store.delete('agentEffort')
          } else if (changed.length > 0) {
            await $.store.set('map', map)
            await $.store.set('agentMap', agentMap)
            await $.store.set('agentEffort', agentEffort)
          }
          const lines = [
            ...CLASSES.map(k => `  ${k.padEnd(12)} main ${fmt(map[k]).padEnd(16)} agent ${fmtAgent(k)}`),
          ]
          const head = rest[0] === 'reset' ? 'Map reset to defaults.' : changed.length > 0 ? `Set: ${changed.join(', ')}.` : 'Class map:'
          const tail = bad.length > 0 ? `\nNot understood: ${bad.join(' ')} (use class=model/effort, agent.class=model/effort, or reset).` : ''
          return { text: `${head}\n${lines.join('\n')}${tail}` }
        }
        case 'status':
        default: {
          const t = counts.turns
          return {
            text: [
              `automodel is ${enabled ? 'on' : 'off'}.${pinned ? ' You set the model: effort only (/automodel on releases it).' : ''}`,
              `Last: class ${last.klass ?? '-'}, model ${last.model ?? '-'}, effort ${last.effort ?? '-'}.`,
              `Reason: ${last.reason}.`,
              `Turns: mechanical ${t.mechanical}, implement ${t.implement}, debug ${t.debug}, architecture ${t.architecture}.`,
              `Model switches: ${counts.switches} made, ${counts.skippedByGuard} skipped by the cache guard. Subagents set: ${counts.agents} (${counts.workflowAgents} in workflows).`,
              `Classified: ${counts.rules} by rules (0 tokens), ${counts.haiku} by a haiku call, ${counts.kept} kept in a long conversation (no call).`,
            ].join('\n'),
          }
        }
      }
    } catch (err) {
      return { text: `automodel: the command failed (${String(err)}).` }
    }
  })
}
