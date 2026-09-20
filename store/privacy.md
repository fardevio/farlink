# FarLink privacy policy

Last updated: 2026-07-30

## The short version

FarLink sends nothing anywhere. It has no server, no analytics, no telemetry
and no account, and it makes no network requests of any kind.

## What FarLink reads

When you open FarLink on a page, it reads that page’s DOM to list the links on
it: each link’s accessible name, its destination, and its position and size.
This is the same information the page has already given your browser in order
to display it.

That reading happens entirely inside the tab. Nothing derived from a page is
transmitted, and nothing is written to disk.

## What FarLink stores

| What                                                                 | Where                    | Why                                                                                                     | Lifetime                                                 |
| -------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Your settings: the theme, and the panel’s corner and size            | `chrome.storage.sync`    | So the extension behaves the way you configured it, on every device signed into the same Chrome profile | Until you change them or uninstall                       |
| An anchor for the one link you had selected (full field list below)  | `chrome.storage.session` | So the selection can return to roughly where it was after you navigate                                  | Discarded when the tab closes, and never written to disk |

### What the selection anchor contains

Enough to find one link again after the page re-renders, and nothing else.
This is every field of `SerializedAnchor` in `lib/nav/session.ts`:

- `role` and `tag` — what kind of element it was
- `href` — the address of that one link, as an absolute URL
- `id`, `testId`, `formName` — identifying attributes the page itself put on
  the element
- `nameHash` and `textHash` — hashes, not the text. The link’s accessible name
  and its text are hashed and the originals discarded
- `ancestorRoles` — the roles of up to six enclosing elements
- `siblingIndex`, `setSize`, `posinset` — where the link sat in its list

The link’s on-screen rectangle is deliberately not stored.

Nothing else is stored. Page text, form contents and browsing history are not
recorded, and no list of the pages you visit is ever assembled: the anchor
holds the address of a single link in a single tab, it is replaced the next
time you select something, and it is gone when the tab closes.

## Your clipboard

FarLink does not touch it. It neither reads your clipboard nor writes to it.

## Permissions

FarLink requests no access to any website when you install it.

- `activeTab`: when you press FarLink’s keyboard shortcut or click its toolbar
  button, Chrome grants access to that one tab for that one visit. This is the
  only way FarLink ever reaches a page.
- `scripting`: used to inject FarLink’s own code into the tab you invoked it
  on. Nothing is registered ahead of time, so nothing runs on a page you did
  not invoke it on.
- `storage`: the settings and the anchor described above.

There is no site access to grant and none to revoke. FarLink declares neither
`host_permissions` nor `optional_host_permissions`, and it will never ask for
access to all sites.

## Third parties

There are none. No SDKs, no trackers, no fonts or scripts loaded from a CDN,
no error reporting. The extension package contains all of its own code and
assets.

## Children

FarLink has no accounts and collects no data from anyone. It is not directed at
children.

## Changes

If a future version collects anything at all, this policy will be updated
before that version ships, and the change will be described in the release
notes rather than buried here.

## Contact

Open an issue on the project’s repository.
