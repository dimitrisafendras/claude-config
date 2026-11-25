export type CheatButton = { label: string; command: string; isSend: boolean; hint?: string }

declare module 'claude-code' {
  interface PluginState {
    cheatsheet: { buttons: CheatButton[]; isHidden: boolean }
  }
}
