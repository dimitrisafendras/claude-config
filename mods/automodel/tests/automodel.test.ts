import { expect, mock, test } from 'claude-code/testing'
import type { On, TurnStepInput } from 'claude-code'
import { ruleClass, targetModel } from '../hooks/register'

// Nothing sits beneath the plugin: each hook here stands for the engine.
function engine(on: On, label: { value: string; calls?: number }) {
  const steps: TurnStepInput[] = []
  const statuses: (string | undefined)[] = []
  mock.store(on)
  on('model.classify', () => {
    label.calls = (label.calls ?? 0) + 1
    return { value: label.value }
  })
  on('session.model', () => ({ value: 'claude-sonnet-4-6' }))
  on('command.register', () => ({ value: { command: 'automodel' } }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    steps.push({ ...e })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  let agents = 0
  on('agent.spawn', (_, e) => ({ model: e.model ?? e.parentModel, agentId: `a${++agents}` }))
  on('tool.call', () => ({ result: 'started' }))
  return { steps, statuses }
}

async function drain<T>(stream: AsyncGenerator<unknown, T>): Promise<T> {
  let r = await stream.next()
  while (!r.done) r = await stream.next()
  return r.value
}

const CMD = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }

const step = (turnId: string, index: number, messageCount: number, model = 'claude-sonnet-4-6') =>
  ({ turnId, index, model, effort: 'medium' as const, messageCount })

test('a debug prompt in a short conversation runs on opus/high for every step', async ($, on) => {
  const label = { value: 'debug' }
  const { steps } = engine(on, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'the login test fails with a TypeError, find out why', turnId: 't1' })
  await drain($.turn.step(step('t1', 0, 5)))
  await drain($.turn.step(step('t1', 1, 7)))

  expect(steps.map(s => [s.model, s.effort])).toEqual([
    ['opus', 'high'],
    ['opus', 'high'],
  ])
})

test('the cache guard keeps the model in a long conversation and changes effort only', async ($, on) => {
  const label = { value: 'debug' }
  const { steps } = engine(on, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'why does the build crash on start?', turnId: 't1' })
  await drain($.turn.step(step('t1', 0, 120)))

  expect(steps[0]?.model).toBe('claude-sonnet-4-6')
  expect(steps[0]?.effort).toBe('high')

  const out = await $.command.run({ ...CMD, command: 'automodel', args: 'status' })
  expect(out.text).toMatch(/1 skipped by the cache guard/)
  expect(out.text).toMatch(/cache guard/)
})

test('"yes" keeps the previous class and does not classify again', async ($, on) => {
  const label = { value: 'mechanical' }
  const { steps } = engine(on, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'rename foo to bar in utils.ts', turnId: 't1' })
  await drain($.turn.step(step('t1', 0, 3)))
  label.value = 'architecture' // would move to opus if it were asked
  await $.turn.start({ text: 'yes', turnId: 't2' })
  await drain($.turn.step(step('t2', 0, 6)))

  expect(steps.map(s => [s.model, s.effort])).toEqual([
    ['claude-sonnet-4-6', 'low'],
    ['claude-sonnet-4-6', 'low'],
  ])
})

test('ultrathink in the prompt leaves the turn alone', async ($, on) => {
  const { steps } = engine(on, { value: 'mechanical' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'ultrathink about the cache layer', turnId: 't1' })
  await drain($.turn.step(step('t1', 0, 3)))

  expect(steps[0]).toMatchObject({ model: 'claude-sonnet-4-6', effort: 'medium' })
})

test('a subagent with no model gets one from its class; an explicit model stays', async ($, on) => {
  const label = { value: 'mechanical' }
  engine(on, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const spawn = {
    tool_use_id: 'tu1',
    prompt: 'run git status and report',
    description: 'git status',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' as const },
    parentModel: 'claude-opus-4-7',
    background: false,
    fork: false,
  }
  const a = await $.agent.spawn(spawn)
  expect(a.model).toBe('haiku')
  const b = await $.agent.spawn({ ...spawn, model: 'opus' })
  expect(b.model).toBe('opus')
})

test('/automodel map sets a class and off stops the overrides', async ($, on) => {
  const { steps } = engine(on, { value: 'debug' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const set = await $.command.run({ ...CMD, command: 'automodel', args: 'map debug=opus/max' })
  expect(set.text).toMatch(/debug=opus\/max/)
  await $.turn.start({ text: 'tests fail after the upgrade', turnId: 't1' })
  await drain($.turn.step(step('t1', 0, 3)))
  expect(steps[0]).toMatchObject({ model: 'opus', effort: 'max' })

  await $.command.run({ ...CMD, command: 'automodel', args: 'off' })
  await $.turn.start({ text: 'tests fail again', turnId: 't2' })
  await drain($.turn.step(step('t2', 0, 5)))
  expect(steps[1]).toMatchObject({ model: 'claude-sonnet-4-6', effort: 'medium' })
})

test('rules place a clear prompt with no model call', async ($, on) => {
  const label: { value: string; calls?: number } = { value: 'architecture' }
  const { steps } = engine(on, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'rename foo to bar in utils.ts', turnId: 't1' })
  await drain($.turn.step(step('t1', 0, 3)))

  expect(label.calls ?? 0).toBe(0)
  expect(steps[0]).toMatchObject({ model: 'claude-sonnet-4-6', effort: 'low' })
  const out = await $.command.run({ ...CMD, command: 'automodel', args: 'status' })
  expect(out.text).toMatch(/1 by rules \(0 tokens\), 0 by a haiku call, 0 kept/)
})

test('ruleClass: the rules and their limits', () => {
  expect(ruleClass('/monitor')).toBe('skip')
  expect(ruleClass('git status')).toBe('mechanical')
  expect(ruleClass('the build crashes with a stack trace')).toBe('debug')
  expect(ruleClass('TypeError: x is not a function\n    at run (a.ts:3:9)')).toBe('debug')
  expect(ruleClass('design the new sync architecture')).toBe('architecture')
  expect(ruleClass('add a retry to the upload handler')).toBe('implement')
  // Debug and architecture words together: not sure, so no rule answers.
  expect(ruleClass('why does the refactor of the design fail')).toBeUndefined()
  expect(ruleClass('hmm what about the other thing')).toBeUndefined()
})

test('an unsure prompt in a short conversation asks haiku once', async ($, on) => {
  const label: { value: string; calls?: number } = { value: 'implement' }
  const { steps } = engine(on, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hmm what about the other thing we talked about', turnId: 't1' })
  await drain($.turn.step(step('t1', 0, 5)))

  expect(label.calls).toBe(1)
  expect(steps[0]).toMatchObject({ effort: 'medium' })
  const out = await $.command.run({ ...CMD, command: 'automodel', args: 'status' })
  expect(out.text).toMatch(/0 by rules \(0 tokens\), 1 by a haiku call, 0 kept/)
})

test('an unsure prompt in a long conversation makes no call and keeps the class', async ($, on) => {
  const label: { value: string; calls?: number } = { value: 'debug' }
  const { steps } = engine(on, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // The first turn is long (120 messages) and clear: the rules place it as debug.
  await $.turn.start({ text: 'the deploy fails every time', turnId: 't1' })
  await drain($.turn.step(step('t1', 0, 120)))
  await $.turn.start({ text: 'hmm what about the other thing we talked about', turnId: 't2' })
  await drain($.turn.step(step('t2', 0, 122)))

  expect(label.calls ?? 0).toBe(0)
  // The previous class (debug) is kept, so the effort is the debug effort.
  expect(steps[1]).toMatchObject({ effort: 'high' })
  const out = await $.command.run({ ...CMD, command: 'automodel', args: 'status' })
  expect(out.text).toMatch(/1 by rules \(0 tokens\), 0 by a haiku call, 1 kept/)
})

test('a slash command is left alone', async ($, on) => {
  const label: { value: string; calls?: number } = { value: 'architecture' }
  const { steps } = engine(on, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: '/paralel TICKET-1 TICKET-2', turnId: 't1' })
  await drain($.turn.step(step('t1', 0, 4)))

  expect(label.calls ?? 0).toBe(0)
  expect(steps[0]).toMatchObject({ model: 'claude-sonnet-4-6', effort: 'medium' })
})

test('a subagent prompt is placed by a haiku call, not by the rules', async ($, on) => {
  // The brief names an error and a design in passing: the rules would send it to opus.
  const label: { value: string; calls?: number } = { value: 'mechanical' }
  engine(on, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const a = await $.agent.spawn({
    tool_use_id: 'tu2',
    prompt: 'List the files that the design doc names. If a file fails to open, report the error and go on.',
    description: 'list files',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' as const },
    parentModel: 'claude-opus-4-7',
    background: false,
    fork: false,
  })
  expect(a.model).toBe('haiku')
  expect(label.calls).toBe(1)
})

test('an agent from a plugin or the person keeps the model of its definition', async ($, on) => {
  const label: { value: string; calls?: number } = { value: 'mechanical' }
  engine(on, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const a = await $.agent.spawn({
    tool_use_id: 'tu3',
    prompt: 'review the diff of this branch',
    description: 'review',
    subagentType: 'pr-reviewer',
    provider: { plugin: 'user', tier: 'user' as const },
    parentModel: 'claude-opus-4-7',
    background: false,
    fork: false,
  })
  expect(a.model).toBe('claude-opus-4-7') // the engine stand-in: no model was set
  expect(label.calls ?? 0).toBe(0)
})

test('a hard class never goes below the session model', async ($, on) => {
  const { steps } = engine(on, { value: 'debug' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'the login test fails with a TypeError, find out why', turnId: 't1' })
  await drain($.turn.step(step('t1', 0, 5, 'claude-fable-5-2')))

  // debug maps to opus, but the session runs fable: the model stays, the effort changes.
  expect(steps[0]).toMatchObject({ model: 'claude-fable-5-2', effort: 'high' })
  expect(targetModel('architecture', { model: 'opus' }, 'claude-fable-5-2')).toBe('claude-fable-5-2')
  expect(targetModel('debug', { model: 'opus' }, 'claude-sonnet-4-6')).toBe('opus')
  // A class that is not hard may still go down.
  expect(targetModel('mechanical', { model: 'sonnet' }, 'claude-opus-4-7')).toBe('sonnet')
})

test('a model the person set stays until /automodel on', async ($, on) => {
  const { steps } = engine(on, { value: 'debug' })
  on('classic.PostModelSwitch', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.classic.PostModelSwitch({
    hook_event_name: 'PostModelSwitch',
    from_model: 'claude-opus-4-7',
    to_model: 'claude-sonnet-4-6',
    requested_model: 'sonnet',
    source: 'command',
    context_tokens: 0,
  } as never)
  // The turn after the switch is left alone.
  await $.turn.start({ text: 'the deploy fails every time', turnId: 't1' })
  await drain($.turn.step(step('t1', 0, 3)))
  expect(steps[0]).toMatchObject({ model: 'claude-sonnet-4-6', effort: 'medium' })
  // Later turns: the model stays, the effort follows the class.
  await $.turn.start({ text: 'the build crashes with a stack trace', turnId: 't2' })
  await drain($.turn.step(step('t2', 0, 6)))
  expect(steps[1]).toMatchObject({ model: 'claude-sonnet-4-6', effort: 'high' })
  const status = await $.command.run({ ...CMD, command: 'automodel', args: 'status' })
  expect(status.text).toMatch(/You set the model/)

  await $.command.run({ ...CMD, command: 'automodel', args: 'on' })
  await $.turn.start({ text: 'the tests fail after the upgrade', turnId: 't3' })
  await drain($.turn.step(step('t3', 0, 9)))
  expect(steps[2]).toMatchObject({ model: 'opus', effort: 'high' })
})

test('a skill that sets its own model in the turn is left alone from that step', async ($, on) => {
  const { steps } = engine(on, { value: 'debug' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'the login test fails with a TypeError, find out why', turnId: 't1' })
  await drain($.turn.step(step('t1', 0, 5)))
  // A skill started: the engine now sends the skill's model.
  await drain($.turn.step(step('t1', 1, 7, 'claude-haiku-4-5')))
  await drain($.turn.step(step('t1', 2, 9, 'claude-haiku-4-5')))

  expect(steps.map(s => [s.model, s.effort])).toEqual([
    ['opus', 'high'],
    ['claude-haiku-4-5', 'medium'],
    ['claude-haiku-4-5', 'medium'],
  ])
  const out = await $.command.run({ ...CMD, command: 'automodel', args: 'status' })
  expect(out.text).toMatch(/a skill set its own model or effort/)
})

const SPAWN = {
  tool_use_id: 'tu-agent',
  prompt: 'find out why the upload handler loses the last chunk',
  description: 'upload bug',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-4-7',
  background: true,
  fork: false,
}

const agentStep = (agentId: string, index: number, model: string, effort: 'medium' | 'none' = 'medium') =>
  ({ turnId: `turn-${agentId}`, index, model, messageCount: 2 + index, agentId, ...(effort === 'none' ? {} : { effort }) })

test('a workflow agent gets its model by the same rules as a subagent', async ($, on) => {
  const label: { value: string; calls?: number } = { value: 'implement' }
  engine(on, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const wf = { ...SPAWN, tool_use_id: 'tu-wf', workflow: { runId: 'wf_abc123', agentIndex: 1 } }
  const a = await $.agent.spawn(wf)
  expect(a.model).toBe('sonnet')
  // A model that the script gave stays, with no haiku call.
  const b = await $.agent.spawn({ ...wf, model: 'opus', workflow: { runId: 'wf_abc123', agentIndex: 2 } })
  expect(b.model).toBe('opus')
  expect(label.calls).toBe(1)
  const out = await $.command.run({ ...CMD, command: 'automodel', args: 'status' })
  expect(out.text).toMatch(/Subagents set: 1 \(1 in workflows\)/)
})

test('a subagent the mod sized runs each step on the effort of its class', async ($, on) => {
  const label = { value: 'debug' }
  const { steps } = engine(on, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const a = await $.agent.spawn(SPAWN)
  expect(a).toMatchObject({ model: 'opus', agentId: 'a1' })
  await drain($.turn.step(agentStep('a1', 0, 'claude-opus-4-7')))
  await drain($.turn.step(agentStep('a1', 1, 'claude-opus-4-7')))
  // A workflow agent: the same, by its agentId.
  label.value = 'implement'
  const w = await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu-wf', workflow: { runId: 'wf_abc123', agentIndex: 1 } })
  await drain($.turn.step(agentStep(w.agentId ?? '', 0, 'claude-sonnet-4-6', 'none')))
  await drain($.turn.step({ ...agentStep(w.agentId ?? '', 1, 'claude-sonnet-4-6'), effort: 'high' as const }))

  expect(steps.map(s => [s.agentId, s.effort])).toEqual([
    ['a1', 'high'],
    ['a1', 'high'],
    ['a2', undefined], // the request carried no effort: none is added
    ['a2', 'medium'],
  ])
})

test('subagent effort is left alone: explicit model, explicit effort, haiku, and off', async ($, on) => {
  const label = { value: 'debug' }
  const { steps } = engine(on, label)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // a1: the Agent call gave a model (the dispatcher sized it): not touched.
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu1', model: 'sonnet' })
  await drain($.turn.step(agentStep('a1', 0, 'claude-sonnet-4-6')))
  // a2: the Agent call gave an effort and no model: the mod picks the model only.
  await $.tool.call({ tool: 'Agent', tool_use_id: 'tu2', prompt: SPAWN.prompt, description: 'x', effort: 'low' } as never)
  const b = await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu2' })
  expect(b.model).toBe('opus')
  await drain($.turn.step({ ...agentStep('a2', 0, 'claude-opus-4-7'), effort: 'low' as const }))
  // a3: a mechanical task goes to haiku, which takes no effort.
  label.value = 'mechanical'
  const c = await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu3' })
  expect(c.model).toBe('haiku')
  await drain($.turn.step(agentStep('a3', 0, 'claude-haiku-4-5')))
  // a4: sized, then /automodel off.
  label.value = 'debug'
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu4' })
  await $.command.run({ ...CMD, command: 'automodel', args: 'off' })
  await drain($.turn.step(agentStep('a4', 0, 'claude-opus-4-7')))

  expect(steps.map(s => [s.agentId, s.effort])).toEqual([
    ['a1', 'medium'],
    ['a2', 'low'],
    ['a3', 'medium'],
    ['a4', 'medium'],
  ])
})

test('/automodel map sets the model and the effort of a subagent class', async ($, on) => {
  const { steps } = engine(on, { value: 'debug' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const set = await $.command.run({ ...CMD, command: 'automodel', args: 'map agent.debug=sonnet/xhigh agent.implement=/high' })
  expect(set.text).toMatch(/agent\.debug=sonnet\/xhigh, agent\.implement=sonnet\/high/)
  expect(set.text).toMatch(/mechanical .* agent haiku\/-/)
  const a = await $.agent.spawn(SPAWN)
  expect(a.model).toBe('sonnet')
  await drain($.turn.step(agentStep('a1', 0, 'claude-sonnet-4-6')))
  expect(steps[0]).toMatchObject({ agentId: 'a1', effort: 'xhigh' })
  const bad = await $.command.run({ ...CMD, command: 'automodel', args: 'map agent.debug=opus/huge' })
  expect(bad.text).toMatch(/Not understood: agent\.debug=opus\/huge/)
})
