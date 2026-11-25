export type DoctorState =
  | 'connected'
  | 'connected now'
  | 'needs sign-in'
  | 'failed'
  | 'turned off'
  | 'not approved'
  | 'blocked by policy'
  | 'not in this session'
  | 'check failed'

export type DoctorRow = {
  server: string
  state: DoctorState
  action: string
  todo: string
}

export type DoctorReport = {
  at: number
  rows: DoctorRow[]
  gh: { isOk: boolean; text: string }
}

declare module 'claude-code' {
  interface PluginState {
    'connect-doctor': {
      report: Shaped<DoctorReport | null>
      seen: Shaped<string[]>
    }
  }
}
