/**
 * Styles for the docked link panel.
 *
 * Written as a string rather than a Tailwind sheet: this lives in a closed
 * shadow root inside a `document_start` content script, and inlining ~4 KB of
 * CSS avoids both a runtime stylesheet fetch (which strict-CSP sites block)
 * and pulling a utility framework into the hot path.
 *
 * Everything is in px, because a host page's root font-size must not be able to
 * resize the panel, and every colour goes through a `--fl-*` variable set by
 * applyFlavor().
 */
export const HUD_CSS = `
:host {
  all: initial;
  font-family: var(--fl-font);
}

.fl-frame {
  /* Docked in a corner, not inset from every edge. A three-column layout needed
     the whole viewport and was reverted; one list does not, and the page's own
     rendering beats anything drawn here, so it stays visible.
     NOTE: no backticks anywhere in this file. It is a template literal, and a
     stray one ends the string with a syntax error a hundred lines away from the
     comment that caused it. This has happened four times — and the fourth
     happened with this very warning already in the file, which is why there is
     now a test rather than only a comment. */
  position: fixed;
  /* Default corner and size; the data attributes below move and resize it.
     Kept in step with SIZES in hud.ts, which sizes the row window from the same
     numbers, because the panel is content-sized and cannot be measured. */
  left: var(--fl-gap);
  bottom: var(--fl-gap);
  /* Sized to what a row holds, not to the viewport. A name is left-aligned and
     an address right-aligned, so every pixel past the widest pair is dead
     gutter: on a real docs page the widest row measured 485px inside a panel
     1696px wide.

     A clamp of floor, preference, ceiling. The floor is the key bar, which
     needs 571px to fit: the bar cannot wrap (see .fl-footer), so under this the
     frame clips its last key instead. The preference is a share of the viewport,
     so the page stays visible on a wide screen; the ceiling is where the extra
     width becomes all gutter. The viewport bound is the max-width below, held
     apart from the clamp so no size has to remember it. It replaces a media
     query that set the width outright rather than bounding it, and so made the
     panel widest on the narrowest screens. */
  --fl-gap: 20px;
  --fl-floor: 580px;
  width: clamp(var(--fl-floor), 52vw, 640px);
  /* Declared once, for every size. A percentage on a fixed element resolves
     against the viewport minus its scrollbar, which 100vw does not. */
  max-width: calc(100% - var(--fl-gap) * 2);
  max-height: 62vh;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  font-family: var(--fl-font);
  font-size: 13px;
  line-height: 21px;
  color: var(--fl-fg);
  /* Opaque. Transparency was tried twice and failed the same way both times:
     without a backdrop blur, a light theme over a light busy page (apple.com
     was the case that settled it) loses its own boundary and the panel stops
     reading as a window at all. The blur is the only technique that buys both,
     and it was removed on purpose, so transparency is what goes. The border and
     the shadow now carry the separation on their own. */
  background: var(--fl-bg);
  border: 1px solid var(--fl-border);
  border-radius: 6px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.06) inset,
    0 0 0 1px rgba(0, 0, 0, 0.25),
    0 16px 48px -12px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  contain: layout style;
}

.fl-frame[hidden] { display: none; }

/* ---- header ---- */

/* Far draws column titles as accent text on the panel, not as a solid accent
   bar. Following that keeps the header legible in every flavour without
   needing a second colour behind it. */
.fl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 12px;
  letter-spacing: 0.02em;
  background: var(--fl-bg-alt);
  color: var(--fl-accent);
  border-bottom: 1px solid var(--fl-border);
  min-height: 24px;
}

.fl-crumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
}

.fl-crumb { color: var(--fl-accent); opacity: 0.75; }
.fl-crumb-active { opacity: 1; font-weight: 700; }
.fl-crumb-more { opacity: 0.5; }
.fl-sep { opacity: 0.5; }

.fl-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.fl-warn { color: var(--fl-warn); font-weight: 700; }
.fl-pending {
  color: var(--fl-accent-fg);
  background: var(--fl-accent);
  padding: 0 5px;
  border-radius: 2px;
  font-weight: 700;
}

/* A transient announcement in the header's right-hand corner: what the theme
   just became. Up there rather than in the status line because it is about the
   panel itself, not about the list, and because on a theme change the whole
   surface has just repainted and the eye is already on it. */
.fl-notice {
  color: var(--fl-accent-fg);
  background: var(--fl-accent);
  padding: 0 6px;
  border-radius: 2px;
  font-weight: 700;
  white-space: nowrap;
}

/* ---- rows ---- */

.fl-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 0 12px;
  height: 21px;
  white-space: nowrap;
  overflow: hidden;
}

.fl-row[hidden] { display: none; }

.fl-row-cursor {
  background: var(--fl-cursor);
  color: var(--fl-cursor-fg);
}

.fl-row-uncertain .fl-name { font-style: italic; opacity: 0.75; }

/* A rule between groups of settings. Kept at the full row height so the uniform
   21px that rowBudget() in hud.ts computes against still holds; the line is
   drawn inside the row rather than by shrinking it. */
.fl-row-divider { align-items: center; }
.fl-row-divider .fl-name {
  border-top: 1px solid var(--fl-border);
  opacity: 0.4;
}
.fl-row-divider .fl-url { display: none; }

/* Openable rows read as links, because Enter goes somewhere instead of stepping
   a value. Underlined in the primary colour rather than the accent: fg is
   contrast-tested against both backgrounds in every flavour, while accent is
   only ever verified behind accentFg. */
.fl-row-openable .fl-url {
  color: var(--fl-fg);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.fl-row-cursor.fl-row-openable .fl-url { color: var(--fl-cursor-fg); }

.fl-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Matched characters get a background rather than a weight change. Bold in a
   monospace face is a weak signal at this size, and it was the same signal the
   marked rows used to use. The accent / accent-fg pair is contrast-verified in
   every flavour, so the highlight carries its own legibility and needs no
   special case for the cursor row underneath it. No padding: a background on
   inline text keeps the monospace grid, and padding would shift every character
   after it. */
.fl-hit {
  background: var(--fl-accent);
  color: var(--fl-accent-fg);
  border-radius: 1px;
}

.fl-url {
  flex-shrink: 1;
  min-width: 0;
  max-width: 44%;
  color: var(--fl-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}

.fl-url:empty { display: none; }

.fl-row-cursor .fl-url {
  color: var(--fl-cursor-fg);
  opacity: 0.75;
}

/* ---- status + footer ---- */

/* There is nothing to filter in settings, and an empty reserved row at the foot
   of the panel reads as a search box you cannot type in. */
.fl-frame[data-mode="settings"] .fl-status { display: none; }

.fl-status {
  display: flex;
  align-items: baseline;
  /* No gap: the caret has to sit against the last character, the way it does
     in a terminal. Spacing that belongs to one part is set on that part. */
  gap: 0;
  padding: 3px 12px;
  min-height: 23px;
  background: var(--fl-bg-alt);
  border-top: 1px solid var(--fl-border);
}


.fl-filter { color: var(--fl-fg); }
.fl-message { color: var(--fl-dim); margin-left: 8px; }
.fl-message:first-child { margin-left: 0; }

/* While you are typing, the status line stops being a status line and becomes
   the thing you are typing into: opaque rather than translucent like the list
   above it, an accent rule along its top edge, and the query in bold beside a
   block cursor. There is no "/" prefix to announce the mode, so changing the
   surface says it better than adding a glyph in front of the query.

   Nothing here changes the bar's height. It is the one row that must not move:
   the panel is sized by its content and anchored at the bottom, so a taller
   status line would push everything above it as you started to type. The chip
   takes horizontal padding only, and every glyph keeps the inherited
   line-height. */
.fl-frame[data-mode="filter"] .fl-status {
  background: var(--fl-bg-alt);
  border-top: 1px solid var(--fl-accent);
}

.fl-frame[data-mode="filter"] .fl-filter { font-weight: 700; }

/* Pushed to the far end, so a message and a live filter share the line
   without the message looking like part of the query. */
.fl-status-end { margin-left: auto; }

/* While a navigation is in flight, only the row it belongs to stays lit. */
.fl-list[data-busy] .fl-row { opacity: 0.4; }
.fl-list[data-busy] .fl-row-cursor { opacity: 1; }
.fl-url-busy { color: var(--fl-cursor-fg); font-weight: 700; opacity: 1; }

/* A block, not an underscore: it reads as a cursor sitting in the text rather
   than as punctuation after it. Flush against the last character, since a monospace
   block is exactly one cell wide, so it needs no nudging in either direction. */
.fl-caret {
  color: var(--fl-cursor);
  animation: fl-blink 1s steps(2, start) infinite;
}

.fl-footer {
  display: flex;
  /* Never grows past one line. PANEL_CHROME in hud.ts is a constant that
     assumes exactly that, and a second line costs it height it cannot see, so
     the panel draws a row too many and max-height clips the last one out of
     sight.
     Both declarations are needed: nowrap alone stops the groups moving to a
     second line but lets them shrink below their text, which then wraps inside
     each group and makes the bar 32px tall anyway (measured at a 600px
     viewport). With the text held too, the bar overflows and the frame's
     overflow: hidden clips the last key, which is the same failure made
     visible instead of silent. */
  flex-wrap: nowrap;
  white-space: nowrap;
  gap: 12px;
  padding: 4px 12px;
  background: var(--fl-panel);
  border-top: 1px solid var(--fl-border);
  color: var(--fl-dim);
  font-size: 11px;
  line-height: 16px;
}

.fl-key-group { display: inline-flex; gap: 4px; align-items: baseline; }

/* Far's function-key bar is black on cyan, the same pair as the panel
   cursor, which is exactly how the original looks. */
.fl-key {
  color: var(--fl-cursor-fg);
  background: var(--fl-cursor);
  padding: 0 4px;
  border-radius: 2px;
  font-weight: 700;
}

.fl-key-label { color: var(--fl-dim); }

/* ---- the list ---- */

/* The list inherits the frame's fill; the header, status line and key bar set
   their own so the panel has visible bands. */
.fl-list {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: transparent;
  padding: 4px 0;
}

.fl-col-empty {
  display: block;
  padding: 2px 12px;
  color: var(--fl-dim);
}

.fl-col-empty[hidden] { display: none; }

/* ---- corner ---- */

/* Two independent axes, so all four corners are reachable. */
.fl-frame[data-dock-x="right"] {
  left: auto;
  right: var(--fl-gap);
}

.fl-frame[data-dock-y="top"] {
  bottom: auto;
  top: var(--fl-gap);
}

/* ---- size ---- */

/* Compact is a different layout, not a smaller one. At this width a name and an
   address cannot share a row, so the address goes, and the key bar drops to the
   three keys that fit: see the set hud.ts builds for compact. What is left is a
   name and a position, which is all this size is for. */
.fl-frame[data-size="compact"] {
  width: 380px;
  max-height: 30vh;
}

/* Except in settings, where the address column holds each setting's *value*.
   A compact settings list without it is a list of labels and no information. */
.fl-frame[data-size="compact"]:not([data-mode="settings"]) .fl-url {
  display: none;
}

/* Full is for a page whose link list is the thing you are working through
   rather than a thing you are glancing at. That wants height, which is where
   the rows are, and only as much width as the longest address needs. It used to
   span the viewport and spent three quarters of itself on gutter. Because it
   now has a width, it docks in a corner like the other two rather than
   stretching between both edges. */
.fl-frame[data-size="full"] {
  width: clamp(var(--fl-floor), 68vw, 840px);
  max-height: 92vh;
}

/* ---- the trail left behind when the panel changes corner ---- */

/* A full-viewport overlay that takes no pointer events, one stacking level
   below the panel. Both the ghost trail and the cursor rectangle are one of
   these; Highlighter carries the class rather than restating the declarations
   inline, so the level below the panel is stated once. The fl-trail class adds
   nothing to the look and exists to tell the two layers apart, and to carry the
   fade. */
.fl-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  /* Under the panel, over everything else: the smear is what the panel has
     just left, so it must never be drawn on top of it. */
  z-index: 2147483646;
  contain: strict;
}

/* The trail clears as one layer.
   steps(), not a curve. An eased fade reads as a modern transition; a few
   discrete levels read as a screen that has not caught up with itself, which is
   the artifact being imitated.
   The fade lives here rather than on each copy because an animated opacity is
   composited: animating every copy asked for a panel-sized layer each, twenty of
   them, ~200 MB of texture at full size on a 2x display, to show a 44px sliver
   of each. One animated layer costs one texture however many copies there are,
   and the copies paint into it once and never repaint. The clearing order comes
   from the opacity ramp instead of a stagger: the faintest copies cross out of
   sight first, so the smear still empties from its old end.
   No duration here on purpose: trail.ts writes animation-duration onto the
   element, so TRAIL_MS is stated once and no literal here can drift from it.
   Longhands rather than the shorthand, which would reset that duration. */
.fl-trail {
  animation-name: fl-trail-clear;
  animation-timing-function: steps(3, end);
  animation-fill-mode: forwards;
}

@keyframes fl-trail-clear {
  from { opacity: 1; }
  to { opacity: 0; }
}

.fl-ghost {
  /* Absolute inside the trail layer, which is fixed at inset 0 and contains
     its own layout, so a copy's offset is already a viewport coordinate. Placed
     by transform rather than left/top, so the offset costs no layout. Size
     arrives per copy from leaveTrail(), because a move can resize the panel as
     well as move it. */
  position: absolute;
  left: 0;
  top: 0;
  box-sizing: border-box;
  border: 1px solid var(--fl-border);
  border-radius: 6px;
  background: color-mix(in srgb, var(--fl-bg) 55%, transparent);
  /* Nothing here animates. leaveTrail() deals each copy a static opacity from
     its place on the ramp, and the layer above clears the lot. */
  overflow: hidden;
}

/* So a copy reads as a window rather than as a rectangle. A pseudo-element and
   not a child element: it is pure decoration, and at this count the node it
   saves is worth more than markup that reads literally. */
.fl-ghost::before {
  content: "";
  display: block;
  height: 24px;
  background: color-mix(in srgb, var(--fl-bg-alt) 55%, transparent);
  border-bottom: 1px solid var(--fl-border);
}

@keyframes fl-blink { to { visibility: hidden; } }

@media (prefers-reduced-motion: reduce) {
  .fl-caret { animation: none; }
}

`
