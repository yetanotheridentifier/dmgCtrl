/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { marked } from 'marked'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig(({ mode }) => {
  const base = mode === 'github' ? '/dmgCtrl/' : '/'

  return {
    base,
    server: {
      host: true,
      // The sealed app dev server (sealed/, port 5174) is proxied under /sealed
      // so https://dev.dmgctrl.app:5173/sealed/ works with the mkcert cert.
      // ws: true forwards its HMR websocket. Harmless when 5174 isn't running.
      proxy: {
        '/sealed': {
          target: 'http://localhost:5174',
          changeOrigin: true,
          ws: true,
        },
      },
    },
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
        workbox: {
          // The sealed app lives under /sealed as a separate build — the PWA's
          // service worker must not rewrite its navigations to the PWA index.
          navigateFallbackDenylist: [/^\/sealed/],
        },
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
      exclude: ['proxy/**', 'sealed/**', 'node_modules/**'],
    },
  }
})