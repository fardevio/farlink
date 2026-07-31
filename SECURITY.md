# Security policy

FarLink runs inside every page you open it on, so its security posture matters
more than its size suggests.

## Reporting a vulnerability

**Do not open a public issue.**

Report it privately through GitHub's
[security advisory form](https://github.com/fardevio/farlink/security/advisories/new),
or by email to <fardevio@gmail.com>.

Please include what an attacker can do, how to reproduce it, and the page or
markup that triggers it, if there is one. You will get an acknowledgement
within a few days. This is a one-person project, so a fix may take longer than
that; you will be told either way, and credited unless you would rather not be.

## What the extension can do

Worth knowing before you assess anything:

- It requests **no host permissions**, required or optional. Access to a tab is
  granted by Chrome only when you press the shortcut or click the toolbar
  button, and only for that invocation. Nothing in the code calls
  `permissions.request()`, and nothing runs on a page the user has not invoked
  it on.
- It makes **no network requests**, has no server, and bundles all of its own
  code. There is no remote code execution path because there is no remote code.
- It **never writes to the clipboard** and never reads it.
- It stores your settings in `chrome.storage.sync`, and an anchor for the one
  selected link in `chrome.storage.session` so the selection can be restored
  after navigation. That anchor includes the link's own `href`, along with
  identifying attributes the page set and **hashes** of the link's name and
  text — the full field list is in
  [store/privacy.md](store/privacy.md#what-the-selection-anchor-contains).
  Nothing else is persisted, nothing is written to disk, and nothing leaves the
  browser.

## Design choices that are security choices

- The panel lives in a **closed shadow root** with a randomised host tag, so
  page scripts cannot reach into it or style it.
- The key listener runs in the **capture phase** and checks `isTrusted`, so a
  page cannot synthesise keystrokes to drive the extension.
- Link text is written with `textContent`, never `innerHTML`. Page-controlled
  strings are never parsed as markup.
- `javascript:` URLs are never listed as addresses and are never handed to the
  worker to open in a tab, which is the only path that could run one with the
  extension's privileges. Pressing Enter on such a link still clicks the
  element, exactly as clicking it with the mouse would — that runs in the
  page's own origin, which the page can already do unaided, so FarLink does not
  try to be a link filter the browser is not.

If you find a way around one of these, that is exactly the sort of report this
document exists for.

## Scope

In scope: anything that lets a page read data it should not, drive the
extension without the user, escape the shadow root, or execute code.

Out of scope: findings that require the user to install a malicious extension
or run code in the console themselves, and reports from automated scanners with
no demonstrated impact.
