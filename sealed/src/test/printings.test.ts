import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { db } from '../data/db'
import { printingKey, buildPrintingIndex, canonicaliseCards } from '../data/printings'
import type { SwuCard } from '../data/cards'

/**
 * A card is printed several ways (Normal, Hyperspace, foil, prestige, showcase…), each with its
 * own collector number, and ProtectThePod exports the printing you actually own. Abilities,
 * corrections and the unique rule are all keyed by card id, so a non-Normal printing was
 * unregistered and played vanilla (#382-#385).
 *
 * The set listing returns Normal printings only, so `Type|Name|Subtitle` is the join back.
 */

const NORMAL: SwuCard[] = [
  { Set: 'ASH', Number: '044', Name: 'Barriss Offee', Type: 'Unit', VariantType: 'Normal' } as SwuCard,
  { Set: 'ASH', Number: '045', Name: 'Reanimated Night Trooper', Type: 'Unit', VariantType: 'Normal' } as SwuCard,
  // A name shared by a leader and a unit: the key has to include the type.
  { Set: 'ASH', Number: '011', Name: 'Cad Bane', Type: 'Leader', Subtitle: 'He Who Gets Paid', VariantType: 'Normal' } as SwuCard,
  { Set: 'ASH', Number: '120', Name: 'Cad Bane', Type: 'Unit', VariantType: 'Normal' } as SwuCard,
]

const hyperspaceBarriss = { Set: 'ASH', Number: '308', Name: 'Barriss Offee', Type: 'Unit', VariantType: 'Hyperspace' } as SwuCard

describe('printingKey', () => {
  it('keys on type, name and subtitle so printings of one card agree', () => {
    expect(printingKey(hyperspaceBarriss)).toBe(printingKey(NORMAL[0]))
  })

  it('separates a leader from a unit of the same name', () => {
    expect(printingKey(NORMAL[2])).not.toBe(printingKey(NORMAL[3]))
  })
})

describe('buildPrintingIndex', () => {
  it('maps each card to its Normal printing’s id', () => {
    const index = buildPrintingIndex(NORMAL)
    expect(index.get(printingKey(hyperspaceBarriss))).toBe('ASH_044')
  })

  it('ignores non-Normal rows, so a variant can never become the canonical id', () => {
    const index = buildPrintingIndex([hyperspaceBarriss, ...NORMAL])
    expect(index.get(printingKey(hyperspaceBarriss))).toBe('ASH_044')
  })
})

describe('canonicaliseCards', () => {
  const unknown = { Set: 'ASH', Number: '999', Name: 'Not In This Set', Type: 'Unit', VariantType: 'Hyperspace' } as SwuCard

  beforeEach(async () => {
    await db.cards.clear()
    for (const c of NORMAL) await db.cards.put({ id: `${c.Set}_${c.Number}`, json: c, fetchedAt: 1 })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('rewrites a variant id to its Normal printing, from the card cache', async () => {
    const { map, unresolved } = await canonicaliseCards([hyperspaceBarriss, NORMAL[1]])
    expect(map.get('ASH_308')).toBe('ASH_044')
    expect(map.get('ASH_045')).toBe('ASH_045') // already canonical
    expect(unresolved).toEqual([])
  })

  it('fetches the set listing when the cache has no Normal printings for it', async () => {
    await db.cards.clear()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ data: NORMAL }) })
    vi.stubGlobal('fetch', fetchMock)

    const { map } = await canonicaliseCards([hyperspaceBarriss])
    expect(map.get('ASH_308')).toBe('ASH_044')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  /**
   * Offline, or a set we cannot list: the game must still play. The id is left alone (today's
   * behaviour), and the affected cards are reported so they can be surfaced rather than silently
   * playing vanilla.
   */
  it('leaves ids alone and reports them when no index can be built', async () => {
    await db.cards.clear()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const { map, unresolved } = await canonicaliseCards([hyperspaceBarriss])
    expect(map.get('ASH_308')).toBe('ASH_308')
    expect(unresolved).toEqual([{ id: 'ASH_308', name: 'Barriss Offee', reason: 'no-index' }])
  })

  it('reports a card the index does not know, without failing the others', async () => {
    const { map, unresolved } = await canonicaliseCards([unknown, hyperspaceBarriss])
    expect(map.get('ASH_308')).toBe('ASH_044') // the rest still resolve
    expect(unresolved.map(u => u.id)).toEqual(['ASH_999'])
    expect(unresolved[0].reason).toBe('unknown-card')
  })

  it('asks for each set only once, however many cards come from it', async () => {
    await db.cards.clear()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ data: NORMAL }) })
    vi.stubGlobal('fetch', fetchMock)

    await canonicaliseCards([hyperspaceBarriss, NORMAL[1], NORMAL[0]])
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
