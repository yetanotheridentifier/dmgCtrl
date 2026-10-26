/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { marked } from 'marked'
import mkcert from 'vite-plugin-mkcert'

import { cloudflare } from "@cloudflare/vite-plugin";
import type { Plugin } from 'vite'
import type { ManifestOptions } from 'vite-plugin-pwa'

/** The games with an address of their own: dmgctrl.app/swu and dmgctrl.app/xwing. */
const GAME_ADDRESSES = ['swu', 'xwing']

/**
 * One install for both games, started at the root so it follows Settings › Start screen, with a
 * shortcut to each game's address (Android long-press, desktop right-click). Paths are relative
 * to the manifest, so they hold under the GitHub base path too.
 */
export const PWA_MANIFEST: Partial<ManifestOptions> = {
  name: 'dmgCtrl',
  short_name: 'dmgCtrl',
  description: 'Star Wars Unlimited game state tracker',
  theme_color: '#0a0e1a',
  background_color: '#0a0e1a',
  display: 'standalone',
  start_url: '.',
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
  ],
  shortcuts: [
    { name: 'Star Wars: Unlimited', short_name: 'SWU', url: 'swu/', icons: [{ src: 'dmgCtrl-icon-192.png', sizes: '192x192', type: 'image/png' }] },
    { name: 'X-Wing', short_name: 'X-Wing', url: 'xwing/', icons: [{ src: 'dmgCtrl-icon-192.png', sizes: '192x192', type: 'image/png' }] },
  ],
}

/**
 * GitHub Pages has no fallback to the app's page, so a first visit to /swu would be a 404. The
 * build writes the app's page again at swu/index.html and xwing/index.html; the app reads the
 * address to open that game. Its asset paths are absolute (from `base`), so the copy works one
 * folder down, and the service worker precaches it with the rest of the HTML.
 */
function gameAddresses(): Plugin {
  return {
    name: 'game-addresses',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const page = bundle['index.html']
      if (!page || page.type !== 'asset') return
      for (const game of GAME_ADDRESSES) {
        this.emitFile({ type: 'asset', fileName: `${game}/index.html`, source: page.source })
      }
    },
  }
}

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
      manifest: PWA_MANIFEST,
    }), gameAddresses(), cloudflare()],
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