// @vitest-environment node
// Importing the config pulls in the Cloudflare plugin, and so wrangler and esbuild, which
// refuses to run against jsdom's TextEncoder ("this JavaScript environment is broken").
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ConfigEnv, UserConfig } from 'vite'
import configFn from '../../vite.config'

/**
 * `vite-plugin-mkcert` fetches the mkcert release list from the GitHub API when Vite resolves
 * the config. That is fine on a dev machine and wrong everywhere else: Vitest resolves the
 * config on startup, so a plain test run called the API too, and CI runners share an IP and so
 * share the unauthenticated rate limit. The pipeline failed with a 403 on a run that had nothing
 * to do with certificates, and passed on the next one purely because the shared quota had moved.
 */
const MKCERT = 'vite:plugin:mkcert'

/**
 * Vite plugins nest arbitrarily (a plugin may be an array of plugins), so this walks rather
 * than flattening: `.flat(Infinity)` over Vite's own union types makes tsc give up with
 * "type instantiation is excessively deep".
 */
function pluginNames(env: ConfigEnv): string[] {
  const config = (configFn as unknown as (e: ConfigEnv) => UserConfig)(env)
  const names: string[] = []
  const walk = (plugin: unknown): void => {
    if (Array.isArray(plugin)) return plugin.forEach(walk)
    if (plugin && typeof plugin === 'object' && 'name' in plugin) {
      names.push(String((plugin as { name: unknown }).name))
    }
  }
  walk(config.plugins)
  return names
}

const serve: ConfigEnv = { command: 'serve', mode: 'development' }
const build: ConfigEnv = { command: 'build', mode: 'production' }

describe('root vite config', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('leaves mkcert out of a test run', () => {
    // This test is itself a test run, so the env already says so.
    expect(pluginNames(serve)).not.toContain(MKCERT)
  })

  it('leaves mkcert out in CI', () => {
    vi.stubEnv('VITEST', '')
    vi.stubEnv('CI', 'true')
    expect(pluginNames(serve)).not.toContain(MKCERT)
  })

  it('leaves mkcert out of a build', () => {
    vi.stubEnv('VITEST', '')
    vi.stubEnv('CI', '')
    expect(pluginNames(build)).not.toContain(MKCERT)
  })

  /** The point of the plugin: local dev serves HTTPS, so this must keep working. */
  it('loads mkcert for a local dev server', () => {
    vi.stubEnv('VITEST', '')
    vi.stubEnv('CI', '')
    expect(pluginNames(serve)).toContain(MKCERT)
  })

  /** Gating one plugin must not disturb the others. */
  it('keeps the rest of the plugins in every case', () => {
    for (const env of [serve, build]) {
      expect(pluginNames(env)).toEqual(expect.arrayContaining(['markdown', 'vite:react-babel']))
    }
  })
})
