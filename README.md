# Bookmarks for Claude Code

Bookmark anything you or Claude said in a [Claude Code](https://claude.com/claude-code) conversation, keep the bookmarks in a side pane, and **act on them**: ask Claude to explain one further, summarize it, find it in the code, verify it, or save it to Claude's memory.

When Claude gives a long explanation, the useful part is usually a few lines: a gotcha, a decision, a command. This mod lets you mark those lines, find them again later, and turn them into something you keep.

```
╭──────────────────────────────────★─╮     ╭─ Bookmarks ─────────────────────────╮
│ ⏺ The cache misses because both    │     │ All 4 · #gotcha 2 · #decision 1     │
│   keys include the request time…   │     │ ╭─────────────────────────────────╮ │
╰────────────────────────────────────╯     │ │ ◆ Claude · 3m                   │ │
                                           │ │ The cache misses because both…  │ │
                                           │ │ ✎ #gotcha caching               │ │
                                           │ │ [Explain] [TL;DR] [In code]     │ │
                                           │ │ [Verify] [Remember]             │ │
                                           │ │ [Jump] [Color] [Remove]         │ │
                                           │ ╰─────────────────────────────────╯ │
                                           ╰─────────────────────────────────────╯
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install bookmarks --marketplace thrishma/claude-mod-bookmarks
```

Answer `y` to add the marketplace, then press Enter to install for your user. It works immediately, with no restart.

From a shell:

```
claude plugin install bookmarks --marketplace thrishma/claude-mod-bookmarks
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `thrishma/claude-mod-bookmarks`, then **Add plugin**.

## Bookmarking

| How | What gets bookmarked |
| --- | --- |
| Hover a message, click **☆** | That message (Claude's or yours). Click **★** again to remove it. |
| Highlight text with the mouse, then `/bm` | Just the highlighted text |
| `/bm` | Claude's last reply |
| `/bm me` | Your last message |
| `/bm <words>` | The latest message containing those words |
| `… -- #tag a note` | Adds tags and a note, e.g. `/bm -- #gotcha check the cache keys` |
| `/bm-tag gotcha decision` | Tags your newest bookmark (handy after clicking ☆) |
| `/bookmarks` | Opens the pane |

Bookmarked messages get a colored border in the conversation, matching their card in the pane.

## Acting on a bookmark

Each card in the pane has:

- **Explain**: Claude goes deeper, with an example and the takeaway.
- **TL;DR**: at most 3 bullets, the point first.
- **In code**: Claude reads the repo and points to the exact `file:line` places it is about.
- **Verify**: Claude checks each claim against the actual code or state and says which hold, with evidence. It changes nothing.
- **Remember**: Claude saves the lesson to its persistent memory (or tells you it is not worth keeping), so future sessions know it.
- **Jump**: scrolls the conversation back to the message.
- **Color**: cycles the card's and the message's highlight color.
- **Remove**: deletes the bookmark.

Filter chips at the top of the pane (`All · #gotcha · #decision …`) show one tag at a time.

## Good to know

- **Fullscreen mode** is needed for clicking (☆, buttons, chips) and for bookmarking a mouse selection. Outside it, use the commands and the keyboard: `ctrl+x` then `tab` moves into the pane, `Tab` walks its buttons, `Enter` presses, `Esc` returns to the prompt.
- **Where the pane goes:** a sidebar on the right when the terminal is fullscreen and at least 110 columns wide; otherwise above the prompt.
- **Jump** works for bookmarks made with ☆ or from a selection, which remember their message. It cannot scroll to a message the terminal no longer keeps drawn.
- **Storage:** bookmarks stay on your machine in Claude Code's plugin store, across sessions and projects (a card from another project shows its folder name). Nothing is sent anywhere until you press one of the buttons that ask Claude.
- **Early API:** this uses Claude Code's function-hooks API, which is early access and can change between releases. Built and tested on Claude Code 2.1.301.

### How this differs from the VS Code extension's bookmarks

The Claude Code VS Code extension has its own "Bookmark response" button. This mod is for the **terminal** and adds: bookmarking **your own** messages and **partial selections**, bookmarks that **persist across sessions**, **tags and colors**, and the **actions** (Explain, TL;DR, In code, Verify, Remember).

## Developing

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

The hooks module is `hooks/register.tsx`; tests are in `tests/`.
