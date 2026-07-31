# Contributing to FarLink

Thanks for looking. FarLink is small and opinionated, and the fastest way to
have a good time here is to know which of those opinions are load-bearing.

## Getting set up

You need Node 20 or newer and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev      # launches Chrome with the extension loaded
```

Before you open a pull request:

```bash
pnpm check    # format, markdown lint, typecheck, tests. This is what CI runs.
```

If formatting is the only complaint, `pnpm format` fixes it. Prose is linted
separately by `pnpm lint:md`, because `.prettierignore` keeps Prettier away
from `docs/`, `store/` and `README.md`: it reflows markdown tables into single
unreadable lines.

## Where things live

```text
entrypoints/
  farlink.content/   the content script: key handling, panel lifecycle
  background.ts      the service worker: injection, tabs, checkpoints
lib/
  dom/               reading the page: roles, accessible names, the tree
  nav/               the state machine: session, keymap, actions, anchoring
  ui/                the panel: hud, column, stylesheet, themes, palettes
  platform.ts        the things that differ per operating system
  settings.ts        storage
manifest.ts          the manifest, and the store's limits on it
scripts/             icon, gallery and probe generators
store/               listing copy, privacy policy, screenshots
test/                tests that span modules; unit tests sit beside their code
```

[docs/architecture.md](docs/architecture.md) is the longer version, including
why several awkward-looking things are the way they are.

## Things that are decided

These are not up for casual change. If you think one is wrong, open an issue
first and make the case; a pull request that quietly reverses one will be
closed with an apology.

**No host permissions, required or optional.** `host_permissions` is empty and
a build hook keeps it that way, `optional_host_permissions` is absent, and
nothing calls `permissions.request()`. There is exactly one way into a page: the
command or the toolbar button, both `activeTab`. Anything that needs a script
running before the user asks for one needs a different design, not a wider
manifest.

**No letter is bound to movement.** Arrows move; any printable character starts
filtering. A list you search beats a list you steer, and binding the alphabet
makes searching impossible.

**There is no UI framework, and no runtime dependencies.** The panel is
vanilla DOM in a closed shadow root; the performance budget does not survive a
framework on the injection path. React and Tailwind were here for an options
page that no longer exists, and they left with it. Adding either back needs a
better reason than convenience.

**Match letter chords on `event.code`, not `event.key`.** On macOS, Option
rewrites `event.key`; `Option+T` arrives as `†`. This has already broken every
Option chord once. `lib/platform.ts` has the helper; use it.

**Chrome and Edge only.** Both are Chromium and MV3, and the two builds are
byte-identical apart from the output directory. Firefox is not supported and
the `-b firefox` script was removed rather than left as a trap: WXT builds MV2
for Firefox, which has no `scripting` API, no `chrome.storage.session` and no
`chrome.action`, all three of which this extension uses. The build succeeds and
the artifact cannot run. Supporting Firefox is a real port, not a flag.

**The extension never touches the network or the clipboard.** If a change would
introduce either, it needs to be discussed first, and it changes the privacy
policy and the store listing.

## Conventions

**Formatting** is Prettier with the config in `.prettierrc.mjs`: double quotes,
no semicolons, no trailing commas, 80 columns. Imports are sorted by a plugin.
Do not hand-format; run `pnpm format`.

**Comments explain why, not what.** The code says what it does. A comment
earns its place by recording a decision, a measurement, or a trap that is not
visible from the code. Several comments in this repo cite the bug that made
them necessary; that is the standard.

**Tests are the argument.** A test that has never failed is not a guard. If you
add one, break the thing it protects and watch it go red before you keep it.

## Adding a theme

This is the easiest way in, and the one place the code was built to be extended
by someone who has not read the rest of it.

Append one entry to `FLAVORS` in `lib/ui/palettes.ts`. Nothing else needs
touching: there is no per-flavour branching anywhere, and `flavorVariables()`
turns each palette key into a `--fl-*` custom property by iteration, so a
colour becomes a CSS variable without any CSS.

```ts
{
  id: "kebab-case-id",
  name: "Display Name",
  scheme: "dark",        // or "light"; drives prefers-color-scheme
  palette: { /* all 11 keys */ }
}
```

Three things will check your work before a human does. TypeScript names any
palette key you left out. The contrast suite in `lib/ui/themes.test.ts` loops
`FLAVORS`, so your flavour is tested the moment it exists, with no test to
write. And a separate test asserts that a flavour is still nothing but those
four fields, so the two claims above stay true.

Two standards are worth knowing before you start, because both are easier to
meet up front than to retrofit:

**Cite the colours.** Palettes here name their source — a file in another
project, a hardware colour table, a published scheme — and mark any value that
was chosen rather than sourced. Read the `far` entry for the shape of it. A
palette assembled by eye is fine, but say so.

**WCAG AA wins over fidelity.** `fg`, `dim` and `warn` each owe 4.5:1 against
both backgrounds, and the cursor row and accent chip owe it against their own
text. Three of the flavours already deviate from their source schemes to clear
this. If a faithful port fails, bend the port; the test is not negotiable and
the deviation belongs in a comment.

Run `pnpm gallery` to render every flavour into `.scratch/gallery.html` and
look at yours next to the others.

## Git

**Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org).**

```text
fix(platform): match letter chords on event.code

Option rewrites event.key on macOS, so Option+T arrived as "†" and both
Alt chords silently never fired. event.code is the physical key, which is
the right question for a chord anyway.
```

The prefix is `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`,
`ci` or `chore`. A scope in brackets is optional and is usually a directory:
`fix(ui)`, `feat(nav)`. Subject in the imperative, under about 72 characters,
no full stop.

The prefix is not bureaucracy here: `CHANGELOG.md` is Keep a Changelog, and
`feat` and `fix` map onto its Added and Fixed sections, so a release stops
being an exercise in remembering what happened. `BREAKING CHANGE:` in the
footer for anything that changes a key binding, a setting name or a storage
key.

**The body is where the why goes**, and it matters more than the prefix. If a
commit fixes a bug, say what the bug did. If it reverses an earlier decision,
say which one. The comments in this codebase cite the bugs that caused them;
commits should do the same.

**Branch off `main`, short-lived, named for the change**: `fix/option-chords`,
`feat/panel-corners`. No long-running branches. `main` is always releasable
and never force-pushed.

**Pull requests are squash-merged.** The squash subject becomes the
Conventional Commit, so you do not need to keep your own history tidy. Rewrite
freely on your branch until it is merged.

**No CLA and no DCO.** MIT covers it. By opening a pull request you are
licensing your contribution under the same terms.

### Releases

Versions are [semver](https://semver.org), set in `package.json`. WXT derives
the manifest from it.

1. Update `CHANGELOG.md`: move `Unreleased` into a new version heading.
2. Bump `version` in `package.json`.
3. Merge, then tag `v0.2.0` on `main`.
4. `pnpm zip`, and upload `build/farlink-<version>-chrome.zip`.

One trap worth knowing. Chrome's `version` must be one to four dot-separated
integers, so a semver prerelease cannot go in it. WXT handles this by putting
`0.2.0` in `version` and the full `0.2.0-beta.1` in `version_name`, which is
the right split. But it means **a beta and its final release carry the same
number as far as Chrome's updater is concerned**. If you publish a beta, the
release that follows it needs its own version, not the same one without the
suffix.

## Pull requests

Small ones. One idea per pull request.

Say what changed and why. If it is a bug fix, say how to reproduce the bug.
If it is a behaviour change, say what the old behaviour was and who might miss
it. If you touched anything users see, a before and after screenshot is worth
more than a paragraph.

Everything in `pnpm check` has to pass. New behaviour needs a test.

Expect review to be slow and detailed rather than fast and approving. That is
not a judgement on your work.

## Reporting a bug

Use the issue template. What matters most:

- the page it happened on, if you can share it
- your operating system, Chrome version, and keyboard layout
- what you expected and what happened instead

Keyboard layout sounds irrelevant and is not. A surprising share of bugs here
have been layout specific.

## Reporting a security issue

Do not open a public issue. [SECURITY.md](SECURITY.md) has the process.

## Ideas and feedback

Open a discussion or an issue. Feedback that this is not useful, and why, is
genuinely more valuable right now than a feature request; the extension has not
been validated with real users yet.

Note that the list of features deliberately removed is long: grouping, marks,
batch actions, link hints, yank, a command palette, per-site permissions. Each
was built, used, and cut. Suggesting one is fine, but the bar is "here is what
changed since it was cut".

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
