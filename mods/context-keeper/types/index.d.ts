/** One plan or todo item as the last TodoWrite, Task or plan call left it. */
export type ContextKeeperItem = { content: string; status: string; id?: string }

/** The task state the mod keeps for one session. */
export type ContextKeeperRecord = {
  repoRoot?: string
  branch?: string
  worktree?: string
  /** PR URLs or #numbers seen in tool calls, newest last, at most 10. */
  prs: string[]
  /** The last plan or todo list seen, at most 30 items. */
  items: ContextKeeperItem[]
  /** Lines the person stated as rules, newest last, at most 15. */
  decisions: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'context-keeper': {
      record: ContextKeeperRecord
      /** True after a compaction until the record rides on the next prompt. */
      isPending: boolean
    }
  }
}
