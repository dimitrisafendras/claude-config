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
}

declare module 'claude-code' {
  interface PluginState {
    'ops-board': { board: Shaped<OpsBoard> }
  }
}
