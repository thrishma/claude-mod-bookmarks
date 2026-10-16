# Bookmarks for Claude Code

Bookmark anything you or Claude said in a [Claude Code](https://claude.com/claude-code) conversation (or a tool call: a diff, a failing command), keep the bookmarks in a side pane, and **act on them**: ask Claude to explain one further, summarize it, find it in the code, verify it, or save it to Claude's memory. **Pin** the ones that matter and Claude keeps them in context, even after `/compact`.

When Claude gives a long explanation, the useful part is usually a few lines: a gotcha, a decision, a command. This mod lets you mark those lines, find them again later, and turn them into something you keep.

```
3 bookmarks · 1 pinned here
All  🐛 #gotcha 2  🧭 #decision 1

▎▾ 🤖 Claude 3m · 📌                       ☐
▎The cache misses because both keys include
▎the request time, so no two requests share…
▎🐛 #gotcha caching
▎Ask   Explain · TL;DR · In code · Verify · Remember
▎Card        Unpin · Copy · Jump · Group · Color · ✕

▎▸ 🙋 You 12m                              ☐
▎Why does the second call miss the cache?
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
| Hover a tool call, click **☆** | The call and what came back: a command and its error, a diff, a file read |
| Highlight text with the mouse, then `/bm` | Just the highlighted text |
| `/bm` | Claude's last reply |
| `/bm me` | Your last message |
| `/bm <words>` | The latest message containing those words |
| `… -- #tag a note` | Adds tags and a note, e.g. `/bm -- #gotcha check the cache keys` |
| `/bm-tag gotcha decision` | Tags your newest bookmark (handy after clicking ☆) |
| `/bm-group Auth refactor` | Puts the ticked bookmarks, or your newest, in a group. No name takes them out. |
| `/bookmarks` | Opens the pane |

Bookmarked messages get a colored border in the conversation, matching their card in the pane.

## Acting on a bookmark

Click anywhere on a card (▸) to open it. The open card (the newest, at first) shows two rows of actions: **Ask** sends the bookmark to Claude, **Card** manages the bookmark itself.

- **Explain**: Claude goes deeper, with an example and the takeaway.
- **TL;DR**: at most 3 bullets, the point first.
- **In code**: Claude reads the repo and points to the exact `file:line` places it is about.
- **Verify**: Claude checks each claim against the actual code or state and says which hold, with evidence. It changes nothing.
- **Remember**: Claude saves the lesson to its persistent memory (or tells you it is not worth keeping), so future sessions know it.
- **Pin**: keeps the bookmark in Claude's system prompt for this project, so it survives `/compact` and long sessions. Use it for decisions and constraints ("we chose X because Y", "never touch table Z"). The pane shows how many are pinned; **Unpin** takes it back out.
- **Copy**: copies a tool call's command (or file path), else the first code block, else the text.
- **Jump**: scrolls the conversation back to the message.
- **Group**: puts the card in a group (see below).
- **Color**: cycles the card's and the message's highlight color.
- **✕** (Remove): deletes the bookmark.

Filter chips at the top of the pane (`All  🐛 #gotcha  🧭 #decision …`) show one tag at a time. Some tags get an emoji: `#gotcha` 🐛, `#bug` 🐞, `#decision` 🧭, `#todo` 📝, `#idea` 💡, `#question` ❓, `#learn` 🎓, `#perf` 🚀, `#security` 🔒, `#fix` 🩹.

### Groups

Put related bookmarks under a heading, like "Auth refactor" or "Gotchas":

- **Card › Group** on an open card opens a dropdown of your groups: pick one with the arrows and Enter. Beneath it, **+ New group** asks for a name (the first group always does), and **Ungroup** takes the card out. On mobile, where there is no dropdown, the groups are buttons.
- **☐** a few cards, then **Group** on the selection line, moves them all at once.
- Click a heading to fold it (▸) or unfold it (▾). **Rename** beside it renames the group for every card in it.
- Cards with no group sit under **Ungrouped** at the bottom. Until you make your first group the pane is a plain list, with no headings.

Groups and tags work together: a card sits in one group, can carry any number of tags, and the tag chips filter inside every group.

```
2 bookmarks · 1 group
▾ Auth refactor  1                    Rename
  ▎▾ 🤖 Claude 2h                          ☐
  ▎Tokens are refreshed in the middleware…

▾ Ungrouped  1
  ▎▸ 🙋 You 1h                             ☐
  ▎Why does the cookie expire after an hour?
```

### Working with several at once

Tick **☐** on a few cards and a line appears at the top of the pane:

- **Group**: moves them into a group.
- **Connect**: how they relate, what contradicts, what they add up to.
- **Checklist**: an ordered checklist you can act on.
- **Design note**: context, decisions and why, open questions, in markdown.

## Good to know

- **Emoji** mark who said what (🤖 Claude, 🙋 You, 🔧 Bash) and some tags; buttons stay plain words. If your terminal draws emoji badly, turn them off with the **Emoji** row for bookmarks in `/config`: the pane falls back to ◆ Claude, ● You, ▸ Bash.
- **Fullscreen mode** is needed for clicking (☆, buttons, chips) and for bookmarking a mouse selection. Outside it, use the commands and the keyboard: `ctrl+x` then `tab` moves into the pane, `Tab` walks its buttons, `Enter` presses, `Esc` returns to the prompt.
- **Where the pane goes:** a sidebar on the right when the terminal is fullscreen and at least 110 columns wide; otherwise above the prompt.
- **Jump** works for bookmarks made with ☆ or from a selection, which remember their message. It cannot scroll to a message the terminal no longer keeps drawn.
- **One answer per button:** while Claude is answering an ask, that button shows dimmed (`Explain…`) and ignores clicks until the answer finishes, or you interrupt it with Esc. Other buttons stay live, and their asks wait in line.
- **Pins cost context:** each pinned bookmark is sent with every request in that project (up to about 12,000 characters in all; past that, the oldest pins that fit are kept and the pane still lists the rest). Pins are per project: a pin made in one folder is not sent in another.
- **Pins need an unmanaged install:** where an organization manages Claude Code, plugins a person installs cannot add to Claude's system prompt, so **Pin** marks the card but Claude does not see it. Everything else works there. An organization that wants pins can list the plugin in its managed settings.
- **Storage:** bookmarks stay on your machine in Claude Code's plugin store, across sessions and projects (a card from another project shows its folder name). Nothing is sent anywhere until you press one of the buttons that ask Claude, or pin one.
- **Early API:** this uses Claude Code's function-hooks API, which is early access and can change between releases. Built and tested on Claude Code 2.1.301.

### How this differs from the VS Code extension's bookmarks

The Claude Code VS Code extension has its own "Bookmark response" button. This mod is for the **terminal** and adds: bookmarking **your own** messages, **tool calls** and **partial selections**, bookmarks that **persist across sessions**, **tags, groups and colors**, **pinning into Claude's context**, asking about **several at once**, and the **actions** (Explain, TL;DR, In code, Verify, Remember).

## Developing

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

The hooks module is `hooks/register.tsx`; tests are in `tests/`.
