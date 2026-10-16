export type Bookmark = {
  id: string
  role: 'user' | 'assistant'
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
    /** `filter` is the tag the pane shows ('' for all). */
    bookmarks: { list: Bookmark[]; filter: string }
  }
}
