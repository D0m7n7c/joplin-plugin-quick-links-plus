# Contributing

Thanks for your interest in Quick Links Plus. Please read the scope below before
opening a feature request or pull request — a feature outside it is likely to be
declined regardless of how well it is built, and knowing that up front saves
everyone time.

## Scope

Quick Links Plus does one thing: **help you insert the right link, quickly**,
from the Markdown editor. `@@` links to a note, `@@#` to a heading or inline
anchor, `@@id` inserts a new anchor, and a trailing slash steps one level deeper.
That's the whole plugin, and the search side of it is considered
**feature-complete** — it reaches as far as "find the target, insert the link"
and no further.

## Non-goals

These are deliberate limits, not gaps:

- **Creating or modifying notes.** It links to what exists; it doesn't create,
  rename, or edit.
- **Becoming a knowledge-management system.** No backlink graphs, no
  transclusion, no link previews, no automatic note relationships. This is a
  link inserter, not a second brain.
- **Reproducing Joplin's search.** It adds only what Joplin lacks
  (heading/anchor search); it won't grow into a query engine with operators,
  regex, or saved filters.
- **More hidden modes or settings on a hunch.** Every extra trigger or option
  makes the tool harder to discover and use.

## A test for new ideas

Ask: **does it help insert the right link faster, or is it just more?** Welcome
contributions go for depth — faster, more robust on unusual Markdown, better
documented, bug fixes — not more surface area.

## Bugs and PRs

For bugs, include what you typed, what you expected, what happened, plus your
Joplin version and OS. For code, keep it focused, match the existing style, run
`npm run dist`, and check it in a real Joplin install before opening the PR.
