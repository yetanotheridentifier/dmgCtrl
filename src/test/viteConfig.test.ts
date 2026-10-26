// @vitest-environment node
// Importing the config pulls in the Cloudflare plugin, and so wrangler and esbuild, which
// refuses to run against jsdom's TextEncoder ("this JavaScript environment is broken").
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ConfigEnv, UserConfig } from 'vite'
import { getManifest } from 'workbox-build'
import configFn, { PWA_MANIFEST, PWA_WORKBOX } from '../../vite.config'

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

  /**
   * GitHub Pages has no fallback to the app's page, so a first visit to /swu would be a 404
   * unless the build writes a real page there.
   */
  it('writes the app page at swu/index.html and xwing/index.html too', () => {
    const config = (configFn as unknown as (e: ConfigEnv) => UserConfig)(build)
    const found: unknown[] = []
    const walk = (p: unknown): void => {
      if (Array.isArray(p)) return p.forEach(walk)
      if (p && typeof p === 'object' && (p as { name?: string }).name === 'game-addresses') found.push(p)
    }
    walk(config.plugins)
    expect(found).toHaveLength(1)
    const plugin = found[0] as { generateBundle: (this: unknown, o: unknown, b: unknown) => void }
    const emitted: { fileName: string; source: unknown }[] = []
    const bundle = { 'index.html': { type: 'asset', fileName: 'index.html', source: '<html>app</html>' } }
    plugin.generateBundle.call({ emitFile: (f: { fileName: string; source: unknown }) => emitted.push(f) }, {}, bundle)
    expect(emitted.map(f => f.fileName).sort()).toEqual(['swu/index.html', 'xwing/index.html'])
    for (const f of emitted) expect(f.source).toBe('<html>app</html>')
  })

  it('keeps one install, started at the root, with a shortcut to each game', () => {
    expect(PWA_MANIFEST.start_url).toBe('.')
    expect(PWA_MANIFEST.shortcuts?.map(s => [s.short_name, s.url])).toEqual([['SWU', 'swu/'], ['X-Wing', 'xwing/']])
  })

  /**
   * Offline, a screen shows only the images the service worker precached. `public/` is copied
   * to the build as it is, so running Workbox's own manifest step over it with the app's
   * patterns lists exactly the `public/` files the installed app holds.
   */
  describe('offline images', () => {
    const precached = async (globPatterns: string[]) => {
      const { manifestEntries, size } = await getManifest({ globDirectory: 'public', globPatterns })
      return { urls: (manifestEntries ?? []).map(e => e.url).sort(), size }
    }

    it('precaches every image in public/', async () => {
      const all = await precached(['**/*'])
      const images = all.urls.filter(url => /\.(png|svg)$/.test(url))
      expect(images.length).toBeGreaterThan(0)
      const { urls } = await precached(PWA_WORKBOX.globPatterns ?? [])
      expect(urls).toEqual(expect.arrayContaining(images))
    })

    it('precaches the splash, game select and SWU game images by name', async () => {
      const { urls } = await precached(PWA_WORKBOX.globPatterns ?? [])
      expect(urls).toEqual(expect.arrayContaining([
        'dmgCtrl-icon-transparent-192.png',
        'Star-Wars-Unlimited-logo-white.png',
        'Star-Wars-X-wing-logo.png',
        'aggression.png', 'command.png', 'cunning.png', 'heroism.png', 'vigilance.png', 'villainy.png',
        'dmgCtrl-force-token.png',
        'dmgctrl-icon-192-white.svg',
      ]))
    })

    /** Every install downloads the precache in full, so an image added here costs every player. */
    it('keeps the public/ images under 500 KB', async () => {
      const { size } = await precached(PWA_WORKBOX.globPatterns ?? [])
      expect(size).toBeLessThan(500_000)
    })
  })

  /** Gating one plugin must not disturb the others. */
  it('keeps the rest of the plugins in every case', () => {
    for (const env of [serve, build]) {
      expect(pluginNames(env)).toEqual(expect.arrayContaining(['markdown', 'vite:react-babel']))
    }
  })
})
