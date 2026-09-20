# Chrome Web Store listing

Copy-paste source for the Developer Dashboard. Keep this in sync with the
manifest and the privacy policy; review compares all three.

---

## Name

```text
FarLink — Every link on a page, by keyboard
```

(43 characters; the limit is 45. `test/manifest-limits.test.ts` counts this,
`short_name` and the description on every run.)

## Summary

```text
Ctrl+Shift+Period (Cmd on Mac) opens every link on the page in one list. Filter by title or address. No mouse.
```

(110 characters; the limit is 132. Identical to the manifest `description`,
which is what the store actually shows under the name.)

## Category

Productivity → Workflow & Planning

## Description

```text
Open FarLink with Ctrl+Shift+Period (Cmd+Shift+Period on Mac), or click the toolbar button. Every link on the page appears in one list, title on the left and address on the right. Type to filter by either — there is no prefix key. Arrow keys move, Enter opens the link, Alt+Enter opens it in a background tab.

The panel sits in a corner so most of the page stays visible. FarLink does not scroll the page.

For a single link you have already spotted, Vimium's hints are faster. FarLink helps when you need to search a long page by title or address.

• Every link on the page in one list; type to filter by title or address
• Arrow keys move; letters are left free for typing
• Enter opens the link; Alt+Enter opens it in a background tab
• Alt+arrows docks the panel; Alt+S resizes it
• Alt+comma opens settings (theme, size, corner); Option on macOS
• Thirteen themes on Alt+T, light and dark, checked for WCAG AA body text

PERMISSIONS

No site access at install. Pressing the shortcut or clicking the toolbar button grants `activeTab` for that one tab, for that one visit. The panel stays available on that tab until you navigate away. There are no host permissions.

PRIVACY

No server, analytics, telemetry, or account. Page content stays in the tab. Settings live in your browser profile.

Alongside Vimium, Surfingkeys, or Vimari — not a replacement for them.
```

**Do not list the themes by name** (store Spam rejection on 0.1.1). Keep count,
`Alt+T` and AA; names live in the screenshot.

## Keywords

```text
keyboard navigation, vim, no mouse, accessibility, power user, keyboard shortcuts, productivity, file manager, orthodox, link list, filter links, open in background tab
```

---

## Privacy tab

### Single purpose

```text
FarLink lists the links on the current web page so they can be reached from the keyboard. It reads the page's DOM to collect each link's accessible name and destination, shows them in a panel the user can filter by either, and opens the selected link, in the same tab or in a new one, when the user presses Enter.
```

### Permission justifications

| Permission                            | Justification                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `activeTab`                           | Grants access to the current tab only when the user invokes the extension — by its keyboard shortcut or by clicking its toolbar button — so navigation can be started on a page without requesting access to any site in advance.                                                                                  |
| `scripting`                           | Injects the extension's own content script into the current tab when the user invokes the shortcut or clicks the toolbar button. This is the only way the panel is ever created; nothing is registered in advance.                                                       |
| `storage`                             | Stores the user's own settings (theme, panel corner and size) and a per-tab anchor so the selected link can be re-found after the page navigates. The anchor holds that one link's address and identifying attributes plus hashes of its name and text; it is session-scoped, replaced on the next selection, and discarded when the tab closes. No page text is stored.                                                                               |
| Host permissions                      | None. The extension declares neither `host_permissions` nor `optional_host_permissions`, so there is no site access to grant and none to revoke.                                                    |

### Remote code

```text
No. All code is bundled in the package. The extension does not fetch or execute remote code, and has no network access of any kind.
```

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
| Screenshot 1 — Hacker News, the whole index unfiltered, title left and address right | 1280×800 | `store/screenshots/1-index.png` |
| Screenshot 2 — MDN's CSS reference, a thousand-odd links narrowed to a screenful as you type | 1280×800 | `store/screenshots/2-filter.png` |
| Screenshot 3 — four of the thirteen themes: Far Manager, yazi, Paper, Macintosh 1984 | 1280×800 | `store/screenshots/3-themes.png` |
| Small promo tile | 440×280 | `store/screenshots/promo-440x280.png` |
| Marquee promo tile | 1400×560 | `store/screenshots/promo-1400x560.png` |

The icon is a north-east arrow on the `far` flavor's panel blue. `pnpm icons`
renders it; there is no master raster, because scaling one cannot stay crisp.
Measured, reducing a 1024px export kept 50% of its pixels clean at 16px and 91%
at 128px, and smeared the rest into a washed lavender that loses contrast
against the panel. Rendering at each size is 100% clean at all six.

**Every size is drawn pixel by pixel** from three parts — two bars and the
diagonal shaft between them — on an explicit grid, from one rule that takes only
the canvas:

    bar = margin = canvas / 8      box = canvas * 3/4      band = ceil(bar * √2)

The three add back to the canvas exactly, with nothing left to round, because
every size Chrome asks for divides by 8. The band is the diagonal counted in
columns rather than measured across: a 45° band of n anti-diagonals is only
n / √2 thick perpendicular to itself, so a shaft drawn at the bar's own count
reads visibly thinner than the bars it joins. The ceiling errs heavy on purpose.
A shaft slightly lighter than its bars reads as a mistake; slightly heavier
reads as a choice.

An earlier version set 96 and 128 in Geist Pixel and drew only 16 to 48. A
typeface is rasterized for text rather than designed as an icon, and the two
techniques did not agree with each other: measured against the canvas, the drawn
sizes filled 0.604 to 0.625 of it while the font landed on 0.667 at 96 and 0.594
at 128. Nothing chose those numbers — they fell out of a point-size search. One
rule for all six replaces both the font and the search, and the mark is now the
same drawing at every size for the first time.

Regenerating needs only ImageMagick, which does not ship with the extension. The
PNGs are committed, so this only matters if the icon changes.

The two promo tiles are deliberately different compositions rather than one
scaled to two sizes. The small tile is 1.57:1 and has room for a name and one
line; the marquee is 2.5:1, where that stacked arrangement leaves two thirds of
the frame empty. So the marquee is the panel itself — the real four bands at
20px instead of the product's 13px — which is a composition at marquee sizes,
not the shrunken screenshot an earlier small tile was.

Its header is drawn in panel blue rather than `bgAlt`. The shipped icon carries
its own `#0000aa` field and reads as a lighter square on any other band, and
the PNG is opaque enough that no blend mode removes it; painting the band in
panel blue is also the closer reading of Far, which draws column titles as
accent text on the panel rather than as a solid bar.

All three screenshots and the promo tiles come from `pnpm shots`
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
