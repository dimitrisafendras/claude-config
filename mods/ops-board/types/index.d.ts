export type OpsVerdict = 'red' | 'pending' | 'green' | 'conflict' | 'changes-requested' | 'old' | 'unknown'

export type OpsAgent = {
  id: string
  label: string
  type: string
  model: string
  status: string
  firstSeen: number
  endedAt?: number
}

export type OpsTask = {
  id: string
  type: string
  status: string
  description: string
}

export type OpsPr = {
  repo: string
  number: number
  title: string
  url: string
  updatedAt: string
  verdict: OpsVerdict
  detail?: string
}

export type OpsCi = {
  updatedAt: string
  verdict: OpsVerdict
  detail?: string
  checkedAt: number
}

export type OpsLaneHealth = 'ok' | 'silent' | 'dead' | 'done'

export type OpsLane = {
  /** `<ledger file>#<lane>`. */
  key: string
  file: string
  lane: string
  label: string
  state: string
  health: OpsLaneHealth
  why: string
  /** True when this session is the ledger's coordinator: only then does ops-board start a turn for it. */
  isMine: boolean
  /** What ops-board did for it: check asked, restart asked, decision written. */
  done?: string
}

export type OpsBoard = {
  agents: OpsAgent[]
  spawned: Record<string, { model: string; startedAt: number }>
  tasks: OpsTask[]
  tasksAt: number
  prs: OpsPr[]
  prsAt: number
  prError: string
  ghCalls: number
  backoffUntil: number
  backoffMs: number
  isRefreshing: boolean
  ci: Record<string, OpsCi>
  lanes: OpsLane[]
  lanesAt: number
  laneError: string
  isKillSwitchOn: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'ops-board': { board: Shaped<OpsBoard> }
  }
}
