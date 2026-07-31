import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL(".", import.meta.url))
    }
  },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["test/**/*.test.ts", "lib/**/*.test.ts"]
  }
})
