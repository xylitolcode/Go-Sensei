import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Nuxt's `~` / `@` aliases point at the `app/` source directory.
const appDir = fileURLToPath(new URL('./app', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '~': appDir,
      '@': appDir
    }
  }
})
