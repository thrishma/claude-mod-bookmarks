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
const selected = atom({ plugin: 'bookmarks', key: 'selected' } as const, [])
const expanded = atom({ plugin: 'bookmarks', key: 'expanded' } as const, '')
const PREVIEW_LINES = 3
// What pinned bookmarks may add to the system prompt, in all and each.
const PIN_BUDGET = 12_000
const PIN_EACH = 3_000
const TOOL_TEXT = 8_000

// Slash-command records and engine reminders show up as user rows; they are not something to bookmark.
const isBookmarkable = (text: string) => {
  const t = text.trim()
  return t !== '' && !t.startsWith('<command-') && !t.startsWith('<local-command') && !t.startsWith('<system-reminder>')
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

// The screen shows rendered markdown, the transcript holds the source: compare letters and digits only.
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

// Word-wraps into at most `max` lines of `width`, the last ending in … when text is left over.
const wrapLines = (text: string, width: number, max: number) => {
  const lines: string[] = []
  let line = ''
  for (const word of oneLine(text).split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= width) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = word.length > width ? word.slice(0, width) : word
    if (lines.length === max) break
  }
  if (line && lines.length < max) lines.push(line)
  const isCut = lines.join(' ').length < oneLine(text).length
  if (isCut && lines.length > 0) {
    const last = lines.length - 1
    lines[last] = `${(lines[last] ?? '').slice(0, Math.max(0, width - 1))}…`
  }
  return lines.slice(0, max)
}

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

const whoOf = (b: Bookmark) =>
  b.role === 'assistant' ? 'you (Claude) said' : b.role === 'tool' ? `a ${b.tool ?? 'tool'} call produced` : 'I wrote'

// Emoji that draw as emoji without a variation selector, so terminals give them a steady two cells.
const ROLE_EMOJI = { assistant: '🤖', user: '🙋', tool: '🔧' } as const

const TAG_EMOJI: Readonly<Record<string, string>> = {
  '#gotcha': '🐛',
  '#bug': '🐞',
  '#decision': '🧭',
  '#todo': '📝',
  '#idea': '💡',
  '#question': '❓',
  '#learn': '🎓',
  '#perf': '🚀',
  '#security': '🔒',
  '#fix': '🩹',
}

// `fun` is the emoji setting: the plain glyphs stand in when it is off.
const show = (fun: boolean, emoji: string, text: string) => (fun ? `${emoji} ${text}` : text)

const labelOf = (b: Bookmark, fun: boolean) => {
  const name = b.role === 'assistant' ? 'Claude' : b.role === 'tool' ? (b.tool ?? 'Tool') : 'You'
  if (fun) return `${ROLE_EMOJI[b.role]} ${name}`
  return `${b.role === 'assistant' ? '◆' : b.role === 'tool' ? '▸' : '●'} ${name}`
}

const tagLabel = (fun: boolean, tag: string) => (fun && TAG_EMOJI[tag] ? `${TAG_EMOJI[tag]} ${tag}` : tag)

const askPrompt = (b: Bookmark, kind: Ask) => {
  const note = b.note ? `\n\nMy note on it: ${b.note}` : ''
  return `I bookmarked something ${whoOf(b)} earlier. ${ASKS[kind].ask}\n\n<bookmark>\n${b.text}\n</bookmark>${note}`
}

// What the selection bar asks Claude to do with several bookmarks at once.
const GROUP_ASKS = {
  connect: {
    label: 'Connect',
    ask: 'How do these relate? Find the common thread, anything that contradicts, and what they add up to.',
  },
  checklist: {
    label: 'Checklist',
    ask: 'Turn these into a concrete, ordered checklist I can act on. Mark anything you would verify first.',
  },
  note: {
    label: 'Design note',
    ask: 'Write a short design note from these, in markdown: context, the decisions and why, and open questions.',
  },
} as const

type GroupAsk = keyof typeof GROUP_ASKS

const groupPrompt = (bs: readonly Bookmark[], kind: GroupAsk) => {
  const items = bs
    .map((b, i) => {
      const note = b.note ? `\nMy note: ${b.note}` : ''
      return `<bookmark n="${i + 1}" from="${whoOf(b)}">\n${b.text}${note}\n</bookmark>`
    })
    .join('\n\n')
  return `I bookmarked ${bs.length} things from our conversations. ${GROUP_ASKS[kind].ask}\n\n${items}`
}

// Copy takes a tool's command, else the first code block, else the whole text.
const copyTextOf = (b: Bookmark) => {
  if (b.copy) return b.copy
  const fence = b.text.match(/```[^\n]*\n([\s\S]*?)```/)
  return fence?.[1]?.replace(/\n$/, '') ?? b.text
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const asText = (value: unknown) => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  const r = asRecord(value)
  const parts = [r.stdout, r.stderr, r.content, r.text, r.output].filter((v): v is string => typeof v === 'string' && v !== '')
  if (parts.length > 0) return parts.join('\n')
  return JSON.stringify(value, null, 2) ?? ''
}

// A tool row as one bookmark: what was called, then what came back.
const toolBookmark = (tool: string, input: unknown, output: unknown) => {
  const i = asRecord(input)
  const what = [i.command, i.file_path, i.pattern, i.url, i.query, i.description].find(
    (v): v is string => typeof v === 'string' && v !== '',
  )
  const call = what ?? clip(JSON.stringify(input) ?? '', 300)
  const result = asText(output)
  const text = `${tool}: ${call}${result ? `\n\n${result}` : ''}`
  return {
    text: text.length > TOOL_TEXT ? `${text.slice(0, TOOL_TEXT)}\n… (cut)` : text,
    copy: typeof i.command === 'string' ? i.command : typeof i.file_path === 'string' ? i.file_path : undefined,
  }
}

// The system prompt section that keeps this project's pins in Claude's context.
const pinnedSection = async ($: EngineInterface) => {
  const here = await $.session.cwd()
  const pins = (await read($, list)).filter(b => b.pinned && b.cwd === here)
  if (pins.length === 0) return undefined

  let left = PIN_BUDGET
  const items: string[] = []
  for (const b of pins) {
    const body = b.text.length > PIN_EACH ? `${b.text.slice(0, PIN_EACH)}…` : b.text
    const item = `<pinned from="${whoOf(b)}"${b.note ? ` note="${oneLine(b.note).replace(/"/g, "'")}"` : ''}>\n${body}\n</pinned>`
    if (item.length > left) break
    left -= item.length
    items.push(item)
  }
  const cut = pins.length - items.length
  return [
    '# Pinned by the user',
    'The user pinned these from the conversation so they stay in your context, through compaction too. Treat them as standing notes the user chose to keep: decisions, constraints and facts to honor. Text you wrote earlier may since have gone stale; check before relying on it.',
    ...items,
    ...(cut > 0 ? [`(${cut} more pinned bookmark${cut === 1 ? '' : 's'} did not fit.)`] : []),
  ].join('\n\n')
}

// The star on each message: ★ when bookmarked, ☆ revealed on hover otherwise; a click toggles it.
const star = async (
  $: EngineInterface,
  { Box, Text, Button }: Elements[RenderSurface],
  e: { requestId: string },
  role: Bookmark['role'],
  text: string,
  drawn: RenderElement,
  tool: { name: string; copy: string | undefined } | undefined,
  fun: boolean,
) => {
  const all = await read($, list)
  const rowKey = squash(text)
  const mark = all.find(b => marks(b, e.requestId, rowKey))
  const isMarked = mark !== undefined
  const color = mark ? colorOf(mark) : undefined
  const toggle = async () => {
    if (isMarked) {
      await save($, bs => bs.filter(b => !marks(b, e.requestId, rowKey)))
      $.ui.toast(show(fun, '💨', 'Bookmark removed'))
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
      ...(tool ? { tool: tool.name } : {}),
      ...(tool?.copy ? { copy: tool.copy } : {}),
    }
    await save($, bs => [...bs, bookmark])
    void $.ui.open(OPEN)
    $.ui.toast(show(fun, '⭐', tool ? `Bookmarked the ${tool.name} call` : `Bookmarked ${role === 'assistant' ? "Claude's" : 'your'} message`))
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

export const register: Register = (on, options) => {
  const fun = options.emoji !== false

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
    $.ui.toast(show(fun, '⭐', isSelection ? 'Bookmarked your selection' : `Bookmarked ${found.role === 'assistant' ? "Claude's" : 'your'} message`))

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
    return star($, $.ui.resolve(e), e, 'assistant', e.props.text, drawn, undefined, fun)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.origin.kind !== 'composer' || !isBookmarkable(e.props.text)) return drawn
    return star($, $.ui.resolve(e), e, 'user', e.props.text, drawn, undefined, fun)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const drawn = await next(e)
    if (e.props.isRunning) return drawn
    const made = toolBookmark(e.props.tool, e.props.input, e.props.output)
    return star($, $.ui.resolve(e), e, 'tool', made.text, drawn, { name: e.props.tool, copy: made.copy }, fun)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const text = await pinnedSection($)
    if (text === undefined) return composed
    return { sections: [...composed.sections, { id: 'bookmarks:pins', text, scope: 'session' as const }] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, list)
    const active = await read($, filter)
    const picked = await read($, selected)
    const open = await read($, expanded)
    const width = Math.max(20, (e.props.bodyColumns ?? e.viewport?.columns ?? 40) - 3)
    const here = await $.session.cwd()
    const now = await $.clock.now()

    if (all.length === 0) {
      return (
        <Box flexDirection="column" rowGap={1}>
          <Text bold>{show(fun, '✨', 'No bookmarks yet')}</Text>
          <Box flexDirection="column">
            <Text dimColor>Hover a message or tool call and click ☆,</Text>
            <Text dimColor>or highlight text and type /bm.</Text>
          </Box>
          <Box flexDirection="column">
            <Text dimColor>/bm          Claude's last reply</Text>
            <Text dimColor>/bm me       your last message</Text>
            <Text dimColor>/bm -- #tag  with a tag or note</Text>
            <Text dimColor>/bm-tag tag  tag the newest</Text>
          </Box>
        </Box>
      )
    }

    const counts = new Map<string, number>()
    for (const b of all) for (const t of tagsOf(b)) counts.set(t, (counts.get(t) ?? 0) + 1)
    const tags = [...counts.keys()].sort()
    const current = tags.includes(active) ? active : ''
    const matching = current === '' ? all : all.filter(b => tagsOf(b).includes(current))
    const shown = [...matching].reverse().slice(0, SHOWN)
    const openId = shown.some(b => b.id === open) ? open : (shown[0]?.id ?? '')
    const chosen = all.filter(b => picked.includes(b.id))
    const pins = all.filter(b => b.pinned && b.cwd === here).length
    const pickFilter = (tag: string) => update($, filter, () => tag)
    const toggleOne = (id: string) =>
      update($, selected, ids => ((ids ?? []).includes(id) ? (ids ?? []).filter(x => x !== id) : [...(ids ?? []), id]))

    const summary = [`${all.length} bookmark${all.length === 1 ? '' : 's'}`, ...(pins > 0 ? [`${pins} pinned here`] : [])].join(' · ')

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          <Text dimColor>{summary}</Text>
          {tags.length > 0 && (
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              <Button key="filter-all" plain onPress={() => pickFilter('')}>
                <Text bold={current === ''} underline={current === ''} dimColor={current !== ''}>
                  All
                </Text>
              </Button>
              {tags.map(t => (
                <Button key={`filter-${t}`} plain onPress={() => pickFilter(t)}>
                  <Text bold={current === t} underline={current === t} dimColor={current !== t}>
                    {tagLabel(fun, t)} {counts.get(t) ?? 0}
                  </Text>
                </Button>
              ))}
            </Box>
          )}
        </Box>

        {chosen.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            <Text bold color="cyan">
              {chosen.length} selected
            </Text>
            {(Object.keys(GROUP_ASKS) as GroupAsk[]).map(kind => (
              <Button
                key={`group-${kind}`}
                plain
                onPress={async () => {
                  await $.prompt.submit({ text: groupPrompt(chosen, kind) })
                  await update($, selected, () => [])
                }}
              >
                <Text color="cyan">{GROUP_ASKS[kind].label}</Text>
              </Button>
            ))}
            <Button key="group-clear" plain onPress={() => update($, selected, () => [])}>
              <Text dimColor>Clear</Text>
            </Button>
          </Box>
        )}

        {shown.map(b => {
          const color = colorOf(b)
          const isPicked = picked.includes(b.id)
          const isOpen = b.id === openId
          const lines = wrapLines(b.text, width, isOpen ? PREVIEW_LINES * 2 : PREVIEW_LINES)
          const meta = [
            ago(now, b.savedAt),
            ...(b.cwd !== here ? [b.cwd.split('/').pop() ?? ''] : []),
            ...(b.pinned ? [fun ? '📌' : 'pinned'] : []),
          ].join(' · ')
          const bar = (key: string, body: RenderElement) => (
            <Box key={key} flexDirection="row">
              <Text color={color}>▎</Text>
              {body}
            </Box>
          )

          // The whole card (header, text, note) opens it.
          const openCard = () => update($, expanded, () => b.id)

          // One labelled row of actions, the card's bar running down beside it: `Ask  Explain · TL;DR · …`.
          const actionRow = (
            key: string,
            label: string,
            items: {
              key: string
              label: string
              tone: 'lead' | 'plain' | 'danger'
              onPress: (press: { surface: RenderSurface }) => unknown
            }[],
          ) => (
            <Box key={key} flexDirection="row">
              <Text color={color}>▎</Text>
              <Box width={5} flexShrink={0}>
                <Text dimColor>{label}</Text>
              </Box>
              <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                {items.flatMap((item, i) => [
                  ...(i > 0 ? [<Text key={`${item.key}-sep`} dimColor>·</Text>] : []),
                  <Button key={item.key} plain onPress={item.onPress}>
                    <Text
                      bold={item.tone === 'lead'}
                      color={item.tone === 'lead' ? color : item.tone === 'danger' ? 'red' : undefined}
                    >
                      {item.label}
                    </Text>
                  </Button>,
                ])}
              </Box>
            </Box>
          )

          return (
            <Box key={b.id} flexDirection="column">
              <Box flexDirection="row" justifyContent="space-between">
                <Box flexDirection="row">
                  <Text color={color}>▎</Text>
                  <Button key={`open-${b.id}`} plain onPress={openCard}>
                    <Text dimColor>{isOpen ? '▾ ' : '▸ '}</Text>
                    <Text bold color={color}>
                      {labelOf(b, fun)}
                    </Text>
                    <Text dimColor> {meta}</Text>
                  </Button>
                </Box>
                <Button key={`pick-${b.id}`} plain onPress={() => toggleOne(b.id)}>
                  <Text color={isPicked ? 'cyan' : undefined} dimColor={!isPicked}>
                    {isPicked ? '☑' : '☐'}
                  </Text>
                </Button>
              </Box>
              {lines.map((line, i) =>
                bar(
                  `line-${b.id}-${i}`,
                  <Button key={`open-${b.id}-${i}`} plain onPress={openCard}>
                    <Text wrap="truncate-end">{line}</Text>
                  </Button>,
                ),
              )}
              {b.note !== '' &&
                bar(
                  `note-${b.id}`,
                  <Button key={`open-${b.id}-note`} plain onPress={openCard}>
                    <Text dimColor italic wrap="truncate-end">
                      {tagsOf(b).reduce((text, t) => text.replace(t, tagLabel(fun, t)), b.note)}
                    </Text>
                  </Button>,
                )}
              {isOpen && (
                <Box flexDirection="column">
                  {actionRow(
                    `ask-${b.id}`,
                    'Ask',
                    (Object.keys(ASKS) as Ask[]).map(kind => ({
                      key: `${kind}-${b.id}`,
                      label: ASKS[kind].label,
                      tone: kind === 'explain' ? ('lead' as const) : ('plain' as const),
                      onPress: () => void $.prompt.submit({ text: askPrompt(b, kind) }),
                    })),
                  )}
                  {actionRow(`card-${b.id}`, 'Card', [
                    {
                      key: `pin-${b.id}`,
                      label: b.pinned ? 'Unpin' : 'Pin',
                      tone: 'plain' as const,
                      onPress: async () => {
                        await save($, all => all.map(x => (x.id === b.id ? { ...x, pinned: !x.pinned } : x)))
                        $.ui.invalidate('prompt.section')
                        $.ui.toast(show(fun, '📌', b.pinned ? 'Unpinned' : 'Pinned: Claude keeps it in context in this project'))
                      },
                    },
                    {
                      key: `copy-${b.id}`,
                      label: 'Copy',
                      tone: 'plain' as const,
                      onPress: async (press: { surface: RenderSurface }) => {
                        const done = await $.ui.copy({ text: copyTextOf(b), surface: press.surface })
                        $.ui.toast(done.isCopied ? show(fun, '📋', 'Copied') : `Couldn't copy: ${done.reason}`)
                      },
                    },
                    ...(b.rowId !== undefined
                      ? [
                          {
                            key: `jump-${b.id}`,
                            label: 'Jump',
                            tone: 'plain' as const,
                            onPress: async () => {
                              const moved = await $.ui
                                .scroll({ to: { requestId: b.rowId ?? '' } })
                                .catch(() => ({ deny: 'not supported here' }))
                              if ('deny' in moved) $.ui.toast(`Can't jump to that message: ${moved.deny}`)
                            },
                          },
                        ]
                      : []),
                    {
                      key: `color-${b.id}`,
                      label: 'Color',
                      tone: 'plain' as const,
                      onPress: async () => {
                        await save($, all =>
                          all.map(x => {
                            if (x.id !== b.id) return x
                            const at = PALETTE.indexOf(colorOf(x) as (typeof PALETTE)[number])
                            return { ...x, color: PALETTE[(at + 1) % PALETTE.length] ?? 'yellow' }
                          }),
                        )
                      },
                    },
                    {
                      key: `remove-${b.id}`,
                      label: 'Remove',
                      tone: 'danger' as const,
                      onPress: async () => {
                        await save($, list => list.filter(x => x.id !== b.id))
                        await update($, selected, ids => (ids ?? []).filter(x => x !== b.id))
                        if (b.pinned) $.ui.invalidate('prompt.section')
                      },
                    },
                  ])}
                </Box>
              )}
            </Box>
          )
        })}
        {matching.length > shown.length && <Text dimColor>+{matching.length - shown.length} older</Text>}
      </Box>
    )
  })
}
