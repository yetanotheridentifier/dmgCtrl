// @vitest-environment jsdom
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
 *
 * Fixtures below use a made-up set (`ZZZ`) rather than real ASH ids, deliberately: ASH now has a
 * bundled printing map (`data/printingMaps/ash.json`, #389) that resolves its real ids before any
 * of this cache/network machinery runs, so a fixture using real ASH ids would no longer be
 * exercising the dynamic path these tests are about. The bundled fast path itself, using real ASH
 * ids, is covered separately below and in `bundledPrintings.test.ts`.
 */

const NORMAL: SwuCard[] = [
  { Set: 'ZZZ', Number: '044', Name: 'Barriss Offee', Type: 'Unit', VariantType: 'Normal' } as SwuCard,
  { Set: 'ZZZ', Number: '045', Name: 'Reanimated Night Trooper', Type: 'Unit', VariantType: 'Normal' } as SwuCard,
  // A name shared by a leader and a unit: the key has to include the type.
  { Set: 'ZZZ', Number: '011', Name: 'Cad Bane', Type: 'Leader', Subtitle: 'He Who Gets Paid', VariantType: 'Normal' } as SwuCard,
  { Set: 'ZZZ', Number: '120', Name: 'Cad Bane', Type: 'Unit', VariantType: 'Normal' } as SwuCard,
]

const hyperspaceBarriss = { Set: 'ZZZ', Number: '308', Name: 'Barriss Offee', Type: 'Unit', VariantType: 'Hyperspace' } as SwuCard

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
    expect(index.get(printingKey(hyperspaceBarriss))).toBe('ZZZ_044')
  })

  it('ignores non-Normal rows, so a variant can never become the canonical id', () => {
    const index = buildPrintingIndex([hyperspaceBarriss, ...NORMAL])
    expect(index.get(printingKey(hyperspaceBarriss))).toBe('ZZZ_044')
  })
})

describe('canonicaliseCards', () => {
  const unknown = { Set: 'ZZZ', Number: '999', Name: 'Not In This Set', Type: 'Unit', VariantType: 'Hyperspace' } as SwuCard

  beforeEach(async () => {
    await db.cards.clear()
    for (const c of NORMAL) await db.cards.put({ id: `${c.Set}_${c.Number}`, json: c, fetchedAt: 1 })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('rewrites a variant id to its Normal printing, from the card cache', async () => {
    const { map, unresolved } = await canonicaliseCards([hyperspaceBarriss, NORMAL[1]])
    expect(map.get('ZZZ_308')).toBe('ZZZ_044')
    expect(map.get('ZZZ_045')).toBe('ZZZ_045') // already canonical
    expect(unresolved).toEqual([])
  })

  it('fetches the set listing when the cache has no Normal printings for it', async () => {
    await db.cards.clear()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ data: NORMAL }) })
    vi.stubGlobal('fetch', fetchMock)

    const { map } = await canonicaliseCards([hyperspaceBarriss])
    expect(map.get('ZZZ_308')).toBe('ZZZ_044')
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
    expect(map.get('ZZZ_308')).toBe('ZZZ_308')
    expect(unresolved).toEqual([{ id: 'ZZZ_308', name: 'Barriss Offee', reason: 'no-index' }])
  })

  it('reports a card the index does not know, without failing the others', async () => {
    const { map, unresolved } = await canonicaliseCards([unknown, hyperspaceBarriss])
    expect(map.get('ZZZ_308')).toBe('ZZZ_044') // the rest still resolve
    expect(unresolved.map(u => u.id)).toEqual(['ZZZ_999'])
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

/**
 * The cross-set tier (#551). A card printed in two sets is two ids, and the per-set join above can
 * never bridge them: `SEC_258` is already the Normal printing of Grassroots Resistance, so it
 * resolved to itself and played with no ability at all. The declared reprint table names the
 * implemented printing outright, which also means it needs no index and works offline.
 */
describe('canonicaliseCards, cross-set reprints (#551)', () => {
  const grassrootsSec = { Set: 'SEC', Number: '258', Name: 'Grassroots Resistance', Type: 'Event', VariantType: 'Normal' } as SwuCard
  const grassrootsSecVariant = { ...grassrootsSec, Number: '480', VariantType: 'Hyperspace' } as SwuCard
  const starViperSor = { Set: 'SOR', Number: '112', Name: 'Consortium StarViper', Type: 'Unit', VariantType: 'Normal' } as SwuCard

  afterEach(() => vi.unstubAllGlobals())

  it('rewrites a reprint onto the implemented printing with no cache or network', async () => {
    await db.cards.clear()
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('must not be called: a declared reprint names its canonical id outright')
    }))

    const { map, unresolved } = await canonicaliseCards([grassrootsSec, starViperSor])
    expect(map.get('SEC_258')).toBe('ASH_258')
    expect(map.get('SOR_112')).toBe('ASH_122')
    expect(unresolved).toEqual([])
  })

  /** Both tiers in order: the SEC listing collapses the variant onto SEC_258, the table onto ASH. */
  it('carries a variant printing of a reprint through the within-set tier first', async () => {
    await db.cards.clear()
    await db.cards.put({ id: 'SEC_258', json: grassrootsSec, fetchedAt: 1 })

    const { map, unresolved } = await canonicaliseCards([grassrootsSecVariant])
    expect(map.get('SEC_480')).toBe('ASH_258')
    expect(unresolved).toEqual([])
  })

  it('leaves a card with no reprint entry on its own id', async () => {
    await db.cards.clear()
    for (const c of NORMAL) await db.cards.put({ id: `${c.Set}_${c.Number}`, json: c, fetchedAt: 1 })

    const { map } = await canonicaliseCards([NORMAL[1]])
    expect(map.get('ZZZ_045')).toBe('ZZZ_045')
  })
})

/**
 * The bundled fast path (#389): a known ASH printing resolves without ever touching the card cache
 * or the network. The actual bug was an INCOMPLETE cache silently short-circuiting the dynamic
 * fallback before it reached the network (a non-empty but incomplete `Map` isn't `undefined`, so
 * `??` never fell through), so bundling removes that race for every id we ship data for. Uses the
 * exact three printings from #389's filed report.
 */
describe('canonicaliseCards, bundled ASH fast path (#389)', () => {
  const barrissHyperspace = { Set: 'ASH', Number: '308', Name: 'Barriss Offee', Subtitle: 'Redeeming Herself', Type: 'Unit', VariantType: 'Hyperspace' } as SwuCard
  const barrissHyperspaceFoil = { Set: 'ASH', Number: '546', Name: 'Barriss Offee', Subtitle: 'Redeeming Herself', Type: 'Unit', VariantType: 'Hyperspace Foil' } as SwuCard
  const covertBelieversHyperspace = { Set: 'ASH', Number: '344', Name: 'Covert Believers', Type: 'Unit', VariantType: 'Hyperspace' } as SwuCard

  afterEach(() => vi.unstubAllGlobals())

  it('resolves real ASH variants with an empty cache and no network, even offline', async () => {
    await db.cards.clear()
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('must not be called: a bundled id should never need cache or network')
    }))

    const { map, unresolved } = await canonicaliseCards([barrissHyperspace, barrissHyperspaceFoil, covertBelieversHyperspace])
    expect(map.get('ASH_308')).toBe('ASH_044')
    expect(map.get('ASH_546')).toBe('ASH_044')
    expect(map.get('ASH_344')).toBe('ASH_080')
    expect(unresolved).toEqual([])
  })
})
