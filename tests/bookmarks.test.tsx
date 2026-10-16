import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const MESSAGES = [
  { role: 'user', text: 'What is a monad?', toolUses: [] },
  { role: 'assistant', text: 'A monad is a way to chain computations.', toolUses: [] },
  { role: 'user', text: '<command-name>/bm</command-name>', toolUses: [] },
] as const

const SURFACES = ['terminal', 'desktop'] as const

// The engine stamps origin and presentation on a real run; the kit fills them in.
const runCommand = ($: { command: { run: (e: never) => Promise<unknown> } }, e: { command: string; args: string }) =>
  $.command.run(e as never)

const composeInput = (surface: 'terminal' | 'desktop') => ({
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: [surface],
  tools: [],
  outputStyle: null,
  traits: [],
})

const PANE = { plugin: 'bookmarks', component: 'Pane', requestId: 'bookmarks' } as const
// Wide enough that each test bookmark's text sits on one line.
const PROPS = { title: 'Bookmarks', isFocused: true, bodyColumns: 72, placement: 'dock' } as const

/** What sits beneath the plugin in every test: the session, the clock, and what was sent or shown. */
const world = (
  on: On,
  selection?: { text: string; requestId: string },
  messages: readonly { role: 'user' | 'assistant'; text: string }[] = MESSAGES,
) => {
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  const seen = { submitted: [] as string[], toasts: [] as string[], copied: [] as string[] }
  on('session.messages', () => ({ value: messages.map(m => ({ ...m, toolUses: [] })) }))
  on('session.cwd', () => ({ value: '/work/demo' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    seen.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('ui.copy', (_$, e) => {
    seen.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  if (selection) on('ui.selection', () => ({ value: selection }))
  on('prompt.submit', (_$, e) => {
    seen.submitted.push(e.text)
    return { text: e.text }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'You are Claude.', scope: 'shared' }] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  return seen
}

for (const surface of SURFACES) {
  test(`bookmark from commands, open a card, explain and remove on ${surface}`, async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: '/work/demo', surface, isInteractive: true })

    expect(JSON.stringify(await runCommand($, { command: 'bm', args: 'me -- why it matters' }))).toContain('What is a monad?')
    expect(JSON.stringify(await runCommand($, { command: 'bm', args: '' }))).toContain('chain computations')
    expect(JSON.stringify(await runCommand($, { command: 'bm', args: 'nonexistent' }))).toContain('No message found')

    const ui = await $.ui.mount({ ...PANE, surface, props: PROPS as never })
    expect(await ui.find({ type: 'Text', text: /2 bookmarks/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /chain computations/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /why it matters/ })).toBeDefined()

    // Only the newest card shows its actions.
    expect(await ui.findAll({ type: 'Button', text: 'Explain' })).toHaveLength(1)
    await ui.press({ key: String((await ui.find({ type: 'Button', text: 'Explain' }))?.key) })
    expect(seen.submitted.at(-1)).toContain('A monad is a way to chain computations.')

    // Opening the other card moves the actions there.
    const headers = await ui.findAll({ type: 'Button', text: /You/ })
    await ui.press({ key: String(headers[0]?.key) })
    await ui.press({ key: String((await ui.find({ type: 'Button', text: 'Explain' }))?.key) })
    expect(seen.submitted.at(-1)).toContain('What is a monad?')

    await ui.press({ key: String((await ui.find({ type: 'Button', text: '✕' }))?.key) })
    expect(await ui.find({ type: 'Text', text: /1 bookmark$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /why it matters/ })).toBeUndefined()
    await ui.unmount()
  })

  test(`bookmark a mouse selection and jump to it on ${surface}`, async ($, on) => {
    const seen = world(on, { text: 'What is a  monad', requestId: 'row-1' })
    await $.session.start({ cwd: '/work/demo', surface, isInteractive: true })
    expect(JSON.stringify(await runCommand($, { command: 'bm', args: '' }))).toContain('What is a monad')

    const ui = await $.ui.mount({ ...PANE, surface, props: PROPS as never })
    // Matched back to the user's message, so it is labelled as yours.
    expect(await ui.find({ type: 'Text', text: /You/ })).toBeDefined()
    // The kit has no transcript to scroll: Jump must say so, not throw.
    await ui.press({ key: String((await ui.find({ type: 'Button', text: 'Jump' }))?.key) })
    expect(seen.toasts.at(-1)).toContain("Can't jump")
    await ui.unmount()
  })

  test(`the star on a message toggles its bookmark on ${surface}`, async ($, on) => {
    world(on)
    const reply = 'A monad is a way to chain computations, one after another.'
    // The engine's own drawing of the row, which the star sits beside.
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.text}</Text>
    })

    const row = await $.ui.mount({
      plugin: 'bookmarks',
      surface,
      component: 'AssistantMessage',
      requestId: 'msg-1',
      props: { text: reply, isFirstOfReply: true },
    })
    expect(await row.find({ type: 'Text', text: reply })).toBeDefined()
    expect(await row.find({ type: 'Text', text: '☆' })).toBeDefined()

    await row.press({ key: 'star-msg-1' })
    expect(await row.find({ type: 'Text', text: '★' })).toBeDefined()

    const pane = await $.ui.mount({ ...PANE, surface, props: PROPS as never })
    expect(await pane.find({ type: 'Text', text: /chain computations/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', text: 'Jump' })).toBeDefined()

    await row.press({ key: 'star-msg-1' })
    expect(await row.find({ type: 'Text', text: '☆' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /No bookmarks yet/ })).toBeDefined()
    await pane.unmount()
    await row.unmount()
  })

  test(`tags filter the pane and each ask sends its prompt on ${surface}`, async ($, on) => {
    const seen = world(on)
    await $.session.start({ cwd: '/work/demo', surface, isInteractive: true })

    // A bare "-- note" right after the command name is a note, not a search.
    await runCommand($, { command: 'bm', args: '-- #gotcha careful' })
    await runCommand($, { command: 'bm', args: 'me' })
    expect(JSON.stringify(await runCommand($, { command: 'bm-tag', args: 'decision, #Infra' }))).toContain('#decision #infra')

    const ui = await $.ui.mount({ ...PANE, surface, props: PROPS as never })
    expect(await ui.find({ type: 'Text', text: /monad\?/ })).toBeDefined()

    await ui.press({ key: 'filter-#gotcha' })
    expect(await ui.find({ type: 'Text', text: /chain computations/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /monad\?/ })).toBeUndefined()

    for (const [label, words] of [
      ['TL;DR', 'TL;DR'],
      ['In code', 'file:line'],
      ['Verify', 'Verify this'],
      ['Remember', 'persistent memory'],
    ] as const) {
      await ui.press({ key: String((await ui.find({ type: 'Button', text: label }))?.key) })
      expect(seen.submitted.at(-1)).toContain(words)
      expect(seen.submitted.at(-1)).toContain('A monad is a way to chain computations.')
    }

    await ui.press({ key: 'filter-all' })
    expect(await ui.find({ type: 'Text', text: /monad\?/ })).toBeDefined()
    await ui.unmount()
  })

  test(`a tool call can be starred, copied, pinned and asked about with others on ${surface}`, async ($, on) => {
    const seen = world(on)
    on('ui.render', { component: 'ToolUse' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.tool}</Text>
    })
    await $.session.start({ cwd: '/work/demo', surface, isInteractive: true })

    const row = await $.ui.mount({
      plugin: 'bookmarks',
      surface,
      component: 'ToolUse',
      requestId: 'tool-1',
      props: {
        tool_use_id: 'tool-1',
        tool: 'Bash',
        input: { command: 'npm test -- --watch=false' },
        isRunning: false,
        isErrored: true,
        isInterrupted: false,
        output: { stdout: '', stderr: 'TypeError: cannot read properties of undefined' },
      } as never,
    })
    await row.press({ key: 'star-tool-1' })
    expect(await row.find({ type: 'Text', text: '★' })).toBeDefined()
    await runCommand($, { command: 'bm', args: '' })

    const pane = await $.ui.mount({ ...PANE, surface, props: PROPS as never })
    expect(await pane.find({ type: 'Text', text: /Bash/ })).toBeDefined()

    // Open the tool card: Copy takes its command, not the output.
    await pane.press({ key: String((await pane.find({ type: 'Button', text: /Bash/ }))?.key) })
    await pane.press({ key: String((await pane.find({ type: 'Button', text: 'Copy' }))?.key) })
    expect(seen.copied.at(-1)).toBe('npm test -- --watch=false')

    // Pin it: the system prompt carries it, after the base section.
    await pane.press({ key: String((await pane.find({ type: 'Button', text: 'Pin' }))?.key) })
    expect(await pane.find({ type: 'Text', text: /1 pinned here/ })).toBeDefined()
    const composed = await $.prompt.compose(composeInput(surface))
    expect(composed.sections.map(x => x.id)).toEqual(['base', 'bookmarks:pins'])
    expect(composed.sections[1]?.text).toContain('npm test -- --watch=false')
    expect(composed.sections[1]?.scope).toBe('session')

    // Select both and ask how they connect.
    for (const box of await pane.findAll({ type: 'Button', text: '☐' })) await pane.press({ key: String(box.key) })
    expect(await pane.find({ type: 'Text', text: /2 selected/ })).toBeDefined()
    await pane.press({ key: 'group-connect' })
    expect(seen.submitted.at(-1)).toContain('How do these relate?')
    expect(seen.submitted.at(-1)).toContain('TypeError: cannot read properties')
    expect(seen.submitted.at(-1)).toContain('A monad is a way to chain computations.')
    expect(await pane.find({ type: 'Text', text: /selected/ })).toBeUndefined()

    // Unpinned, it leaves the system prompt.
    await pane.press({ key: String((await pane.find({ type: 'Button', text: 'Unpin' }))?.key) })
    const after = await $.prompt.compose(composeInput(surface))
    expect(after.sections.map(x => x.id)).toEqual(['base'])

    await pane.unmount()
    await row.unmount()
  })

  test(`buttons stay plain words, and emoji mark only roles and tags on ${surface}`, async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/work/demo', surface, isInteractive: true })
    await runCommand($, { command: 'bm', args: '-- #gotcha' })

    const pane = await $.ui.mount({ ...PANE, surface, props: PROPS as never })
    expect(await pane.find({ type: 'Button', text: 'Explain' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /🤖 Claude/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /🐛 #gotcha 1/ })).toBeDefined()
    await pane.unmount()
  })

  test(`emoji can be turned off on ${surface}`, { options: { emoji: false } }, async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/work/demo', surface, isInteractive: true })
    await runCommand($, { command: 'bm', args: '-- #gotcha' })

    const pane = await $.ui.mount({ ...PANE, surface, props: PROPS as never })
    expect(await pane.find({ type: 'Text', text: /◆ Claude/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', text: '✕' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /🐛|🤖/ })).toBeUndefined()
    await pane.unmount()
  })
}

test('long text wraps beside the bar and ends in … when cut', async ($, on) => {
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
  world(on, undefined, [{ role: 'assistant', text: long }])
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await runCommand($, { command: 'bm', args: '' })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PROPS, bodyColumns: 30 } as never })
  const lines = await pane.findAll({ type: 'Text', text: /^word/ })
  expect(lines.length).toBe(6)
  expect(lines.at(-1)?.text).toMatch(/…$/)
  await pane.unmount()
})

test('the open card labels its two rows of actions and separates them', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await runCommand($, { command: 'bm', args: '' })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS as never })
  expect(await pane.find({ type: 'Text', text: 'Ask' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Card' })).toBeDefined()
  // Five asks and four card actions (no Jump without a row): 4 + 3 separators.
  expect(await pane.findAll({ type: 'Text', text: '·' })).toHaveLength(7)
  await pane.unmount()
})

test('a ▾ marks the open card and a ▸ each closed one', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await runCommand($, { command: 'bm', args: 'me' })
  await runCommand($, { command: 'bm', args: '' })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS as never })
  expect(await pane.findAll({ type: 'Text', text: '▾ ' })).toHaveLength(1)
  expect(await pane.findAll({ type: 'Text', text: '▸ ' })).toHaveLength(1)
  await pane.unmount()
})

test('clicking a closed card\'s text opens it', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await runCommand($, { command: 'bm', args: 'me' })
  await runCommand($, { command: 'bm', args: '' })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS as never })
  const line = await pane.find({ type: 'Button', text: /What is a monad\?/ })
  await pane.press({ key: String(line?.key) })
  await pane.press({ key: String((await pane.find({ type: 'Button', text: 'Explain' }))?.key) })
  expect(seen.submitted.at(-1)).toContain('What is a monad?')
  await pane.unmount()
})
