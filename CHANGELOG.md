# Changelog

Notable changes to FarLink. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.2.0]

### Fixed

- Arrow keys no longer scroll the page when the selected link is already on
  screen. A header link near the top of the viewport was treated as needing
  `scrollIntoView`, so pressing Up on the first row (or Down/Up across already
  visible links) drove the page down — especially on sticky site headers such
  as Unsplash. Revealing now runs only when the link is outside the visible
  band, and a no-op move at either end of the list does not reveal again.

### Changed

- The suggested open shortcut is `Ctrl+Shift+Period` /
  `Cmd+Shift+Period` on both platforms. Space collided with 1Password Quick
  Access everywhere and, from macOS 27, with "ask Siri about the active
  window". Period is free in Chrome's published shortcuts and unused by
  1Password, Bitwarden and Dashlane; Finder's show-hidden chord only applies
  when Finder is frontmost. Chrome only applies a suggested key on first
  install, so existing installs keep whatever is already bound; rebind at
  `chrome://extensions/shortcuts` if Space no longer reaches FarLink.

## [0.1.2]

### Fixed

- The key bar is readable in the Windows XP theme. Its labels were dark gray on
  title-bar blue at 1.02:1; the bar is now pale blue, at 6.6:1. Solarized
  Light's bar is a shade lighter too, since its labels sat just under AA.

## [0.1.1]

### Changed

- The icon is redrawn. Every size is now placed pixel by pixel from one rule
  taking only the canvas, where before 16 to 48 were drawn and 96 and 128 were
  set in Geist Pixel. The two techniques disagreed: the drawn sizes filled 0.604
  to 0.625 of their canvas and the font landed on 0.667 at 96 and 0.594 at 128,
  so the mark changed weight depending on which size Chrome reached for. It is
  the same drawing at every size now, and slightly bolder throughout.
- Regenerating the icon no longer needs Geist Pixel installed, only ImageMagick.

## [0.1.0]

First version. Published to the Chrome Web Store on 31 July 2026.

### Added

- A panel listing every link on the page, filtered by title or address as you
  type, with no prefix key.
- `Enter` opens a link, `Alt+Enter` opens it in a background tab,
  `Alt+Shift+Enter` opens it and switches.
- Four corners (`Alt+arrows`) and three sizes (`Alt+S`), both remembered
  between pages.
- Settings inside the panel on `Alt+,`: theme, size and corner. There is no
  options page, and no UI framework: the extension has no runtime dependencies.
- Thirteen themes on `Alt+T`, each checked by test for WCAG AA contrast.
- macOS, Windows and Linux support, including Option rewriting `event.key` on
  macOS and AltGr arriving as Ctrl+Alt elsewhere.
- The page never scrolls unless you moved the selection deliberately, and the
  scroll position is restored if you close without following anything.

### Security

- No `host_permissions`: the install prompt contains no site access. Access is
  granted by Chrome one tab at a time through `activeTab`, when you press the
  shortcut or click the button.

- No network requests, no clipboard access, no remote code.
- The panel lives in a closed shadow root with a randomized host tag. Link text
  is written with `textContent`, and `javascript:` URLs are never shown as
  addresses or opened in a tab.

[Unreleased]: https://github.com/fardevio/farlink/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/fardevio/farlink/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/fardevio/farlink/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/fardevio/farlink/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/fardevio/farlink/releases/tag/v0.1.0
