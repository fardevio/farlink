# AGENTS.md

Instructions for coding agents working in this repository.

[README.md](README.md) is the product. [CONTRIBUTING.md](CONTRIBUTING.md) is the
long version of the conventions below, and [docs/architecture.md](docs/architecture.md)
explains the parts of the code that look wrong until you know why. Read the
architecture doc before changing anything in `lib/` or `entrypoints/`.

This file is the prescriptive version, plus the things that are only obvious
after you have broken them.

## Setup

Node 20 or newer (`.nvmrc` pins 22) and pnpm 10. The extension has no runtime
dependencies.

```bash
pnpm install
pnpm dev      # Chrome with the extension loaded, hot reloading
pnpm check    # format:check, lint:md, compile, test. This is what CI runs.
```

`pnpm check` is the gate. A change that does not pass it is not finished. If
only formatting fails, `pnpm format` fixes it.

CI runs `pnpm check`, then builds both targets and asserts they are identical:
`pnpm zip`, `pnpm zip:edge`, `diff -r build/chrome-mv3 build/edge-mv3`. If you
touch `manifest.ts` or the build hook in `wxt.config.ts`, run those three
locally as well.

## Invariants

These are decided. A change that reverses one is wrong even if it works. If you
think one is mistaken, say so and stop; do not route around it.

**No host permissions.** `host_permissions` is empty, `optional_host_permissions`
is absent, and nothing calls `permissions.request()`. There is exactly one way
into a page: the command or the toolbar button, both `activeTab`. Anything that
needs a script running before the user asks for one needs a different design,
not a wider manifest. A build hook in `wxt.config.ts` deletes the
`host_permissions` key WXT infers from the content script's `matches`; without
it the entry reappears in the install prompt.

**No letter is bound to movement.** Arrows move; any printable character starts
filtering. There is no prefix key and no separate search mode. A list you search
beats a list you steer.

**No UI framework and no runtime dependencies.** The panel is vanilla DOM in a
closed shadow root with a randomised host tag. `package.json` has no
`dependencies` block. The performance budget does not survive a framework on the
injection path, and a closed root with a random tag is what keeps the page from
styling, reading or scripting the panel.

**Letter chords match `event.code`, not `event.key`.** On macOS Option rewrites
`event.key`, so `Option+T` arrives as `†`. Use the helpers in `lib/platform.ts`.
This has silently broken every Option chord once already.

**Chrome and Edge only.** Both are Chromium MV3 and the two builds are
byte-identical apart from the output directory. Firefox is a real port, not a
flag: WXT builds MV2 there, which has no `scripting` API, no
`chrome.storage.session` and no `chrome.action`, all three of which this
extension uses. The build succeeds and the artifact cannot run.

**No network and no clipboard.** The extension makes no requests of any kind.
Introducing either changes `store/privacy.md` and the published listing, so it
is a conversation, not a patch.

## Where to look

```text
entrypoints/farlink.content/  content script: key handling, panel lifecycle
entrypoints/background.ts     service worker: injection, tabs, checkpoints
lib/dom/                      reading the page; tree.ts is the entry point
lib/nav/                      session state machine, keymap, actions, anchoring
lib/ui/                       hud, column, stylesheet, themes, palettes
lib/platform.ts               everything that differs per operating system
lib/settings.ts               storage
manifest.ts                   the manifest, and the store's limits on it
scripts/                      icon, gallery, screenshot and probe generators
store/                        listing copy, privacy policy, screenshots
test/                         cross-module tests; unit tests sit beside the code
```

| Task                        | Start at                                                    |
| --------------------------- | ----------------------------------------------------------- |
| Add a theme                 | `lib/ui/palettes.ts` — one entry in `FLAVORS`, nothing else |
| Change a key binding        | `lib/nav/keymap.ts`, then `lib/platform.ts`                 |
| Change what the panel lists | `lib/dom/tree.ts`                                           |
| Change how filtering ranks  | `lib/nav/fuzzy.ts`                                          |
| Change how the panel looks  | `lib/ui/hud-css.ts`                                         |
| Change the manifest         | `manifest.ts`, then `wxt.config.ts`                         |

## Traps

Every one of these has already cost someone real time.

**`lib/ui/hud-css.ts` is one template literal.** A stray backtick inside it ends
the string and produces a syntax error a hundred lines from its cause. This
happened four times. `lib/ui/hud-css.test.ts` now reads its own source to catch
it.

**Vitest only collects tests under `test/` and `lib/`.** A test file written
anywhere else, `entrypoints/` included, is silently never run. The `include`
patterns are in `vitest.config.ts`.

**happy-dom does not lay out.** Every `getBoundingClientRect()` returns zeroes,
so every geometric heuristic sees an empty page. Tests declare geometry
explicitly with `data-rect="x,y,w,h"`, read through the injected `rectOf` seam
that production uses. `test/harness.ts` has the helpers.

**Prettier does not touch `docs/`, `store/` or `README.md`.** `.prettierignore`
keeps it out because it reflows markdown tables. Prose there is checked by
`pnpm lint:md` at 80 columns instead, and `pnpm format` will not fix a
markdownlint failure in those files.

**`spikes/` is excluded from `tsconfig.json`, Prettier and markdownlint.** Code
there does not typecheck and is not part of the build. Do not import from it.

**`store/privacy.md` cannot move.** The live Chrome Web Store listing points its
required privacy-policy field at
`https://github.com/fardevio/farlink/blob/main/store/privacy.md`. Renaming or
relocating that file breaks a required field on a published extension.

**Store screenshots are gitignored and regenerated as a set.** `pnpm shots`
drives the real content-script bundle against live pages. Anything that changes
the panel width, the key bar or the row height invalidates all of them; capture
the whole set rather than one.

**A beta and its final release share a version as far as Chrome is concerned.**
Chrome's `version` takes one to four integers, so WXT puts `0.2.0` in `version`
and the full `0.2.0-beta.1` in `version_name`. If you publish a beta, the
release after it needs its own number.

## Style

Formatting is Prettier with `.prettierrc.mjs`: double quotes, no semicolons, no
trailing commas, 80 columns, imports sorted by a plugin. Do not hand-format; run
`pnpm format`.

TypeScript is strict, plus `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noUnusedLocals` and `noUnusedParameters`. `pnpm compile` is `tsc --noEmit`. Do
not reach for `any` or a non-null assertion to get past a checker complaint;
narrow the type instead.

Follow the surrounding code. Keep diffs minimal: every changed line should trace
to the task you were given. Do not improve adjacent code, reformat untouched
lines, or refactor things that are not broken. If you notice unrelated dead
code, mention it rather than deleting it. Do remove imports and locals that your
own change orphaned.

Prefer the boring version. No abstraction for a single caller, no configurability
nobody asked for, no error handling for states that cannot occur. If you wrote
two hundred lines and it could be fifty, write the fifty.

## Comments

Comments explain why, not what. The code already says what it does. A comment
earns its place by recording a decision, a measurement, or a trap that is not
visible from the code. Several comments here name the bug that made them
necessary; that is the standard.

Write for someone reading the file months from now with no access to this
conversation, the diff, or the pull request. Do not narrate change history
("now", "previously", "no longer") unless the earlier design is itself the
explanation, and do not address a reviewer.

## Tests

Unit tests sit beside their module. Tests that span modules live in `test/`.

**A test that has never failed is not a guard.** Break the thing it protects and
watch it go red before you keep it. New behaviour needs a test.

Four suites exist to catch classes of mistake rather than specific bugs. Know
what they cover before you change the code underneath them:

- `lib/ui/hud-css.test.ts` reads its own source to prove the stylesheet literal
  holds no stray backtick.
- `lib/ui/themes.test.ts` checks every flavour for WCAG AA contrast, and fails
  on any palette colour the stylesheet never reads.
- `test/manifest-limits.test.ts` counts the manifest fields the Chrome Web Store
  limits. The same assertion runs in the build hook, so `pnpm zip` fails rather
  than producing a package that cannot be uploaded.
- `test/cross-platform.test.ts` holds the facts that are only wrong on a machine
  you do not have: font stacks, non-macOS bindings, row height against the
  stylesheet.

## Adding a theme

The easiest way in, and the one place built to be extended by someone who has
not read the rest.

Append one entry to `FLAVORS` in `lib/ui/palettes.ts`. Nothing else needs
touching: there is no per-flavour branching anywhere, and `flavorVariables()` in
`lib/ui/themes.ts` turns each palette key into a `--fl-*` custom property by
iteration, so a colour becomes a CSS variable without any CSS.

Two standards, both easier to meet up front than to retrofit. **Cite the
colours**: name the source file, hardware table or published scheme, and mark
any value chosen rather than sourced. **WCAG AA beats fidelity**: if a faithful
port fails contrast, bend the port and say so in a comment. The contrast suite
is not negotiable.

`pnpm gallery` renders every flavour into `.scratch/gallery.html`.

## Commits and pull requests

Conventional Commits, for example
`fix(platform): match letter chords on event.code`. The prefix is one of `feat`,
`fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`; an optional
scope in brackets is usually a directory. Imperative subject, under about 72
characters, no full stop. `feat` and `fix` map onto Keep a Changelog's Added and
Fixed sections in `CHANGELOG.md`, which is why the prefix is not decoration.

**The body is where the why goes.** If a commit fixes a bug, say what the bug
did. If it reverses an earlier decision, say which one. `BREAKING CHANGE:` in
the footer for anything that changes a key binding, a setting name or a storage
key.

Branch off `main`, short-lived, named for the change: `fix/option-chords`,
`feat/panel-corners`. `main` is always releasable and never force-pushed. Pull
requests are squash-merged, so your branch history does not need to be tidy.

Do not open issues or pull requests, or comment on them, unless you were asked
to.

## Things that were removed on purpose

Grouping, marks, batch actions, link hints, yank, a command palette, per-site
permissions. Each was built, used, and cut, and the list is not exhaustive.
Proposing one is fine; adding one back because it looks obviously useful is not.
The bar is "here is what changed since it was cut".

## Before you hand back

- `pnpm check` passes.
- New behaviour has a test, and you watched it fail before it passed.
- `git diff` contains only files you meant to change.
- No new runtime dependency, no widened manifest, no network call.
- Anything users would notice is in `CHANGELOG.md` under `Unreleased`.
