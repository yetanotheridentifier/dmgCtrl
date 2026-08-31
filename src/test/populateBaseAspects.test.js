import { describe, it, expect, vi } from 'vitest'
import {
  buildBaseAspects,
  toLineProtocol,
  fetchSetCodes,
  fetchSwuDbBases,
} from '../../scripts/populate-base-aspects.mjs'

// Builds a fetch stub that resolves each URL against a map of responses.
// A numeric value is treated as a failing status, an array as a card list.
function stubFetch(routes) {
  return vi.fn(async url => {
    const match = Object.keys(routes).find(k => url.includes(k))
    const value = match === undefined ? 502 : routes[match]
    if (typeof value === 'number') {
      return { ok: false, status: value, json: async () => ({}) }
    }
    return { ok: true, status: 200, json: async () => value }
  })
}

// Minimal swuapi card shape
function swuApiCard(overrides = {}) {
  return {
    uuid: 'abc',
    set_code: 'JTL',
    card_number: 29,
    variant_type: 'Standard',
    aspects: ['Aggression'],
    variant_of_uuid: null,
    ...overrides,
  }
}

// Minimal swu-db card shape
function swuDbCard(overrides = {}) {
  return {
    Set: 'SOR',
    Number: '019',
    Aspects: ['Vigilance'],
    VariantType: 'Normal',
    ...overrides,
  }
}

describe('buildBaseAspects', () => {
  it('extracts baseKey and primary aspect from a swuapi card', () => {
    const result = buildBaseAspects([swuApiCard()], [])
    expect(result).toContainEqual({ baseKey: 'JTL-029', aspect: 'Aggression' })
  })

  it('pads card_number to three digits', () => {
    const result = buildBaseAspects([swuApiCard({ card_number: 5 })], [])
    expect(result[0].baseKey).toBe('JTL-005')
  })

  it('falls back to "None" when swuapi aspects is empty', () => {
    const result = buildBaseAspects([swuApiCard({ aspects: [] })], [])
    expect(result[0].aspect).toBe('None')
  })

  it('falls back to "None" when swuapi aspects is missing', () => {
    const result = buildBaseAspects([swuApiCard({ aspects: undefined })], [])
    expect(result[0].aspect).toBe('None')
  })

  it('uses only the first aspect when multiple are present', () => {
    const result = buildBaseAspects([swuApiCard({ aspects: ['Command', 'Aggression'] })], [])
    expect(result[0].aspect).toBe('Command')
  })

  it('deduplicates swuapi cards with the same set_code and card_number', () => {
    const cards = [swuApiCard(), swuApiCard({ uuid: 'xyz' })]
    const result = buildBaseAspects(cards, [])
    expect(result.filter(b => b.baseKey === 'JTL-029')).toHaveLength(1)
  })

  it('excludes non-Standard swuapi variants', () => {
    const cards = [swuApiCard({ variant_type: 'Hyperspace' })]
    const result = buildBaseAspects(cards, [])
    expect(result).toHaveLength(0)
  })

  it('includes swu-db cards for sets not present in swuapi', () => {
    const result = buildBaseAspects([], [swuDbCard()])
    expect(result).toContainEqual({ baseKey: 'SOR-019', aspect: 'Vigilance' })
  })

  it('excludes swu-db cards for sets already covered by swuapi', () => {
    const result = buildBaseAspects(
      [swuApiCard({ set_code: 'SOR', card_number: 19 })],
      [swuDbCard()]
    )
    expect(result.filter(b => b.baseKey === 'SOR-019')).toHaveLength(1)
  })

  it('falls back to "None" when swu-db Aspects is empty', () => {
    const result = buildBaseAspects([], [swuDbCard({ Aspects: [] })])
    expect(result[0].aspect).toBe('None')
  })
})

describe('fetchSetCodes', () => {
  it('returns every set code swuapi lists', async () => {
    const fetchImpl = stubFetch({
      '/sets': { sets: [{ code: 'SOR' }, { code: 'SHD' }, { code: 'TWI' }] },
    })
    await expect(fetchSetCodes(fetchImpl)).resolves.toEqual(['SOR', 'SHD', 'TWI'])
  })

  it('throws when swuapi cannot serve the set list', async () => {
    const fetchImpl = stubFetch({ '/sets': 500 })
    await expect(fetchSetCodes(fetchImpl)).rejects.toThrow('swuapi sets fetch failed: 500')
  })
})

describe('fetchSwuDbBases', () => {
  const sorCard = swuDbCard()
  const shdCard = swuDbCard({ Set: 'SHD', Number: '021', Aspects: ['Command'] })

  it('issues one scoped request per set code', async () => {
    const fetchImpl = stubFetch({
      'set:sor': { data: [sorCard] },
      'set:shd': { data: [shdCard] },
    })
    await fetchSwuDbBases(['SOR', 'SHD'], fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const urls = fetchImpl.mock.calls.map(c => c[0])
    expect(urls[0]).toContain('type:base+set:sor')
    expect(urls[1]).toContain('type:base+set:shd')
  })

  it('collects cards from every set that responds', async () => {
    const fetchImpl = stubFetch({
      'set:sor': { data: [sorCard] },
      'set:shd': { data: [shdCard] },
    })
    const { cards, skipped } = await fetchSwuDbBases(['SOR', 'SHD'], fetchImpl)

    expect(cards).toEqual([sorCard, shdCard])
    expect(skipped).toEqual([])
  })

  // The HMW regression: one set 502s while the rest are healthy.
  it('skips a set the API cannot serve and keeps the others', async () => {
    const fetchImpl = stubFetch({
      'set:sor': { data: [sorCard] },
      'set:hmw': 502,
      'set:shd': { data: [shdCard] },
    })
    const { cards, skipped } = await fetchSwuDbBases(['SOR', 'HMW', 'SHD'], fetchImpl)

    expect(cards).toEqual([sorCard, shdCard])
    expect(skipped).toEqual(['HMW'])
  })

  it('does not throw when every set fails', async () => {
    const fetchImpl = stubFetch({ 'set:sor': 502, 'set:shd': 502 })
    const { cards, skipped } = await fetchSwuDbBases(['SOR', 'SHD'], fetchImpl)

    expect(cards).toEqual([])
    expect(skipped).toEqual(['SOR', 'SHD'])
  })

  it('excludes non-Normal variants', async () => {
    const foil = swuDbCard({ Number: '020', VariantType: 'Foil' })
    const fetchImpl = stubFetch({ 'set:sor': { data: [sorCard, foil] } })
    const { cards } = await fetchSwuDbBases(['SOR'], fetchImpl)

    expect(cards).toEqual([sorCard])
  })

  it('treats a set with no data array as empty rather than failing', async () => {
    const fetchImpl = stubFetch({ 'set:sor': {} })
    const { cards, skipped } = await fetchSwuDbBases(['SOR'], fetchImpl)

    expect(cards).toEqual([])
    expect(skipped).toEqual([])
  })
})

describe('toLineProtocol', () => {
  const TS = 1746000000

  it('produces correct line protocol for a standard base', () => {
    expect(toLineProtocol('JTL-029', 'Aggression', TS)).toBe(
      'base_aspects,baseKey=JTL-029 aspect="Aggression" 1746000000'
    )
  })

  it('produces correct line protocol for a None aspect', () => {
    expect(toLineProtocol('SOR-025', 'None', TS)).toBe(
      'base_aspects,baseKey=SOR-025 aspect="None" 1746000000'
    )
  })

  it('escapes spaces in baseKey tag value', () => {
    const line = toLineProtocol('KEY WITH SPACES', 'Command', TS)
    expect(line).toContain('baseKey=KEY\\ WITH\\ SPACES')
  })

  it('escapes commas in baseKey tag value', () => {
    const line = toLineProtocol('KEY,ONE', 'Command', TS)
    expect(line).toContain('baseKey=KEY\\,ONE')
  })
})
