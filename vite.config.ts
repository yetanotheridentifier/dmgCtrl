/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { marked } from 'marked'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig({
  base: '/dmgCtrl/',
  plugins: [
    {
      name: 'markdown',
      transform(code: string, id: string) {
        if (!id.endsWith('.md')) return
        const html = marked.parse(code) as string
        return `export default ${JSON.stringify(html)}`
      },
    },
    mkcert(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      manifest: {
        name: 'dmgCtrl',
        short_name: 'dmgCtrl',
        description: 'Star Wars Unlimited game state tracker',
        theme_color: '#0a0e1a',
        background_color: '#0a0e1a',
        display: 'standalone',
        icons: [
          {
            src: 'dmgCtrl-icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'dmgCtrl-icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})