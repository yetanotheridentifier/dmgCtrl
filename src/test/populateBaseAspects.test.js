import { describe, it, expect } from 'vitest'
import { buildBaseAspects, toLineProtocol } from '../../scripts/populate-base-aspects.mjs'

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
