# Quick Links Plus for Joplin

A reworked take on the *Quick Links* idea: link to notes, headings and anchors
straight from the Markdown editor, generate stable anchor ids, and copy a link to
any heading or anchor directly from the rendered note.

> **About this plugin.** Quick Links Plus was developed end-to-end with
> Anthropic's Claude Opus 4.8. There is no active human maintainer behind it — it
> was built to solve a personal need and is shared as-is, without warranty.
> Contributions and maintainers are very welcome: if you'd like to improve or
> take over the project, please open an issue or pull request.

> Works in the **CodeMirror 6 Markdown editor** (current Joplin). The legacy
> CodeMirror 5 editor and the Rich Text (WYSIWYG) editor are not supported.

## Features

### Editor autocompletions

| Trigger | What it does | Inserts |
| --- | --- | --- |
| `@@<text>` | Find a note by title. Results are sorted by title relevance (exact match, then prefix, then contains); with no text, the most recently edited notes are shown first. | `[Title](:/<noteId>)` |
| `@@#<text>` | Find a **heading or inline anchor** across all notes. Results are grouped by note (the section header shows *Note › Notebook*) and sorted by match quality. Each row shows the target on the left and its position within the note on the right (the ancestor heading path, nearest heading first, middle elided when long). Typing a **note title** lists all of that note's targets. Anchors are prefixed with `#`. | `[Text](:/<noteId>#<anchor>)` |
| `@@id` | Insert a fresh, note-unique anchor. The popup previews the exact element to be inserted. | `<a id="ab12cd"></a>` |

Generated ids start with a letter followed by lower-case letters/digits, and are
checked for uniqueness against the current note (including unsaved edits and
heading slugs). The length is configurable (default 6).

### Viewer copy marks

In the rendered note a small `§` mark appears next to every heading and inline
anchor. It is hidden until you hover the line (then light gray), turns dark when
you point at it, and on click copies a Joplin link to that target and shows
`Copied!` (duration configurable). For anchors the link text is taken from the
text preceding the anchor. Marks are hidden in print/PDF export.

## Settings

Found under *Options -> Quick Links Plus*:

- **Select link text after inserting** - selects the `[link text]` after insertion so you can retype it.
- **Show notebook name** - shows the notebook next to note results (`@@`) and in the section header of heading/anchor results (`@@#`). On by default.
- **Enable heading / anchor search (`@@#`)**.
- **Enable anchor id generator (`@@id`)**.
- **Show copy marks (`§`) in the viewer**.

Under Joplin's **Advanced** settings toggle (click *Show Advanced Settings* in the
config screen):

- **Anchor id length** - characters in `@@id` ids (default 6).
- **"Copied!" message duration** - how long the confirmation stays visible, in milliseconds (default 900).

## Building

```bash
npm install
npm run dist
```

This produces an installable archive at `publish/com.quicklinksplus.plugin.jpl`.
Install it via *Options -> Plugins -> Install from file*.

## Notes & limitations

- Heading links rely on Joplin's slug algorithm. The slug generated here matches
  Joplin for typical headings (letters, numbers, spaces, common punctuation);
  very unusual characters may differ.
- `@@#` searches note bodies via Joplin search, so only the most relevant notes
  are scanned for performance.

## Credits

- Based on **[Quick Links](https://github.com/roman-r-m/joplin-plugin-quick-links)**
  by Roman Musin (`roman-r-m`) — the original `@@` note-linking plugin and the
  template for the editor autocompletion. (MIT)
- The viewer copy mechanism was informed by
  **[Copy Anchor Link](https://github.com/hieuthi/joplin-plugin-copy-anchor-link)**
  by Hieu-Thi Luong (`hieuthi`) — copying via the plugin main process. (MIT)

## License

MIT — see [LICENSE.md](LICENSE.md). As a fork of the MIT-licensed *Quick Links*
plugin, the license retains the original copyright alongside the new one.
