import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // `npm test` runs three separate Vitest invocations, so each writes its own summary to the
  // CI report. Named, or the run shows three anonymous blocks and you count tests to tell them
  // apart.
  test: { name: 'proxy' },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          INFLUXDB_TOKEN: 'test-token',
          INFLUXDB_URL: 'https://test.influxdb.com',
          INFLUXDB_ORG: 'test-org',
        },
      },
    }),
  ],
})
