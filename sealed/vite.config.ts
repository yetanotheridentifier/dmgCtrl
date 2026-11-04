/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { marked } from 'marked'
import { fileURLToPath } from 'node:url'
import { VitePWA } from 'vite-plugin-pwa'
import type { Plugin } from 'vite'
import type { ManifestOptions, VitePWAOptions } from 'vite-plugin-pwa'

/**
 * Sealed installs as an app of its own, beside dmgCtrl on the same origin: its own id, and a
 * scope and start page of /sealed/, so the install opens Sealed and its worker stays there.
 *
 * A copy of the PWA's pattern (PWA_MANIFEST in the root vite.config.ts), kept in the same shape
 * so the two can be merged later. Icon paths are relative to the manifest, which is at /sealed/.
 */
export const SEALED_PWA_MANIFEST: Partial<ManifestOptions> = {
  id: '/sealed/',
  name: 'dmgCtrl Sealed',
  short_name: 'Sealed',
  description: 'Star Wars Unlimited sealed play against the AI',
  theme_color: '#0a0e1a',
  background_color: '#0a0e1a',
  display: 'standalone',
  scope: '/sealed/',
  start_url: '/sealed/',
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
}

/**
 * The service worker precaches the app's code and pages and every image it ships in `public/`, so
 * it opens offline after one visit. Nothing is cached at run time: card data and thumbnails stay
 * in IndexedDB (Dexie), and full card art is fetched from the network each time.
 *
 * Workbox leaves any file over `maximumFileSizeToCacheInBytes` out of the precache with only a
 * warning, and its 2 MiB default is not far above the main bundle, so the limit is set here and
 * `precacheFits` fails the build if a precached file outgrows it.
 *
 * A copy of the PWA's pattern (PWA_WORKBOX in the root vite.config.ts), kept in the same shape.
 */
export const SEALED_PWA_WORKBOX: Partial<VitePWAOptions['workbox']> = {
  globPatterns: ['**/*.{js,css,html,png,svg}'],
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
}

/** The file types SEALED_PWA_WORKBOX's patterns precache. */
const PRECACHED = /\.(js|css|html|png|svg)$/

/** Fails the build, naming the file, if any precached file is over the precache's size limit. */
function precacheFits(): Plugin {
  const limit = SEALED_PWA_WORKBOX.maximumFileSizeToCacheInBytes ?? 0
  return {
    name: 'precache-fits',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (!PRECACHED.test(file.fileName)) continue
        const content = file.type === 'chunk' ? file.code : file.source
        const size = typeof content === 'string' ? new TextEncoder().encode(content).length : content.length
        if (size > limit) {
          this.error(`${file.fileName} is ${size} bytes, over the precache limit of ${limit}: it would not open offline. Raise maximumFileSizeToCacheInBytes in vite.config.ts.`)
        }
      }
    },
  }
}

/**
 * The PWA's shared UI (controls, log drawer, tournament layout), the one part of the PWA that
 * Sealed's UI may import. The engine, AI and bench may not: eslint.config.js holds that line.
 */
const PWA_SHARED = fileURLToPath(new URL('../src/components/shared', import.meta.url))

/**
 * Tests that play real games to get their numbers, rather than asserting against a fixture.
 * Seven files, about 254s of the suite's ~350s of CPU, and the run is CPU-bound in CI, so they
 * are the difference between a five-minute pipeline and a two-and-a-half-minute one.
 *
 * They run as the `sealed-bench` project, nightly rather than per push. Their samples are
 * deliberately not trimmed to make them fit: these measure rates over simulated games, and a
 * smaller sample widens the interval until the test stops meaning anything.
 *
 * The trade is that a regression here is caught that night rather than on the pull request.
 * Most guard the bench harness, which is tooling. `choicePrompt` is the exception and is
 * user-facing: it plays the coverage decks to reach every kind of prompt. So is
 * `aiHiddenInformationCorpus`, which holds the bot to reading nothing its seat cannot see, and
 * for that reason has a per-push counterpart (`aiHiddenInformation`) on a handful of positions.
 */
const SIMULATION_TESTS = [
  'src/test/benchLethal.test.ts',
  'src/test/choicePrompt.test.ts',
  'src/test/benchDecisions.test.ts',
  'src/test/benchGeneralisation.test.ts',
  'src/test/benchTerms.test.ts',
  'src/test/aiShieldedSentinelReport.test.ts',
  'src/test/aiWeightScale.test.ts',
  'src/test/lockoutDecksPlay.test.ts',
  'src/test/aiHiddenInformationCorpus.test.ts',
]

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
    // The shared UI lives outside this package, in the PWA's src/.
    fs: { allow: ['.', '../src'] },
  },
  resolve: {
    alias: { '@pwa-shared': PWA_SHARED },
    // The shared files sit under the PWA's tree, so a bare `react` from them would resolve to the
    // PWA's node_modules: a second React, and the first hook call fails. One copy, this package's.
    dedupe: ['react', 'react-dom'],
  },
  // The opponent's worker (hooks/opponentWorker.ts) is a module worker, so it is bundled as one. Its
  // chunk is a .js file under assets/, which SEALED_PWA_WORKBOX precaches with the rest.
  worker: { format: 'es' },
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
    VitePWA({
      // Not 'autoUpdate' as the PWA has it: a game lives only in memory, so a new worker waits
      // and useUpdateOnDeckScreen applies it when no game is open.
      registerType: 'prompt',
      devOptions: { enabled: false },
      workbox: SEALED_PWA_WORKBOX,
      // The manifest icons are in public/ and already matched by SEALED_PWA_WORKBOX's patterns.
      includeManifestIcons: false,
      manifest: SEALED_PWA_MANIFEST,
    }),
    precacheFits(),
  ],
  test: {
    globals: true,
    // `node`, not `jsdom`: about 150 of the ~190 test files are engine, AI and bench code that
    // never touch a DOM, and building one per file cost more than running the tests. Measured
    // over 16 engine files: 28.6s of CPU against 9.2s, with the environment phase going from
    // 22.7s to nothing. A file that does need a DOM says so with a `@vitest-environment jsdom`
    // docblock, which is local to the file and fails loudly rather than silently.
    environment: 'node',
    setupFiles: './src/test/setup.ts',
    exclude: ['node_modules/**'],
    projects: [
      {
        extends: true,
        test: { name: 'sealed', exclude: ['node_modules/**', ...SIMULATION_TESTS] },
      },
      {
        extends: true,
        test: { name: 'sealed-bench', include: SIMULATION_TESTS },
      },
    ],
  },
})
