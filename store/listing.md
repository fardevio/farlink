# Chrome Web Store listing

Copy-paste source for the Developer Dashboard. Keep this in sync with the
manifest and the privacy policy; review compares all three.

---

## Name

```text
FarLink — Every link on a page, by keyboard
```

(43 characters; the limit is 45. `test/manifest-limits.test.ts` counts this,
`short_name` and the description on every run. The previous wording was 49 and
would have been rejected at upload.)

## Summary

```text
Every link on a page in one keyboard-driven list. Filter by title or address, then open it here or in a new tab. No mouse.
```

(122 characters; the limit is 132. Identical to the manifest `description`,
which is what the store actually shows under the name.)

## Category

Productivity → Workflow & Planning

## Description

```text
Link hints are great at clicking one link. They are not great at working
through a page.

FarLink opens an index of every link on the page, the title on the left
and the address on the right, and lets you filter it by either. Just
type: there is no prefix key. Arrow keys move, Enter opens the link,
Alt+Enter opens it in a background tab.

The panel is docked to one corner, so most of the page stays visible
beside it, and nothing FarLink does ever scrolls the page out from under
you.

It is honest about the trade: for clicking a single link you have already
spotted, Vimium's hints win. Where FarLink pays off is when you do not know
where the thing is — a page of four hundred links you want to search by
address, and read by destination rather than by position.

WHAT YOU GET

• Every link on the page in one list. Start filtering by typing, matching
  the title or the address
• Arrow keys move; letters are left free for typing, never bound to
  navigation
• Enter to open it, Alt+Enter to open it in a background tab
• Alt and the arrows to put the panel in any corner, Alt+S to resize it
• Alt+comma for settings inside the panel: theme, size and corner, all
  from the keyboard (Option on macOS)
• Nothing ever scrolls the page out from under you
• Thirteen themes on Alt+T: Far Manager, yazi, Catppuccin, Nord, Paper,
  Solarized Light, High Contrast, Mono, Macintosh 1984, Windows XP,
  New Vegas, IBM 3270 and Commodore 64, every one checked for contrast

PERMISSIONS, AND WHY THERE ARE NONE WORTH THE NAME

FarLink asks for no access to any website when you install it. The
install prompt has no site access in it at all.

By default, when you press the shortcut or click the toolbar button, Chrome
grants access to that one tab for that one invocation. That is the "activeTab"
permission, and it is the whole story. The panel then stays available on
that tab until you navigate away, so one key closes and reopens it.

FarLink never asks for access to all sites, or to any site.

PRIVACY

FarLink sends nothing anywhere. There is no server, no analytics, no
telemetry, no account. Page content is read in the tab it came from and
never leaves it. Your settings live in your browser profile.

NOT A REPLACEMENT FOR

Vimium, Surfingkeys and Vimari are excellent and FarLink sits alongside
them. If you already use one, keep it. FarLink is for the tasks where
link hints run out.
```

## Keywords

keyboard navigation, vim, vimium alternative, no mouse, accessibility,
power user, keyboard shortcuts, productivity, file manager, orthodox,
far manager, yazi, link list, filter links, open in background tab

---

## Privacy tab

### Single purpose

> FarLink lists the links on the current web page so they can be reached from
> the keyboard. It reads the page's DOM to collect each link's accessible name
> and destination, shows them in a panel the user can filter by either, and
> opens the selected link, in the same tab or in a new one, when the user
> presses Enter.

### Permission justifications

| Permission                            | Justification                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `activeTab`                           | Grants access to the current tab only when the user invokes the extension — by its keyboard shortcut or by clicking its toolbar button — so navigation can be started on a page without requesting access to any site in advance.                                                                                  |
| `scripting`                           | Injects the extension's own content script into the current tab when the user invokes the shortcut or clicks the toolbar button. This is the only way the panel is ever created; nothing is registered in advance.                                                       |
| `storage`                             | Stores the user's own settings (theme, panel corner and size) and a per-tab anchor so the selected link can be re-found after the page navigates. The anchor holds that one link's address and identifying attributes plus hashes of its name and text; it is session-scoped, replaced on the next selection, and discarded when the tab closes. No page text is stored.                                                                               |
| Host permissions                      | None. The extension declares neither `host_permissions` nor `optional_host_permissions`, so there is no site access to grant and none to revoke.                                                    |

### Remote code

> No. All code is bundled in the package. The extension does not fetch or
> execute remote code, and has no network access of any kind.

### Data usage disclosures

Tick **none** of the data-collection categories, and confirm all three
certifications:

- Not being sold to third parties
- Not being used or transferred for purposes unrelated to the item's single purpose
- Not being used or transferred to determine creditworthiness or for lending

Rationale: FarLink makes no network requests. The only data written is the
user's own settings, in `chrome.storage.sync`, and a transient anchor for the
selected link in `chrome.storage.session`, which is discarded when the tab
closes.

### Privacy policy URL

**Required.** Not conditional, and "it never leaves the device" is specifically
not an exemption. Checked against the [User Data FAQ][faq] on 2026-07-30:

- **FarLink handles user data.** The FAQ's own definition of "handle" names
  "collecting web browsing activity and any information about the website content
  or resources a user requests or interacts with, **including the domains or
  URLs** the browser interacts with". FarLink reads every link's address and
  accessible name on the page, which is exactly that. Its examples of user data
  list "Website content and resources" and "Web browsing activity" outright.
- **Local-only storage does not exempt it.** FAQ #3: extensions "are required to
  disclose how they handle user data, **even when data is processed or stored
  locally** on a user's device and is not transmitted to external servers or
  third parties."
- **`storage.sync` does not exempt it either.** FAQ #14 asks precisely this —
  handles user data but only stores locally or via Chrome Storage Sync — and
  answers **"Yes. This policy requires all Products that handle user information
  to post a privacy policy."** It adds that the policy "may not need to be long
  or complicated", which `store/privacy.md` already satisfies.

So the policy URL field is not the conditional one; it has to be filled in
alongside the single-purpose description and the per-permission justifications.

[faq]: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq

---

## Assets checklist

| Asset | Size | File |
|---|---|---|
| Icon | 16/24/32/48/96/128 | `public/icon/*.png`, from `pnpm icons` |
| Screenshot 1 — Hacker News, the whole index unfiltered: 197 links, title left, address right | 1280×800 | `store/screenshots/1-index.png` |
| Screenshot 2 — MDN's CSS reference, 1,021 links narrowed to 18 as you type | 1280×800 | `store/screenshots/2-filter.png` |
| Screenshot 3 — four of the thirteen themes: Far Manager, yazi, Paper, Macintosh 1984 | 1280×800 | `store/screenshots/3-themes.png` |
| Small promo tile | 440×280 | `store/screenshots/promo-440x280.png` |

The icon is U+2197 NORTH EAST ARROW set in **Geist Pixel**, on the `far`
flavour's panel blue. `pnpm icons` renders it; there is no master raster, because
scaling one cannot stay crisp. Measured, reducing a 1024px export kept 50% of its
pixels clean at 16px and 91% at 128px, and smeared the rest into a washed
lavender that loses contrast against the panel. Rendering at each size is 100%
clean at all six.

Two ways of drawing the one glyph, split by what a size can physically hold.
**16, 24, 32 and 48 are drawn pixel by pixel** from three parts — shaft, two
barbs — on an explicit grid, because at those sizes there is no room for a
typeface to be faithful and every pixel has to be placed on purpose. **96 and
128 are set in Geist Pixel's `Grid` variant**, the blocks-and-gutters form that
carries the identity; its gutters only land on whole pixels once the glyph is
about 51px across, which needs a 96px canvas, so below that it aliases into
unequal lumps.

The point size at those two sizes is not a constant in the script: `solveGlyph`
searches upward for the first render that comes out square, sits inside the fill
budget, and lands the grid evenly — at least six blocks to a row, with one block
width and one gutter width throughout.

Regenerating needs ImageMagick and Geist Pixel installed. Neither ships with the
extension — the PNGs are committed, so this only matters if the icon changes.

All three screenshots and the promo tile come from `pnpm shots`
(`scripts/make-shots.sh`), which builds the extension and drives the **real**
content-script bundle against live pages through a small `chrome` shim, so what
is captured is what ships. The theme and corner are seeded into
`chrome.storage.sync` rather than reached by counting `Alt+T` presses — an
earlier pass drove the theme with keystrokes and silently produced the wrong
one.

Anything that changes the panel's width, the key bar or the row height
invalidates all of them, so re-capture the set together rather than one at a
time. They are gitignored precisely so a stale one cannot sit in the repo
looking current.

## Release steps

1. `pnpm check`: format, typecheck and tests must all pass.
2. Bump `version` in `package.json`.
3. `pnpm zip` → `build/farlink-<version>-chrome.zip` (lowercase: the filename
   comes from the package name, not the display name).
4. Upload in the Developer Dashboard, paste the copy above, attach assets.
5. Submit. First review of an extension with a Privacy tab typically takes
   longer than an update.
