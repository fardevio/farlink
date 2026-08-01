# Changelog

Notable changes to FarLink. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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
- The panel lives in a closed shadow root with a randomised host tag. Link text
  is written with `textContent`, and `javascript:` URLs are never shown as
  addresses or opened in a tab.

[Unreleased]: https://github.com/fardevio/farlink/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/fardevio/farlink/releases/tag/v0.1.0
