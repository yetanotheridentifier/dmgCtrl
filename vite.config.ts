/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { marked } from 'marked'
import mkcert from 'vite-plugin-mkcert'

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ command, mode }) => {
  const base = mode === 'github' ? '/dmgCtrl/' : '/'

  /**
   * mkcert issues the local certificate that lets dev serve HTTPS on dev.dmgctrl.app, with the
   * sealed dev server proxied under /sealed. To do it, the plugin asks the GitHub API for the
   * latest mkcert release while Vite is resolving the config.
   *
   * That has to be limited to an actual dev server. Vitest resolves this config on startup, so
   * a plain test run called the API too, and CI runners share an IP and therefore share the
   * unauthenticated rate limit: the pipeline failed a run with a 403 that had nothing to do
   * with certificates, and passed the next one only because the shared quota had moved on.
   * A build has no use for it either.
   */
  // Reached through globalThis because this config is type-checked without Node types.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  const localDevServer = command === 'serve' && !env.VITEST && !env.CI

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
    plugins: [{
      name: 'markdown',
      transform(code: string, id: string) {
        if (!id.endsWith('.md')) return
        const html = marked.parse(code) as string
        return `export default ${JSON.stringify(html)}`
      },
    }, ...(localDevServer ? [mkcert()] : []), react(), VitePWA({
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
    }), cloudflare()],
    test: {
      // `npm test` runs three separate Vitest invocations, so each writes its own summary to
      // the CI report. Named, or the run shows three anonymous blocks and you count tests to
      // tell them apart.
      name: 'pwa',
      globals: true,
      // Stays `jsdom` here, unlike sealed: 36 of this suite's 44 files render components or
      // hooks, so the default matches the common case and the handful of pure-logic files opt
      // out with a `@vitest-environment node` docblock. Defaulting the other way measured the
      // same (the same 8 files run in node either way) but needed a docblock on 36 files
      // instead of 8.
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      exclude: ['proxy/**', 'sealed/**', 'node_modules/**'],
    },
  };
})