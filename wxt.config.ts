import { defineConfig } from "wxt"

import { assertStoreLimits, MANIFEST } from "./manifest"

export default defineConfig({
  hooks: {
    // WXT infers host_permissions from the content script's `matches`, even
    // for runtime-registered ones. That would put <all_urls> in the install
    // prompt, which is the single thing this permission design exists to avoid.
    "build:manifestGenerated": (wxt, manifest) => {
      delete manifest.host_permissions

      // WXT's hot-reload command survives into production builds, where it
      // would spend one of Chrome's four suggested shortcut slots.
      if (wxt.config.command !== "serve") {
        delete manifest.commands?.["wxt:reload-extension"]
      }

      // Here as well as in a test: nothing forces `pnpm test` before
      // `pnpm zip`, and the zip is what gets uploaded.
      assertStoreLimits(manifest as unknown as Record<string, unknown>)
    }
  },
  srcDir: ".",
  // Non-hidden output dir, matching Vokto (WXT defaults to ".output").
  outDir: "build",
  manifest: MANIFEST
})
