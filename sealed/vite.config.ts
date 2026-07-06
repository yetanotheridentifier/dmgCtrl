/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { marked } from 'marked'

// Served at https://dmgctrl.app/sealed — base must match so built asset URLs resolve.
export default defineConfig({
  base: '/sealed/',
  server: {
    host: true,
    // Fixed port so the main app's dev server can proxy /sealed here —
    // https://dev.dmgctrl.app:5173/sealed/ serves this app via the PWA's
    // mkcert certificate (see root vite.config.ts and sealed/docs/operations.md).
    port: 5174,
    strictPort: true,
  },
  plugins: [
    // Same pattern as the main app: .md files import as rendered HTML strings.
    {
      name: 'markdown',
      transform(code: string, id: string) {
        if (!id.endsWith('.md')) return
        const html = marked.parse(code) as string
        return `export default ${JSON.stringify(html)}`
      },
    },
    react(),
    tailwindcss(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: ['node_modules/**'],
  },
})
