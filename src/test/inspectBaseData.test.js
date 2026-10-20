// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { fetchSwuDbBases } from '../../scripts/inspect-base-data.mjs'

function swuDbCard(overrides = {}) {
  return { Set: 'SOR', Number: '019', VariantType: 'Normal', ...overrides }
}

describe('fetchSwuDbBases', () => {
  // The proxy's workers.dev address is switched off (proxy/wrangler.toml), so the script has to
  // reach it on its custom domain, as the app does (src/hooks/useBases.ts).
  it('asks the proxy at worker.dmgctrl.app for every base', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }))

    await fetchSwuDbBases(fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith('https://worker.dmgctrl.app/cards/search?q=type:base')
  })

  it('keeps only the normal variants', async () => {
    const normal = swuDbCard()
    const hyperspace = swuDbCard({ VariantType: 'Hyperspace' })
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ data: [normal, hyperspace] }) })

    expect(await fetchSwuDbBases(fetchImpl)).toEqual([normal])
  })

  it('fails with the status when the proxy refuses', async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) })

    await expect(fetchSwuDbBases(fetchImpl)).rejects.toThrow('swu-db proxy failed: 404')
  })
})
