import { describe, it, expect } from 'vitest'
import type { UserConfig } from 'vite'
import { getManifest } from 'workbox-build'
import config, { SEALED_PWA_MANIFEST, SEALED_PWA_WORKBOX } from '../../vite.config'

/** Vite plugins nest (a plugin may be an array of plugins), so this walks rather than flattening. */
function plugins(): { name?: string }[] {
  const found: { name?: string }[] = []
  const walk = (p: unknown): void => {
    if (Array.isArray(p)) return p.forEach(walk)
    if (p && typeof p === 'object') found.push(p as { name?: string })
  }
  walk((config as UserConfig).plugins)
  return found
}

describe('sealed vite config', () => {
  /**
   * Sealed installs as an app of its own beside dmgCtrl on the same origin: a distinct id, and a
   * scope and start page under /sealed/ so the install opens Sealed and the worker stays there.
   */
  it('installs as its own app under /sealed/', () => {
    expect(SEALED_PWA_MANIFEST.id).toBe('/sealed/')
    expect(SEALED_PWA_MANIFEST.scope).toBe('/sealed/')
    expect(SEALED_PWA_MANIFEST.start_url).toBe('/sealed/')
    expect(SEALED_PWA_MANIFEST.name).toBe('dmgCtrl Sealed')
    expect(SEALED_PWA_MANIFEST.short_name).toBe('Sealed')
    expect(SEALED_PWA_MANIFEST.display).toBe('standalone')
  })

  /** Chrome offers an install only with a 192 and a 512 icon. */
  it('declares the 192 and 512 icons, both shipped in public/', async () => {
    const icons = SEALED_PWA_MANIFEST.icons ?? []
    expect(icons.map(i => i.sizes).sort()).toEqual(['192x192', '512x512'])
    const { manifestEntries } = await getManifest({ globDirectory: 'public', globPatterns: ['**/*'] })
    const shipped = (manifestEntries ?? []).map(e => e.url)
    for (const icon of icons) expect(shipped).toContain(icon.src)
  })

  it('precaches code, pages and the shipped images, every one of public/', async () => {
    expect(SEALED_PWA_WORKBOX.globPatterns).toEqual(['**/*.{js,css,html,png,svg}'])
    const all = await getManifest({ globDirectory: 'public', globPatterns: ['**/*'] })
    const images = (all.manifestEntries ?? []).map(e => e.url).filter(url => /\.(png|svg)$/.test(url))
    expect(images.length).toBeGreaterThan(0)
    const precached = await getManifest({ globDirectory: 'public', globPatterns: SEALED_PWA_WORKBOX.globPatterns ?? [] })
    expect((precached.manifestEntries ?? []).map(e => e.url)).toEqual(expect.arrayContaining(images))
  })

  /** Card data stays in Dexie and full art stays network-only: the worker caches nothing at run time. */
  it('caches nothing at run time', () => {
    expect(SEALED_PWA_WORKBOX.runtimeCaching).toBeUndefined()
  })

  /**
   * Workbox leaves out of the precache, with only a warning, any file over its size limit (2 MiB
   * by default), and the main bundle is not far under that. The limit is set explicitly, and the
   * build fails rather than ship an app that cannot open offline.
   */
  describe('precache size limit', () => {
    const limit = SEALED_PWA_WORKBOX.maximumFileSizeToCacheInBytes ?? 0
    const guard = () => {
      const found = plugins().filter(p => p.name === 'precache-fits')
      expect(found).toHaveLength(1)
      return found[0] as unknown as { generateBundle: (this: unknown, o: unknown, b: unknown) => void }
    }
    const run = (bundle: Record<string, unknown>) => {
      const errors: string[] = []
      const context = { error: (message: string) => { errors.push(message); throw new Error(message) } }
      try { guard().generateBundle.call(context, {}, bundle) } catch { /* recorded in errors */ }
      return errors
    }

    it('sets a limit above the default', () => {
      expect(limit).toBeGreaterThan(2 * 1024 * 1024)
    })

    it('passes a build whose files all fit', () => {
      expect(run({
        'assets/index.js': { type: 'chunk', fileName: 'assets/index.js', code: 'x'.repeat(1000) },
        'index.html': { type: 'asset', fileName: 'index.html', source: '<html></html>' },
      })).toEqual([])
    })

    it('fails a build with a precached file over the limit, naming it', () => {
      const errors = run({
        'assets/index.js': { type: 'chunk', fileName: 'assets/index.js', code: 'x'.repeat(limit + 1) },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('assets/index.js')
    })

    it('ignores a file the precache does not take', () => {
      expect(run({
        'assets/index.js.map': { type: 'asset', fileName: 'assets/index.js.map', source: 'x'.repeat(limit + 1) },
      })).toEqual([])
    })
  })

  it('builds under /sealed/ with the PWA plugin and the size guard', () => {
    expect((config as UserConfig).base).toBe('/sealed/')
    expect(plugins().map(p => p.name)).toEqual(expect.arrayContaining(['vite-plugin-pwa', 'precache-fits']))
  })
})
