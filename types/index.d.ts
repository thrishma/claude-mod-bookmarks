export type Bookmark = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  /** For a tool row: which tool (`Bash`, `Edit`, …). */
  tool?: string
  /** What Copy puts on the clipboard when it is not the text itself (a Bash command). */
  copy?: string
  /** Kept in Claude's system prompt in this project, so it survives /compact. */
  pinned?: boolean
  text: string
  note: string
  cwd: string
  savedAt: number
  /** The transcript row it came from, when bookmarked from a mouse selection: what Jump scrolls to. */
  rowId?: string
  /** Its highlight color, one of the palette's; absent on bookmarks saved before colors. */
  color?: string
}

declare module 'claude-code' {
  interface PluginState {
    /**
     * `filter` is the tag the pane shows ('' for all); `selected` the ids checked for Ask;
     * `expanded` the card showing its actions ('' for the newest).
     */
    bookmarks: { list: Bookmark[]; filter: string; selected: string[]; expanded: string }
  }
}
