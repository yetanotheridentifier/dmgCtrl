// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

const launched = vi.hoisted(() => ({ options: null, context: null }))
vi.mock('playwright', () => ({
  devices: { 'iPhone 15 Pro landscape': {} },
  chromium: {
    launch: async options => {
      launched.options = options
      return {
        newContext: async options => {
          launched.context = options
          return { addInitScript: async () => {} }
        },
      }
    },
  },
}))

const { launch, parseArgs } = await import('../../scripts/qa-helpers.mjs')

// Playwright and its Chromium test dmgCtrl and nothing else: an old Chromium on the open web is
// exposed to every renderer bug it has not been patched for.
describe('qa-helpers', () => {
  it.each([
    'https://127.0.0.1:5173/', 'http://localhost:4173/', 'https://192.168.1.100:5173/', 'https://10.0.0.5:5173/', 'https://172.20.1.2:5173/',
    'https://dev.dmgctrl.app/', 'https://dmgctrl.app/',
  ])('opens dmgCtrl at %s', url => {
    expect(parseArgs([url]).url).toBe(url)
  })

  it.each([
    'https://example.com/', 'https://dmgctrl.app.example.com/', 'https://evil-dmgctrl.app/', 'http://dmgctrl.app@example.com/',
    'https://8.8.8.8/', 'https://172.32.0.1/', 'https://192.168.1.1.example.com/',
  ])('refuses anywhere else: %s', url => {
    expect(() => parseArgs([url])).toThrow(/only tests dmgCtrl/)
  })

  it('runs Chromium in its sandbox', async () => {
    await launch({ url: 'https://dmgctrl.app/', headless: true })
    expect(launched.options.chromiumSandbox).toBe(true)
  })

  it('ignores certificate errors only on a local server', async () => {
    await launch({ url: 'https://127.0.0.1:5173/', headless: true })
    expect(launched.context.ignoreHTTPSErrors).toBe(true)
    await launch({ url: 'https://192.168.1.100:5173/', headless: true })
    expect(launched.context.ignoreHTTPSErrors).toBe(true)
    await launch({ url: 'https://dmgctrl.app/', headless: true })
    expect(launched.context.ignoreHTTPSErrors).toBe(false)
  })
})
