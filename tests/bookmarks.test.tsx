import { expect, mock, test } from 'claude-code/testing'

const MESSAGES = [
  { role: 'user', text: 'What is a monad?', toolUses: [] },
  { role: 'assistant', text: 'A monad is a way to chain computations.', toolUses: [] },
  { role: 'user', text: '<command-name>/bm</command-name>', toolUses: [] },
] as const

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

    const mine = await $.command.run({ command: 'bm', args: 'me -- why it matters' })
    expect(JSON.stringify(mine)).toContain('What is a monad?')
    const last = await $.command.run({ command: 'bm', args: '' })
    expect(JSON.stringify(last)).toContain('chain computations')
    const miss = await $.command.run({ command: 'bm', args: 'nonexistent' })
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
    const done = await $.command.run({ command: 'bm', args: '' })
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
    await $.command.run({ command: 'bm', args: '-- #gotcha careful' })
    await $.command.run({ command: 'bm', args: 'me' })
    const tagged = await $.command.run({ command: 'bm-tag', args: 'decision, #Infra' })
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
      const button = await ui.find({ type: 'Button', text: label })
      await ui.press({ key: String(button?.key) })
      expect(submitted.at(-1)).toContain(words)
      expect(submitted.at(-1)).toContain('A monad is a way to chain computations.')
    }

    await ui.press({ key: 'filter-all' })
    expect(await ui.findAll({ type: 'Button', text: /TL;DR/ })).toHaveLength(2)
    await ui.unmount()
  })
}
