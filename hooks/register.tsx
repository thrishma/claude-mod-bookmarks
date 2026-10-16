import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement, RenderSurface } from 'claude-code'

import type { Bookmark } from '../types'

const PANE = 'bookmarks'
const TITLE = 'Bookmarks'
// A slim sidebar on the right of the fullscreen transcript; the person's own drag still wins.
const OPEN = { id: PANE, title: TITLE, columns: 44 } as const
const STORE_KEY = 'list'
const MAX = 500
const PALETTE = ['yellow', 'cyan', 'magenta', 'green', 'blue', 'red'] as const
const SHOWN = 50
const list = atom({ plugin: 'bookmarks', key: 'list' } as const, [])
const filter = atom({ plugin: 'bookmarks', key: 'filter' } as const, '')

// Slash-command records and engine reminders show up as user rows; they are not something to bookmark.
const isBookmarkable = (text: string) => {
  const t = text.trim()
  return t !== '' && !t.startsWith('<command-') && !t.startsWith('<local-command') && !t.startsWith('<system-reminder>')
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

// The screen shows rendered markdown, the transcript holds the source: compare letters and digits only.
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

const clip = (text: string, max: number) => {
  const flat = oneLine(text)
  return flat.length > max ? `${flat.slice(0, Math.max(1, max - 1))}…` : flat
}

const ago = (now: number, then: number) => {
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

// Tags live in the note as #words, so `/bm -- #gotcha why` and `/bm-tag` share one source.
const tagsOf = (b: Bookmark) => [...new Set((b.note.match(/#[\p{L}\p{N}_-]+/gu) ?? []).map(t => t.toLowerCase()))]

const toTags = (words: string) =>
  words
    .split(/[\s,]+/)
    .map(w => w.replace(/^#+/, '').toLowerCase())
    .filter(w => /^[\p{L}\p{N}_-]+$/u.test(w))
    .map(w => `#${w}`)

// A bookmark saved before colors existed gets a stable one from its id.
const colorOf = (b: Bookmark) => {
  if (b.color !== undefined) return b.color
  let n = 0
  for (const ch of b.id) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[n % PALETTE.length] ?? 'yellow'
}

const nextColor = (all: readonly Bookmark[]) => PALETTE[all.length % PALETTE.length] ?? 'yellow'

const save = async ($: EngineInterface, fn: (all: Bookmark[]) => Bookmark[]) => {
  const next = await update($, list, all => fn(all ?? []).slice(-MAX))
  await $.store.set(STORE_KEY, next)
  return next
}

/**
 * `/bm` → what you highlighted with the mouse, else Claude's last reply. `/bm me` → your last prompt.
 * `/bm <words>` → the most recent message (either side) containing those words.
 * Anything after ` -- ` becomes a note on the bookmark.
 */
const pick = async ($: EngineInterface, args: string) => {
  const [query = '', note = ''] = args.split(/(?:^|\s+)--(?:\s+|$)/, 2).map(s => s.trim())
  const rows = (await $.session.messages()).filter(m => isBookmarkable(m.text))
  const q = query.toLowerCase()

  if (q === '') {
    // A surface that cannot report a selection should not break plain /bm.
    const selected = await $.ui.selection().catch(() => undefined)
    if (selected && selected.text.trim() !== '') {
      const key = squash(selected.text)
      const source = key === '' ? undefined : rows.findLast(m => squash(m.text).includes(key))
      return {
        found: { role: source?.role ?? 'assistant', text: selected.text.trim() },
        rowId: selected.requestId,
        note,
        query,
        isSelection: true,
      }
    }
  }

  const found =
    q === ''
      ? rows.findLast(m => m.role === 'assistant')
      : q === 'me'
        ? rows.findLast(m => m.role === 'user')
        : rows.findLast(m => m.text.toLowerCase().includes(q))

  return { found, rowId: undefined, note, query, isSelection: false }
}

// A bookmark marks a transcript row when it was made from that row, or when one text holds the other.
const marks = (b: Bookmark, rowId: string, rowKey: string) => {
  if (b.rowId !== undefined) return b.rowId === rowId
  const key = squash(b.text)
  return key.length >= 12 && rowKey.length >= 12 && (key.includes(rowKey) || rowKey.includes(key))
}

// What each pane button asks Claude to do with a bookmark.
const ASKS = {
  explain: {
    label: 'Explain',
    ask: 'Explain it further: go deeper, give an example, and say what I should take away from it.',
  },
  tldr: {
    label: 'TL;DR',
    ask: 'Give me the TL;DR: at most 3 short bullets, the point first. No preamble.',
  },
  code: {
    label: 'In code',
    ask: 'Show me where this lives in the code. Read the repo (do not guess) and point me to the exact places as file:line, one line each on why it matters. If it is not about this codebase, say so.',
  },
  verify: {
    label: 'Verify',
    ask: 'Verify this before I rely on it. Check each claim against the actual code, docs or state, and say which hold, which do not and which you could not check, with the evidence. Do not change anything.',
  },
  remember: {
    label: 'Remember',
    ask: 'Save the durable lesson in this to your persistent memory, following your memory instructions: check for an existing memory to update first, and include the why and how to apply. If it only matters to this conversation, tell me that instead of saving it.',
  },
} as const

type Ask = keyof typeof ASKS

const askPrompt = (b: Bookmark, kind: Ask) => {
  const who = b.role === 'assistant' ? 'you (Claude) said' : 'I wrote'
  const note = b.note ? `\n\nMy note on it: ${b.note}` : ''
  return `I bookmarked something ${who} earlier. ${ASKS[kind].ask}\n\n<bookmark>\n${b.text}\n</bookmark>${note}`
}

// The star on each message: ★ when bookmarked, ☆ revealed on hover otherwise; a click toggles it.
const star = async (
  $: EngineInterface,
  { Box, Text, Button }: Elements[RenderSurface],
  e: { requestId: string },
  role: Bookmark['role'],
  text: string,
  drawn: RenderElement,
) => {
  const all = await read($, list)
  const rowKey = squash(text)
  const mark = all.find(b => marks(b, e.requestId, rowKey))
  const isMarked = mark !== undefined
  const color = mark ? colorOf(mark) : undefined
  const toggle = async () => {
    if (isMarked) {
      await save($, bs => bs.filter(b => !marks(b, e.requestId, rowKey)))
      $.ui.toast('Bookmark removed')
      return
    }
    const now = await $.clock.now()
    const bookmark: Bookmark = {
      id: `${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      role,
      text,
      note: '',
      cwd: await $.session.cwd(),
      savedAt: now,
      rowId: e.requestId,
      color: nextColor(all),
    }
    await save($, bs => [...bs, bookmark])
    void $.ui.open(OPEN)
    $.ui.toast(`Bookmarked ${role === 'assistant' ? "Claude's" : 'your'} message`)
  }

  return (
    <Box
      key={`row-${e.requestId}`}
      flexDirection="column"
      {...(color ? { borderStyle: 'round', borderColor: color } : {})}
    >
      {drawn}
      <Box
        position="absolute"
        top={isMarked ? -1 : 0}
        right={isMarked ? 1 : 0}
        {...(isMarked ? {} : { display: 'none', hover: { display: 'flex' } })}
      >
        <Button key={`star-${e.requestId}`} plain onPress={toggle}>
          <Text color={color} dimColor={!isMarked}>
            {isMarked ? '★' : '☆'}
          </Text>
        </Button>
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const held = await read($, list)
    if (held.length === 0) {
      const stored = await $.store.get(STORE_KEY)
      if (Array.isArray(stored) && stored.length > 0) await update($, list, () => stored as Bookmark[])
    }

    await $.command.register({
      name: 'bm',
      description: 'Bookmark the text you highlighted, else Claude\'s last reply ("me" = your last prompt, words = search, "-- note" adds a note)',
      immediate: true,
      argumentHint: '[me | words] [-- note]',
    })
    await $.command.register({ name: 'bookmarks', description: 'Open the bookmarks side pane' })
    await $.command.register({
      name: 'bm-tag',
      description: 'Tag your newest bookmark (e.g. /bm-tag gotcha decision)',
      argumentHint: '<tag> [tag…]',
      immediate: true,
    })

    return next(e)
  })

  on('command.run', { command: 'bm' }, async ($, e) => {
    const { found, rowId, note, query, isSelection } = await pick($, e.args)
    if (!found) {
      return { text: query ? `No message found matching "${query}".` : 'Nothing to bookmark yet.' }
    }

    const now = await $.clock.now()
    const bookmark: Bookmark = {
      id: `${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      role: found.role,
      text: found.text,
      note,
      cwd: await $.session.cwd(),
      savedAt: now,
      ...(rowId ? { rowId } : {}),
      color: nextColor(await read($, list)),
    }
    await save($, all => [...all, bookmark])
    void $.ui.open(OPEN)
    $.ui.toast(isSelection ? 'Bookmarked your selection' : `Bookmarked ${found.role === 'assistant' ? "Claude's" : 'your'} message`)

    return { text: `Bookmarked: "${clip(found.text, 80)}"` }
  })

  on('command.run', { command: 'bm-tag' }, async ($, e) => {
    const tags = toTags(e.args)
    if (tags.length === 0) return { text: 'Usage: /bm-tag <tag> [tag…], e.g. /bm-tag gotcha' }
    const all = await read($, list)
    const newest = all.at(-1)
    if (!newest) return { text: 'No bookmarks to tag yet.' }

    const added = tags.filter(t => !tagsOf(newest).includes(t))
    await save($, bs => bs.map(b => (b.id === newest.id ? { ...b, note: [b.note, ...added].join(' ').trim() } : b)))

    return { text: `Tagged "${clip(newest.text, 50)}" ${tags.join(' ')}` }
  })

  on('command.run', { command: 'bookmarks' }, async $ => {
    await $.ui.open(OPEN)

    return { text: 'Bookmarks pane opened.' }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    if (!isBookmarkable(e.props.text)) return drawn
    return star($, $.ui.resolve(e), e, 'assistant', e.props.text, drawn)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.origin.kind !== 'composer' || !isBookmarkable(e.props.text)) return drawn
    return star($, $.ui.resolve(e), e, 'user', e.props.text, drawn)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, list)
    const active = await read($, filter)
    const cols = Math.max(20, (e.props.bodyColumns ?? e.viewport?.columns ?? 40) - 4)
    const here = await $.session.cwd()
    const now = await $.clock.now()

    if (all.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No bookmarks yet.</Text>
          <Text dimColor>Click ☆ on a message, or</Text>
          <Text dimColor>highlight text, then /bm</Text>
          <Text dimColor>/bm — Claude's last reply</Text>
          <Text dimColor>/bm me — your last prompt</Text>
          <Text dimColor>/bm -- #tag note — with a tag</Text>
          <Text dimColor>/bm-tag gotcha — tag the newest</Text>
        </Box>
      )
    }

    const counts = new Map<string, number>()
    for (const b of all) for (const t of tagsOf(b)) counts.set(t, (counts.get(t) ?? 0) + 1)
    const tags = [...counts.keys()].sort()
    const current = tags.includes(active) ? active : ''
    const matching = current === '' ? all : all.filter(b => tagsOf(b).includes(current))
    const shown = [...matching].reverse().slice(0, SHOWN)
    const pickFilter = (tag: string) => update($, filter, () => tag)

    return (
      <Box flexDirection="column">
        {tags.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginBottom={1}>
            <Button key="filter-all" plain onPress={() => pickFilter('')}>
              <Text bold={current === ''} color={current === '' ? 'cyan' : undefined} dimColor={current !== ''}>
                All {all.length}
              </Text>
            </Button>
            {tags.map(t => (
              <Button key={`filter-${t}`} plain onPress={() => pickFilter(t)}>
                <Text bold={current === t} color={current === t ? 'cyan' : undefined} dimColor={current !== t}>
                  {t} {counts.get(t) ?? 0}
                </Text>
              </Button>
            ))}
          </Box>
        )}
        {shown.map(b => (
          <Box key={b.id} flexDirection="column" borderStyle="round" borderColor={colorOf(b)} paddingX={1}>
            <Text bold color={colorOf(b)}>
              {b.role === 'assistant' ? '◆ Claude' : '● You'}
              <Text dimColor>
                {' '}· {ago(now, b.savedAt)}
                {b.cwd !== here ? ` · ${b.cwd.split('/').pop()}` : ''}
              </Text>
            </Text>
            <Text>{clip(b.text, cols * 2)}</Text>
            {b.note !== '' && <Text dimColor italic>✎ {clip(b.note, cols)}</Text>}
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              {(Object.keys(ASKS) as Ask[]).map(kind => (
                <Button
                  key={`${kind}-${b.id}`}
                  label={ASKS[kind].label}
                  {...(kind === 'explain' ? { variant: 'primary' as const } : {})}
                  onPress={() => void $.prompt.submit({ text: askPrompt(b, kind) })}
                />
              ))}
            </Box>
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              {b.rowId !== undefined && (
                <Button
                  key={`jump-${b.id}`}
                  label="Jump"
                  onPress={async () => {
                    const moved = await $.ui.scroll({ to: { requestId: b.rowId ?? '' } }).catch(() => ({ deny: 'not supported here' }))
                    if ('deny' in moved) $.ui.toast(`Can't jump to that message: ${moved.deny}`)
                  }}
                />
              )}
              <Button
                key={`color-${b.id}`}
                label="Color"
                onPress={async () => {
                  await save($, all =>
                    all.map(x => {
                      if (x.id !== b.id) return x
                      const at = PALETTE.indexOf(colorOf(x) as (typeof PALETTE)[number])
                      return { ...x, color: PALETTE[(at + 1) % PALETTE.length] ?? 'yellow' }
                    }),
                  )
                }}
              />
              <Button
                key={`remove-${b.id}`}
                label="Remove"
                onPress={async () => {
                  await save($, list => list.filter(x => x.id !== b.id))
                }}
              />
            </Box>
          </Box>
        ))}
        {matching.length > shown.length && <Text dimColor>+{matching.length - shown.length} older</Text>}
      </Box>
    )
  })
}
