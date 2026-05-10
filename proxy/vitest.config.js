import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
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
