# How FarLink works

This is the map for someone about to change the code. It covers the shape of
the extension, and then the handful of parts that look wrong until you know
why they are like that.

## The shape

Two pieces, and the boundary between them is about what each is allowed to do.

**The content script** (`entrypoints/farlink.content/`) is where everything
happens. It reads the page, owns the panel, and handles keys. It is injected on
demand and lives until the tab navigates.

**The service worker** (`entrypoints/background.ts`) does only the things a
content script cannot: inject the script, open tabs, hold the selection
checkpoint across a navigation, report what the toggle command is actually bound
to, and open Chrome's own shortcut editor. Chrome kills it after about 30 seconds
idle, so it is never the authority on anything.

Inside the content script:

- `lib/dom/` turns the page into a tree of nodes with roles, accessible names
  and link targets. `tree.ts` is the entry point.
- `lib/nav/session.ts` is a plain state machine holding the index, the
  selection, the filter and the mode. It has no idea a DOM exists beyond the
  nodes handed to it.
- `lib/nav/keymap.ts` translates key events into calls on the session.
- `lib/ui/hud.ts` subscribes to a small projection of the session and draws it.

The session pushes a projection; the UI never reaches back into the session.
That is what keeps the panel replaceable.

## The one way in

The manifest declares no `host_permissions` and no
`optional_host_permissions`.
That is the single most important constraint in the project, and a lot follows
from it.

The user presses `Ctrl+Shift+Space` or clicks the toolbar button. Chrome grants
`activeTab` for that one invocation, the worker injects the content script, and
from then on the script is live in that tab until it navigates away.

The cost is real: there is no way to have the panel open on page load, and no
single key can summon it, because a key that worked before the first invocation
would need a script running on every page.
once on that page, and there is no way to have the panel open automatically on
page load. Both were judged cheaper than an install prompt that says "read and
change all your data on all websites".

There used to be a second path, where you granted a specific origin and a
`document_start` script was registered for it. It is gone. It half worked in a
way that was invisible from outside, since a granted permission with a missing
registration looks exactly like a broken key, and it bought only the first
keypress of a page visit.

A build hook deletes the `host_permissions` key that WXT infers from the
content script's `matches`. Without it, the entry reappears.

## The panel is vanilla DOM

The panel is built by hand in a closed shadow root with a randomized host tag.
No React, no framework, no CSS-in-JS. There is no UI framework anywhere in
the project: the extension has no runtime dependencies at all.

Two reasons. Parsing a UI framework on the injection path costs more than the
whole rest of the work put together. And a closed shadow root with a random tag
name is the only way to be confident that the page cannot style, read or script
the panel.

Rows are pooled and only the visible window is rendered, so a page with several
thousand links costs the same as one with thirty.

`lib/ui/hud-css.ts` holds the stylesheet as one template literal. A backtick
anywhere inside it ends the string and produces a syntax error a hundred lines
from its cause. This happened four times. There is now a test.

## The parts that look wrong

**Nothing scrolls the page unless you asked.** The panel covers part of the
viewport, so a selected link can be behind it. `lib/occlusion.ts` treats the
visible area as the viewport minus the panel, as a rectangle intersection
rather than a bottom inset, because the panel is in a corner and most of the
page beside it is perfectly visible. Moving the selection reveals the element;
typing a filter does not, because the selection jumps on every keystroke and
revealing each one is a scroll storm. The page's scroll position is recorded
when the panel opens and restored if you close it without opening anything.

**Titles match fuzzily, addresses match as substrings.** Scoring both fuzzily
meant `post` matched `p`, `o`, `s`, `t` scattered through
`example.com/docs/install`. Both are scored on one scale rather than in tiers,
because tiering put scattered title matches above exact address matches: on
Hacker News, filtering for `item` showed eight rows of `itsallaboutthebit.com`
above every `/item?id=`.

**The selection is not centered.** The visible window scrolls only when the
selection comes within three rows of an edge, the way an editor does. Centring
keeps the highlight still and slides the list past it, so pressing Down moves
everything except the thing you are pointing at.

**Nothing happens at `document_start` except adding listeners.** Reading
settings and asking the worker for a checkpoint both used to happen there, and
the second one woke the service worker just to fetch a value that is null unless
FarLink was open on that tab before. Both now wait for the first open.

**Letter chords match `event.code`.** On macOS, Option is how you type an
alternate character, so it rewrites `event.key`: `Option+T` is `†` and
`Option+S` is `ß`. Matching on `event.key` meant both chords silently never
fired. `event.code` is the physical key, which is the right question for a
chord, and it also makes chords work on non-Latin layouts.

**AltGr is Ctrl+Alt, except on macOS.** Windows and Linux report AltGr that
way, and it is indistinguishable from a real Ctrl+Alt chord. It matters here
because `\` is an AltGr combination on German,
Spanish, French, Italian and Hungarian layouts. Chrome on macOS reports
`AltGraph` for Option as well, so believing it there would make every Option
chord bail out. `lib/platform.ts` has both traps.

**Record detection is almost invisible, deliberately.** `lib/dom/records.ts`
scores groups of repeated elements. Nothing draws a record as such, and the
score is not shown — but it is not invisible either, and it is not dead code:

- the panel picks its opening root from the largest record set, which is why
  GitHub opens on the repository list rather than on a row of filter dropdowns;
- a group scoring below `RECORD_CONFIDENT` marks its rows `uncertain`, which
  `lib/ui/column.ts` turns into `.fl-row-uncertain` and `lib/ui/hud-css.ts`
  renders italic at 0.75 opacity.

Both are load-bearing. This paragraph used to open "Record detection has no
visible output", which invited deleting the second chain outright. It is still
the obvious thing to challenge.

## Testing

Unit tests sit next to their module. Tests that span modules live in `test/`.

A few tests are unusual and worth knowing about, because they exist to catch
classes of mistake rather than specific bugs:

- `lib/ui/hud-css.test.ts` reads its own source to prove the stylesheet
  literal contains no stray backtick.
- `lib/ui/themes.test.ts` scans the stylesheet for `--fl-*` and fails on any
  palette color nothing reads. Three orphaned colors once survived in every
  theme for three weeks.
- `test/manifest-limits.test.ts` counts the manifest fields the Chrome Web
  Store limits. The name shipped four characters over and would have been
  rejected at upload. The same check runs in the build hook, so `pnpm zip`
  fails rather than producing a package that cannot be uploaded.
- `test/cross-platform.test.ts` holds the facts that are only wrong on a
  machine you do not have: that the font stack reaches a real face on each
  operating system, that every command has a binding outside macOS, and that
  the row height in the layout code still matches the stylesheet.

The house rule is that a test which has never failed is not a guard. Break the
thing it protects and watch it go red before you keep it.

## Known weak points

- Record boundaries are wrong on multi-row records. On Hacker News the logical
  record is the story row plus its metadata row, and they index as two entries.
- The record scoring weights have never been validated against a corpus.
- Cross-frame navigation is not implemented; iframes are opaque.
- The extension has never been used by anyone but its author. Nothing here has
  been validated against real users, and that is the largest open question by
  a wide margin.
