/**
 * Color palettes for FarLink.
 *
 * Each flavor carries a comment citing where its colors came from.
 * Where a value was chosen by us rather than taken from a source, the
 * comment says so explicitly.
 */

export interface Palette {
  /** Panel background. */
  bg: string
  /** Slightly offset background for alternating rows / secondary panels. */
  bgAlt: string
  /** Floating surface background: the filter bar and the settings rows. */
  panel: string
  /** Border and separator color. */
  border: string
  /** Primary text. */
  fg: string
  /** Secondary / metadata text. */
  dim: string
  /** Accent for breadcrumbs and headers. */
  accent: string
  /** Text drawn on top of `accent`. */
  accentFg: string
  /** Cursor row background. */
  cursor: string
  /** Text on the cursor row. */
  cursorFg: string
  /** Warning / degraded-anchor color. */
  warn: string
}

export interface Flavor {
  id: string
  name: string
  /** "dark" or "light". Drives prefers-color-scheme auto-selection. */
  scheme: "dark" | "light"
  palette: Palette
}

export const FLAVORS: Flavor[] = [
  // Far Manager's shipped defaults, read from the DefaultPalette table in
  // far/palette.cpp (github.com/FarGroup/FarManager). Verified entries:
  //   Panel.Text            F_LIGHTCYAN|B_BLUE
  //   Panel.Box             F_LIGHTCYAN|B_BLUE
  //   Panel.Title.Column    F_YELLOW|B_BLUE
  //   Panel.Cursor          F_BLACK|B_CYAN
  //   Panel.Text.Highlight  F_LIGHTGRAY|B_BLUE
  //   Keybar.Text           F_BLACK|B_CYAN    (function-key bar)
  //   Keybar.Background     F_LIGHTGRAY|B_BLACK
  // Those names resolve through the DOS 16-color CGA/EGA/VGA palette
  // (en.wikipedia.org/wiki/Color_Graphics_Adapter): blue #0000aa,
  // cyan #00aaaa, light cyan #55ffff, yellow #ffff55, black #000000,
  // light gray #aaaaaa, light red #ff5555.
  // Chosen by us, not sourced: `bgAlt` (a darkened blue, since Far has no
  // alternating-row color) and `warn` (Far signals warnings with a red
  // *background*, WarnDialog.Text = F_WHITE|B_RED, never a foreground on
  // the panel; DOS light red on the blue panel measures only 4.2:1, so
  // reach for the "contrast" flavor if that matters).
  {
    id: "far",
    name: "Far Manager",
    scheme: "dark",
    palette: {
      bg: "#0000aa",
      bgAlt: "#000088",
      panel: "#000000",
      border: "#55ffff",
      fg: "#55ffff",
      dim: "#aaaaaa",
      accent: "#ffff55",
      accentFg: "#000000",
      cursor: "#00aaaa",
      cursorFg: "#000000",
      // Deviation from the DOS palette, on purpose. Light red #ff5555 on the
      // blue panel measures 4.23:1, below AA, and this color carries the
      // "page changed, do not activate" warning. A user misreading that acts
      // on the wrong element, so legibility wins over fidelity here: 6.6:1.
      warn: "#ff9a9a"
    }
  },

  // yazi ships no default hex palette. Its preset theme
  // (yazi-config/preset/theme-dark.toml) sets ANSI color *names*, which
  // the user's terminal resolves. Confirmed against
  // yazi-rs.github.io/docs/configuration/theme. Role assignments verified
  // from that preset:
  //   mgr.cwd = cyan                    -> accent (the breadcrumb)
  //   indicator.current = reversed      -> cursor row inverts fg/bg
  //   mgr.border_style = gray (ANSI 7); status.perm_sep = darkgray
  //   notify.title_warn = yellow        -> warn
  // The names are rendered here with the Windows Terminal "Campbell"
  // scheme (microsoft/terminal, src/cascadia/TerminalSettingsModel/
  // defaults.json) as a neutral reference ANSI palette; that choice of
  // reference is ours, since yazi has no canonical one. Also ours:
  // `bgAlt`/`panel` (the preset sets no surface colors) and using ANSI 8
  // (#767676) for `border` rather than the preset's ANSI 7 (#cccccc), as a
  // 1px CSS rule reads much heavier than yazi's thin box-drawing glyph.
  {
    id: "yazi",
    name: "Yazi",
    scheme: "dark",
    palette: {
      bg: "#0c0c0c",
      bgAlt: "#151515",
      panel: "#1c1c1c",
      border: "#767676",
      fg: "#cccccc",
      // Campbell's ANSI 8 (#767676) measures 4.31:1 here, just under AA, and
      // `dim` carries every role label and child count in the strip. Lightened
      // to clear it at 6.3:1.
      dim: "#8a8a8a",
      accent: "#3a96dd",
      accentFg: "#0c0c0c",
      cursor: "#cccccc",
      cursorFg: "#0c0c0c",
      warn: "#c19c00"
    }
  },

  // Catppuccin Mocha, from the official palette.json
  // (github.com/catppuccin/palette). Every value below is verbatim from
  // that file: base #1e1e2e, mantle #181825, surface0 #313244,
  // surface1 #45475a, text #cdd6f4, subtext0 #a6adc8, mauve #cba6f7,
  // peach #fab387, sky #89dceb, yellow #f9e2af. Role assignment is ours,
  // including picking mauve out of the 14 named accents.
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    scheme: "dark",
    palette: {
      bg: "#1e1e2e",
      bgAlt: "#181825",
      panel: "#313244",
      border: "#45475a",
      fg: "#cdd6f4",
      dim: "#a6adc8",
      accent: "#cba6f7",
      accentFg: "#1e1e2e",
      cursor: "#45475a",
      cursorFg: "#cdd6f4",
      warn: "#f9e2af"
    }
  },

  // Our own design, not a port of any existing scheme, so nothing here
  // was researched. Warm paper white, near-black ink and an ink-blue
  // accent. Contrast measured against `bg` with the WCAG 2.x
  // relative-luminance formula: fg 16.8:1, dim 5.5:1, accent 7.8:1,
  // warn 6.4:1; accentFg on accent 8.1:1, cursorFg on cursor 12.6:1.
  // Every pair clears AA.
  {
    id: "paper",
    name: "Paper",
    scheme: "light",
    palette: {
      bg: "#fbfaf7",
      bgAlt: "#f1efe9",
      panel: "#ffffff",
      border: "#dcd8ce",
      fg: "#1a1917",
      dim: "#6a655c",
      accent: "#1b4ba3",
      accentFg: "#ffffff",
      cursor: "#dfe7f7",
      cursorFg: "#16233d",
      warn: "#8f4a08"
    }
  },

  // Our own design. Pure black, pure white, saturated cues. Ratios below
  // were computed with the WCAG 2.x relative-luminance formula; every
  // pair clears the 7:1 AAA threshold:
  //   fg on bg            21.00:1
  //   fg on bgAlt         19.03:1
  //   dim on bg           13.62:1
  //   accent on bg        19.56:1
  //   accentFg on accent  19.56:1
  //   cursorFg on cursor  16.75:1
  //   warn on bg           9.20:1
  {
    id: "contrast",
    name: "High Contrast",
    scheme: "dark",
    palette: {
      bg: "#000000",
      bgAlt: "#101010",
      panel: "#000000",
      border: "#ffffff",
      fg: "#ffffff",
      dim: "#d0d0d0",
      accent: "#ffff00",
      accentFg: "#000000",
      cursor: "#00ffff",
      cursorFg: "#000000",
      warn: "#ff8a80"
    }
  },

  // Grayscale, no hue at all. Not a homage to a specific machine. The point is
  // a flavor that cannot clash with any page, since every color it draws is
  // on the same axis as the text.
  {
    id: "mono",
    name: "Mono",
    scheme: "dark",
    palette: {
      bg: "#101010",
      bgAlt: "#1c1c1c",
      panel: "#000000",
      border: "#8a8a8a",
      fg: "#e8e8e8",
      dim: "#a6a6a6",
      accent: "#ffffff",
      accentFg: "#101010",
      cursor: "#d0d0d0",
      cursorFg: "#101010",
      // No red available on a gray axis, so the warning reads by being the
      // only mid-gray on a panel of near-white and near-black. Weaker than a
      // hue would be, and the honest cost of the constraint.
      warn: "#c8c8c8"
    }
  },

  // Macintosh System 1 (1984) was a 512x342 1-bit display: every pixel was
  // black or white, and selection was literal inversion. So this is #000 on
  // #fff with inverted cursor rows, and the grays exist only for the metadata
  // column, which the original would have rendered as a 50% stipple.
  {
    id: "macintosh",
    name: "Macintosh 1984",
    scheme: "light",
    palette: {
      bg: "#ffffff",
      bgAlt: "#eeeeee",
      panel: "#dddddd",
      border: "#000000",
      fg: "#000000",
      dim: "#555555",
      accent: "#000000",
      accentFg: "#ffffff",
      cursor: "#000000",
      cursorFg: "#ffffff",
      // The one deviation: a 1-bit display had no way to say "warning", and
      // this color carries "do not activate this". Legibility of the warning
      // beats fidelity to the hardware.
      warn: "#8a0000"
    }
  },

  // Windows XP's Luna theme. #ece9d8 is the classic "button face" beige,
  // #0054e3 and #0831d9 the title-bar blues, #316ac5 the Explorer selection
  // fill. Values as they appear in the Luna .msstyles and in every screenshot
  // of the era, including the one that prompted this flavor.
  {
    id: "luna",
    name: "Windows XP",
    scheme: "light",
    palette: {
      bg: "#ece9d8",
      bgAlt: "#d6d3c4",
      panel: "#0831d9",
      border: "#0054e3",
      fg: "#0a0a0a",
      dim: "#4a4a52",
      accent: "#0831d9",
      accentFg: "#ffffff",
      cursor: "#316ac5",
      cursorFg: "#ffffff",
      warn: "#a30000"
    }
  },

  // Fallout: New Vegas' Pip-Boy 3000, which is amber rather than Fallout 3's
  // green. The in-game default is the "Amber" display setting. #ffb642 is the
  // phosphor, and the background is not black but a very dark warm brown,
  // because the screen glows onto its own bezel.
  {
    id: "newvegas",
    name: "New Vegas",
    scheme: "dark",
    palette: {
      bg: "#14100a",
      bgAlt: "#1f1809",
      panel: "#000000",
      border: "#c07a1e",
      fg: "#ffb642",
      dim: "#b47c2a",
      accent: "#ffd479",
      accentFg: "#14100a",
      cursor: "#ffb642",
      cursorFg: "#14100a",
      // Pushed toward red rather than staying amber: a warning that is the
      // same hue as the body text is not a warning.
      warn: "#ff8a5c"
    }
  },

  // IBM 3270 terminal green phosphor, the lineage this whole panel comes from.
  // black background, green text, and the 3270's brighter cyan for field
  // headings. Chosen over IBM's modern Carbon blue because the product is a
  // text-mode panel, not a design system.
  {
    id: "ibm",
    name: "IBM 3270",
    scheme: "dark",
    palette: {
      bg: "#000000",
      bgAlt: "#0d1a0d",
      panel: "#000000",
      border: "#00a86b",
      fg: "#33ff66",
      dim: "#20b04a",
      accent: "#7dfbff",
      accentFg: "#000000",
      cursor: "#33ff66",
      cursorFg: "#000000",
      warn: "#ff9f5c"
    }
  },

  // Nord (nordtheme.com), verbatim: polar night nord0 #2e3440 through nord3
  // #4c566a for the surfaces, snow storm nord5 #e5e9f0 for text, frost nord8
  // #88c0d0 as the accent and aurora nord13 #ebcb8b for `warn`. The dark set
  // had warm (yazi), purple (Catppuccin) and neutral (Mono) and no cool
  // dark at all; this is the canonical one.
  {
    id: "nord",
    name: "Nord",
    scheme: "dark",
    palette: {
      bg: "#2e3440",
      bgAlt: "#3b4252",
      panel: "#272c36",
      border: "#4c566a",
      fg: "#e5e9f0",
      dim: "#bfc8d6",
      accent: "#88c0d0",
      accentFg: "#2e3440",
      cursor: "#88c0d0",
      cursorFg: "#2e3440",
      // Nord's own red, nord11 #bf616a, measures 3.9:1 on nord0 and 3.1:1 on
      // nord1, so under AA on both, and this color carries "do not activate".
      // Lightened until it clears on the darker *and* the lighter surface, the
      // same deviation the Far flavor needed for the same reason.
      warn: "#eba3aa"
    }
  },

  // Solarized Light (ethanschoonover.com/solarized): base3 #fdf6e3 and base2
  // #eee8d5 for the surfaces, base1 #93a1a1 for rules. The only light options
  // were pure white and XP's beige, and Solarized is the most-used palette in
  // the category.
  {
    id: "solarized",
    name: "Solarized Light",
    scheme: "light",
    palette: {
      bg: "#fdf6e3",
      bgAlt: "#eee8d5",
      panel: "#e3dcc6",
      border: "#93a1a1",
      // Solarized's own body text is base00 #657b83, which is 4.1:1 on base3,
      // the palette predates WCAG AA and does not clear it. Darkened until both
      // the text and the dim column clear it on base3 and on base2, which is
      // the one deviation.
      fg: "#42565c",
      dim: "#54676c",
      accent: "#1a6e9e",
      accentFg: "#fdf6e3",
      cursor: "#1a6e9e",
      cursorFg: "#fdf6e3",
      warn: "#a5231f"
    }
  },

  // Commodore 64, from the Pepto palette (pepto.de/projects/colorvic): blue
  // #40318d, light blue #7869c4, yellow #d0dc71, cyan #6abfc6. The machine's own
  // screen was light blue on blue at about 2.5:1, gorgeous and unreadable, so
  // the text is lifted to a tint of light blue and everything else is verbatim.
  {
    id: "commodore",
    name: "Commodore 64",
    scheme: "dark",
    palette: {
      bg: "#40318d",
      bgAlt: "#352a78",
      panel: "#2a2160",
      border: "#7869c4",
      fg: "#cfc6f5",
      dim: "#c2b8f0",
      accent: "#d0dc71",
      accentFg: "#40318d",
      cursor: "#cfc6f5",
      cursorFg: "#40318d",
      warn: "#ffb0a6"
    }
  }
]
