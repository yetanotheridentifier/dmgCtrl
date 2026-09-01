/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { marked } from 'marked'

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
 * user-facing: it plays the coverage decks to reach every kind of prompt.
 */
const SIMULATION_TESTS = [
  'src/test/benchLethal.test.ts',
  'src/test/choicePrompt.test.ts',
  'src/test/benchDecisions.test.ts',
  'src/test/benchGeneralisation.test.ts',
  'src/test/benchTerms.test.ts',
  'src/test/aiShieldedSentinelReport.test.ts',
  'src/test/aiWeightScale.test.ts',
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
