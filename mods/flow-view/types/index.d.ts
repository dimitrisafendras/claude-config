export type Step = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  startedAt?: number
  endedAt?: number
}

export type FlowNode = {
  id: string
  label: string
  kind: string
  model?: string
  prompt?: string
  parent?: string
  status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  startedAt: number
  endedAt?: number
  calls: number
  errors: number
  lastTool?: string
}

export type Call = {
  id: string
  tool: string
  agent: string
  startedAt: number
  endedAt?: number
  isError: boolean
}

export type Flow = {
  steps: Step[]
  nodes: FlowNode[]
  calls: Call[]
  tools: Record<string, number>
  turns: number
  title?: string
  since?: number
  started: string[]
  me?: Involvement
}

/** How much of the session the person took part in. `idleSince` is when the last main turn ended; a running turn has none. */
export type Involvement = {
  mine: number
  mineMs: number
  waitMs: number
  busyMs: number
  idleSince?: number
}

export type PeerAgent = {
  label: string
  kind: string
  status: FlowNode['status']
  depth: number
}

/** One session, as it publishes itself to the store for the other sessions. */
export type Peer = {
  id: string
  title: string
  folder: string
  status: FlowNode['status']
  startedAt: number
  updatedAt: number
  stepsDone: number
  stepsTotal: number
  step?: string
  steps: Step[]
  agents: PeerAgent[]
  calls: number
  started: string[]
}

/** One row of the plan of /start-work: a ticket or a pull request to fix. */
export type Ticket = {
  id: string
  n?: number
  title: string
  url?: string
  source?: string
  repo?: string
  surface?: string
  sev?: number
  size?: string
  model?: string
  state: string
  branch?: string
  pr?: string
  prNumber?: number
  ci?: string
  session?: string
  note?: string
  /** When the mod first saw work on the ticket, and when it first saw it done. */
  startedAt?: number
  endedAt?: number
  /** The messages of the person while the ticket was open, and the estimate of their time for it. */
  mine?: number
  mineMs?: number
}

/** A session or an agent that works on the plan. */
export type Worker = {
  id: string
  name?: string
  kind: string
  title?: string
  surface?: string
  model?: string
  state: string
  branch?: string
}

/** One day of /start-work. */
export type Board = {
  id: string
  phase: string
  headline?: string
  needsYou: string[]
  rows: Ticket[]
  workers: Worker[]
  updatedAt: number
}

export type View = {
  tab: 'tickets' | 'sessions'
  /** Which tickets the list shows. */
  filter: 'all' | 'running' | 'review' | 'done' | 'needs' | 'queued'
  /** The ticket that is open, or ''. */
  ticket: string
  /** The session that is open, or ''. */
  session: string
  /** The Sessions list shows only the sessions that run. */
  live?: boolean
  /** The ticket groups that are collapsed. */
  closed?: string[]
  /** Each ticket shows its list of steps. */
  steps?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'flow-view': { flow: Shaped<Flow>; view: Shaped<View>; peers: Shaped<Peer[]>; board: Shaped<Board> }
  }
}
