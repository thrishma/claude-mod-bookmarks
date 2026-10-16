import { expect, mock, test } from 'claude-code/testing'

const MESSAGES = [
  { role: 'user', text: 'What is a monad?', toolUses: [] },
  { role: 'assistant', text: 'A monad is a way to chain computations.', toolUses: [] },
  { role: 'user', text: '<command-name>/bm</command-name>', toolUses: [] },
] as const

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
const PROPS = { title: 'Bookmarks', isFocused: true, bodyColumns: 40, placement: 'dock' } as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`bookmark, explain and remove on ${surface}`, async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: 1_000_000 })
    const submitted: string[] = []
    on('session.messages', () => ({ value: MESSAGES.map(m => ({ ...m, toolUses: [] })) }))
    on('session.cwd', () => ({ value: '/work/demo' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', () => ({ value: undefined }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('prompt.submit', (_$, e) => {
      submitted.push(e.text)
      return { text: e.text }
    })

    await $.session.start({ cwd: '/work/demo', surface, isInteractive: true })

    const mine = await runCommand($, { command: 'bm', args: 'me -- why it matters' })
    expect(JSON.stringify(mine)).toContain('What is a monad?')
    const last = await runCommand($, { command: 'bm', args: '' })
    expect(JSON.stringify(last)).toContain('chain computations')
    const miss = await runCommand($, { command: 'bm', args: 'nonexistent' })
    expect(JSON.stringify(miss)).toContain('No message found')

    const ui = await $.ui.mount({ ...PANE, surface, props: PROPS as never })
    expect(await ui.find({ type: 'Text', text: /chain computations/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /why it matters/ })).toBeDefined()

    // Newest first: Claude's reply is the top bookmark.
    const explains = await ui.findAll({ type: 'Button', text: /Explain/ })
    expect(explains).toHaveLength(2)
    await ui.press({ key: String(explains[0]?.key) })
    expect(submitted.at(-1)).toContain('A monad is a way to chain computations.')

    const colors = await ui.findAll({ type: 'Button', text: /Color/ })
    expect(colors).toHaveLength(2)
    await ui.press({ key: String(colors[0]?.key) })
    expect(await ui.find({ type: 'Text', text: /chain computations/ })).toBeDefined()

    const removes = await ui.findAll({ type: 'Button', text: /Remove/ })
    await ui.press({ key: String(removes[0]?.key) })
    expect(await ui.findAll({ type: 'Button', text: /Remove/ })).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /chain computations/ })).toBeUndefined()
    await ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`bookmark a mouse selection and jump to it on ${surface}`, async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: 1_000_000 })
    const toasts: string[] = []
    on('session.messages', () => ({ value: MESSAGES.map(m => ({ ...m, toolUses: [] })) }))
    on('session.cwd', () => ({ value: '/work/demo' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', (_$, e) => {
      toasts.push(String(e.text))
      return { value: undefined }
    })
    on('ui.selection', () => ({ value: { text: 'What is a  monad', requestId: 'row-1' } }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/work/demo', surface, isInteractive: true })
    const done = await runCommand($, { command: 'bm', args: '' })
    expect(JSON.stringify(done)).toContain('What is a monad')

    const ui = await $.ui.mount({ ...PANE, surface, props: PROPS as never })
    // Matched back to the user's message, so it is labelled as yours.
    expect(await ui.find({ type: 'Text', text: /You/ })).toBeDefined()
    const jump = await ui.find({ type: 'Button', text: /Jump/ })
    expect(jump).toBeDefined()
    // The kit has no transcript to scroll: Jump must say so, not throw.
    await ui.press({ key: String(jump?.key) })
    expect(toasts.at(-1)).toContain("Can't jump")
    await ui.unmount()
  })
}

const REPLY = 'A monad is a way to chain computations, one after another.'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the star on a message toggles its bookmark on ${surface}`, async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: 1_000_000 })
    on('session.cwd', () => ({ value: '/work/demo' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', () => ({ value: undefined }))
    // The engine's own drawing of the row, which the star sits beside.
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.text}</Text>
    })

    const ui = await $.ui.mount({
      plugin: 'bookmarks',
      surface,
      component: 'AssistantMessage',
      requestId: 'msg-1',
      props: { text: REPLY, isFirstOfReply: true },
    })
    expect(await ui.find({ type: 'Text', text: REPLY })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '☆' })).toBeDefined()

    await ui.press({ key: 'star-msg-1' })
    expect(await ui.find({ type: 'Text', text: '★' })).toBeDefined()

    const pane = await $.ui.mount({ ...PANE, surface, props: PROPS as never })
    expect(await pane.find({ type: 'Text', text: /chain computations/ })).toBeDefined()
    expect(await pane.find({ type: 'Button', text: /Jump/ })).toBeDefined()

    await ui.press({ key: 'star-msg-1' })
    expect(await ui.find({ type: 'Text', text: '☆' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /No bookmarks yet/ })).toBeDefined()
    await pane.unmount()
    await ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`tags filter the pane and each ask button sends its prompt on ${surface}`, async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: 1_000_000 })
    const submitted: string[] = []
    on('session.messages', () => ({ value: MESSAGES.map(m => ({ ...m, toolUses: [] })) }))
    on('session.cwd', () => ({ value: '/work/demo' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', () => ({ value: undefined }))
    on('prompt.submit', (_$, e) => {
      submitted.push(e.text)
      return { text: e.text }
    })
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/work/demo', surface, isInteractive: true })

    // A bare "-- note" right after the command name is a note, not a search.
    await runCommand($, { command: 'bm', args: '-- #gotcha careful' })
    await runCommand($, { command: 'bm', args: 'me' })
    const tagged = await runCommand($, { command: 'bm-tag', args: 'decision, #Infra' })
    expect(JSON.stringify(tagged)).toContain('#decision #infra')

    const ui = await $.ui.mount({ ...PANE, surface, props: PROPS as never })
    expect(await ui.find({ type: 'Text', text: /All 2/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Button', text: /TL;DR/ })).toHaveLength(2)

    await ui.press({ key: 'filter-#gotcha' })
    expect(await ui.findAll({ type: 'Button', text: /TL;DR/ })).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /chain computations/ })).toBeDefined()

    for (const [label, words] of [
      ['TL;DR', 'TL;DR'],
      ['In code', 'file:line'],
      ['Verify', 'Verify this'],
      ['Remember', 'persistent memory'],
    ] as const) {
      const button = await ui.find({ type: 'Button', text: new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
      await ui.press({ key: String(button?.key) })
      expect(submitted.at(-1)).toContain(words)
      expect(submitted.at(-1)).toContain('A monad is a way to chain computations.')
    }

    await ui.press({ key: 'filter-all' })
    expect(await ui.findAll({ type: 'Button', text: /TL;DR/ })).toHaveLength(2)
    await ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a tool call can be starred, copied, pinned and asked about with others on ${surface}`, async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: 1_000_000 })
    const submitted: string[] = []
    const copied: string[] = []
    on('session.messages', () => ({ value: MESSAGES.map(m => ({ ...m, toolUses: [] })) }))
    on('session.cwd', () => ({ value: '/work/demo' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', () => ({ value: undefined }))
    on('ui.copy', (_$, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('prompt.submit', (_$, e) => {
      submitted.push(e.text)
      return { text: e.text }
    })
    on('ui.invalidate', () => ({ value: undefined }))
    on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'You are Claude.', scope: 'shared' }] }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('ui.render', { component: 'ToolUse' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.tool}</Text>
    })
    await $.session.start({ cwd: '/work/demo', surface, isInteractive: true })

    // Star a finished Bash call.
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
    expect(await pane.find({ type: 'Text', text: /🔧 Bash/ })).toBeDefined()
    const cards = await pane.findAll({ type: 'Button', text: /Copy$/ })
    expect(cards).toHaveLength(2)

    // Copy on the tool card copies the command, not the output. The newest card is first.
    await pane.press({ key: String(cards[1]?.key) })
    expect(copied.at(-1)).toBe('npm test -- --watch=false')

    // Pin it: the system prompt carries it, after the base section.
    const pinButtons = await pane.findAll({ type: 'Button', text: / Pin$/ })
    await pane.press({ key: String(pinButtons[1]?.key) })
    expect(await pane.find({ type: 'Text', text: /1 pinned/ })).toBeDefined()
    const composed = await $.prompt.compose(composeInput(surface))
    expect(composed.sections.map(x => x.id)).toEqual(['base', 'bookmarks:pins'])
    expect(composed.sections[1]?.text).toContain('npm test -- --watch=false')
    expect(composed.sections[1]?.scope).toBe('session')

    // Select both and ask how they connect.
    const boxes = await pane.findAll({ type: 'Button', text: '☐' })
    for (const box of boxes) await pane.press({ key: String(box.key) })
    expect(await pane.find({ type: 'Text', text: /2 selected/ })).toBeDefined()
    await pane.press({ key: 'group-connect' })
    expect(submitted.at(-1)).toContain('How do these relate?')
    expect(submitted.at(-1)).toContain('TypeError: cannot read properties')
    expect(submitted.at(-1)).toContain('A monad is a way to chain computations.')
    expect(await pane.find({ type: 'Text', text: /selected/ })).toBeUndefined()

    // Unpinned, it leaves the system prompt.
    await pane.press({ key: String((await pane.find({ type: 'Button', text: /Unpin$/ }))?.key) })
    const after = await $.prompt.compose(composeInput(surface))
    expect(after.sections.map(x => x.id)).toEqual(['base'])

    await pane.unmount()
    await row.unmount()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`emoji can be turned off on ${surface}`, { options: { emoji: false } }, async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: 1_000_000 })
    on('session.messages', () => ({ value: MESSAGES.map(m => ({ ...m, toolUses: [] })) }))
    on('session.cwd', () => ({ value: '/work/demo' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', () => ({ value: undefined }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/work/demo', surface, isInteractive: true })
    await runCommand($, { command: 'bm', args: '-- #gotcha' })

    const pane = await $.ui.mount({ ...PANE, surface, props: PROPS as never })
    expect(await pane.find({ type: 'Button', text: 'Explain' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /◆ Claude/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /🐛|🤖|📚/ })).toBeUndefined()
    await pane.unmount()
  })

  test(`emoji show by default on ${surface}`, async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: 1_000_000 })
    on('session.messages', () => ({ value: MESSAGES.map(m => ({ ...m, toolUses: [] })) }))
    on('session.cwd', () => ({ value: '/work/demo' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', () => ({ value: undefined }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/work/demo', surface, isInteractive: true })
    await runCommand($, { command: 'bm', args: '-- #gotcha' })

    const pane = await $.ui.mount({ ...PANE, surface, props: PROPS as never })
    expect(await pane.find({ type: 'Button', text: '💡 Explain' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /🤖 Claude/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /🐛 #gotcha 1/ })).toBeDefined()
    await pane.unmount()
  })
}
