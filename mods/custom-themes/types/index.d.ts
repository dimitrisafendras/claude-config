export type Choice = {
  /** The theme this session shows, by its own choice or the one for all projects; absent, none. */
  applied?: string
  /** Whose choice `applied` is: this session's own, or the one for all projects ('project' is the stored name of that scope). */
  scope?: 'session' | 'project'
  /** A theme shown for a look only, until it is applied or the look ends. */
  preview?: string
  /** The card shows above the prompt: the surface draws no placed rows yet. */
  cardInBand?: boolean
  /** The placed card was put away: the hook that draws it passes until the command shows it again. */
  cardAway?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'custom-themes': { choice: Shaped<Choice>; fill: number }
  }
}
