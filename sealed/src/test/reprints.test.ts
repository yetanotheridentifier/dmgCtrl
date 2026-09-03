import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { REPRINTS, reprintCanonicalId } from '../data/reprints'

/**
 * Cross-set reprints (#551). A card printed in two sets carries two collector numbers, and every
 * implementation the engine holds is keyed by id, so the SEC printing of Grassroots Resistance was
 * a blank event and the SOR printing of Consortium StarViper granted Restore unconditionally: the
 * `keywords: []` correction that makes it conditional is written against the ASH id.
 *
 * Within a set the printing map already collapses variants onto the Normal id, and it is generated.
 * This table is not: it is declared, one line per card, because a set is added when it is released
 * rather than discovered at runtime.
 *
 * The name is carried alongside the ids so a mistyped canonical id is caught here, against the
 * checked-in ASH listing, rather than by a card quietly playing as something else.
 */

const ASH_BY_ID = new Map((ashSet as unknown as SwuCard[]).map(c => [`${c.Set}_${c.Number}`, c]))
const setOf = (id: string) => id.split('_')[0]

describe('the cross-set reprint table', () => {
  it('gives every canonical id as a real ASH card of that name', () => {
    for (const { name, canonical } of REPRINTS) {
      expect(ASH_BY_ID.get(canonical)?.Name, canonical).toBe(name)
    }
  })

  it('lists only well-formed ids, from sets other than the canonical one', () => {
    for (const { canonical, printings } of REPRINTS) {
      expect(canonical).toMatch(/^[A-Z0-9]+_\d+$/)
      expect(printings.length).toBeGreaterThan(0)
      for (const id of printings) {
        expect(id).toMatch(/^[A-Z0-9]+_\d+$/)
        expect(setOf(id), id).not.toBe(setOf(canonical))
      }
    }
  })

  it('never chains: no printing is itself a canonical id, and no id is listed twice', () => {
    const canonicals = new Set(REPRINTS.map(r => r.canonical))
    const seen = new Set<string>()
    for (const { printings } of REPRINTS) {
      for (const id of printings) {
        expect(canonicals.has(id), `${id} is both a printing and a canonical id`).toBe(false)
        expect(seen.has(id), `${id} is listed twice`).toBe(false)
        seen.add(id)
      }
    }
    expect(canonicals.size).toBe(REPRINTS.length)
  })
})

describe('reprintCanonicalId', () => {
  it('resolves the printings behind #551', () => {
    expect(reprintCanonicalId('SEC_258')).toBe('ASH_258') // Grassroots Resistance
    expect(reprintCanonicalId('SOR_112')).toBe('ASH_122') // Consortium StarViper
  })

  it('returns undefined for a canonical id, so a caller falls back to it unchanged', () => {
    expect(reprintCanonicalId('ASH_258')).toBeUndefined()
  })

  it('returns undefined for a card that is printed in one set only', () => {
    expect(reprintCanonicalId('ASH_044')).toBeUndefined()
    expect(reprintCanonicalId('ZZZ_001')).toBeUndefined()
  })
})
