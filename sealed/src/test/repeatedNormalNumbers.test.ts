// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { db } from '../data/db'
import { cardId, getCard, SWU_DB_API, type SwuCard } from '../data/cards'
import { asCardId, buildPrintingIndex, canonicaliseCards } from '../data/printings'
import { reprintCanonicalId } from '../data/reprints'
import { BUNDLED_SET_CODES, bundledSetCards } from '../data/bundledSets'
import { buildCardDb } from '../engine/cardDb'
import { getCardDefinition } from '../engine/abilities'
import { defeatUnit } from '../engine/combat'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit } from './helpers/engineFixtures'
import ibhSet from './fixtures/ibhSet.json'

/**
 * A card printed at more than one Normal number within a set. IBH prints 38 of its 51 cards at two
 * or three (Admiral Ozzel is IBH 82 and IBH 85), and the copies differ in nothing a game reads: the
 * number, the art, the price. The engine knows each card by the lowest of its numbers, which is the
 * row the bundled set keeps, so every other number has to resolve to that one or the card arrives
 * with no ability.
 *
 * The rows are stored and listed in the order of their ids as text (IBH_102 before IBH_74), so the
 * lowest number is neither reliably first nor reliably last.
 */

const IBH = ibhSet as unknown as SwuCard[]
const bundled = (number: string) => {
  const row = IBH.find(c => c.Number === number)
  if (!row) throw new Error(`IBH ${number} is not in the fixture`)
  return row
}
/** A further Normal printing of a bundled card, as the card API serves it. */
const reprintedAt = (card: SwuCard, number: string): SwuCard => ({
  ...card,
  Number: number,
  VariantType: 'Normal',
  FrontArt: `https://cdn.swu-db.com/images/cards/${card.Set}/${number}.png`,
})

const OZZEL = bundled('82')
const OZZEL_AGAIN = reprintedAt(OZZEL, '85')
const PROOF = bundled('74') // I Want Proof, Not Leads
const PROOF_AGAIN = reprintedAt(PROOF, '102')
const PIETT = bundled('60')

const cache = async (...cards: SwuCard[]) => {
  for (const c of cards) await db.cards.put({ id: cardId(c.Set, c.Number), json: c, fetchedAt: 1 })
}

/** The card API answering for single cards only, and only the ones given: the set listing is out of reach. */
const servingOnly = (...cards: SwuCard[]) =>
  vi.fn((url: string) => {
    const card = cards.find(c => url === `${SWU_DB_API}/cards/${c.Set}/${c.Number}`)
    return card ? Promise.resolve(new Response(JSON.stringify(card))) : Promise.reject(new TypeError('Failed to fetch'))
  })

/** Hydrate ids the way a game does: each card fetched, then every printing collapsed onto its canonical id. */
async function hydrate(...numbers: string[]) {
  const cards: SwuCard[] = []
  for (const number of numbers) cards.push(await getCard('IBH', number))
  const { map, unresolved } = await canonicaliseCards(cards)
  const canonical = (number: string) => map.get(cardId('IBH', number))
  const cardDb = buildCardDb(cards.map(card => asCardId(card, map.get(cardId(card.Set, card.Number))!)))
  return { canonical, unresolved, cardDb }
}

beforeEach(async () => {
  await db.cards.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('buildPrintingIndex, a card at two Normal numbers', () => {
  it('keeps the lower number, whichever row comes first', () => {
    expect(buildPrintingIndex([OZZEL, OZZEL_AGAIN]).get('unit|admiral ozzel|as clumsy as he is stupid')).toBe('IBH_82')
    expect(buildPrintingIndex([OZZEL_AGAIN, OZZEL]).get('unit|admiral ozzel|as clumsy as he is stupid')).toBe('IBH_82')
  })

  it('reads the numbers as numbers, so 74 is lower than 102', () => {
    expect(buildPrintingIndex([PROOF_AGAIN, PROOF]).get('event|i want proof, not leads|')).toBe('IBH_74')
    expect(buildPrintingIndex([PROOF, PROOF_AGAIN]).get('event|i want proof, not leads|')).toBe('IBH_74')
  })
})

describe('an IBH card named by either of its numbers', () => {
  it('resolves to the registered number when the whole set is cached, both rows of it', async () => {
    vi.stubGlobal('fetch', servingOnly())
    await cache(OZZEL, OZZEL_AGAIN, PROOF, PROOF_AGAIN)

    const { canonical, unresolved } = await hydrate('82', '85', '74', '102')

    expect(canonical('82')).toBe('IBH_82')
    expect(canonical('85')).toBe('IBH_82')
    expect(canonical('74')).toBe('IBH_74')
    expect(canonical('102')).toBe('IBH_74')
    expect(unresolved).toEqual([])
  })

  it('resolves to the registered number on a first visit, where only the second number is fetched', async () => {
    // The bundled set holds IBH 82, so IBH 85 is the one card the network is asked for, and the one
    // row the cache then holds.
    vi.stubGlobal('fetch', servingOnly(OZZEL_AGAIN))

    const { canonical, unresolved } = await hydrate('85', '82', '60')

    expect(canonical('85')).toBe('IBH_82')
    expect(canonical('82')).toBe('IBH_82')
    expect(canonical('60')).toBe('IBH_60')
    expect(unresolved).toEqual([])
  })

  it.each(['82', '85'])('has its When Defeated on a board when the deck names IBH %s', async number => {
    vi.stubGlobal('fetch', servingOnly(OZZEL_AGAIN))
    await cache(OZZEL, OZZEL_AGAIN)

    const { canonical, cardDb } = await hydrate(number, '60')
    const id = canonical(number)!

    const board = state({
      cards: cardDb,
      players: {
        player: player({ units: [unit('ozzel', id)] }),
        opponent: player({ hand: [cardId(PIETT.Set, PIETT.Number)] }),
      },
    })
    const after = defeatUnit(board, 'ozzel')

    // The unit leaves play either way; what an unregistered id loses is the discard it forces.
    expect(after.players.player.units).toEqual([])
    expect(after.pendingChoices?.[0], `${id} on a board`).toMatchObject({ kind: 'selectDiscard', controller: 'opponent', count: 1 })
    expect(getCardDefinition(id), `${id} has a registered ability`).toBeDefined()
  })
})

describe('a set with part of it cached', () => {
  /**
   * The cache holds whatever was fetched one card at a time, which is rarely the whole set, and a
   * bundled card is never copied into it. So a cached row or two must not stand for the set: the
   * cards beside it are in the bundled set, at the ids the engine knows them by.
   */
  it.each(BUNDLED_SET_CODES)('%s: every bundled card still resolves to itself, with nothing reported', async set => {
    vi.stubGlobal('fetch', servingOnly())
    const cards = await bundledSetCards(set)
    await cache({ ...cards[0], VariantType: 'Normal' })

    const { map, unresolved } = await canonicaliseCards(cards)

    const moved = cards
      .map(c => cardId(c.Set, c.Number))
      .filter(id => map.get(id) !== (reprintCanonicalId(id) ?? id))
    expect(moved).toEqual([])
    expect(unresolved).toEqual([])
  })

  it.each(BUNDLED_SET_CODES)('%s: a cached copy at a higher number does not take the card over', async set => {
    vi.stubGlobal('fetch', servingOnly())
    const cards = await bundledSetCards(set)
    const card = cards.find(c => c.Type === 'Unit')!
    const copy = reprintedAt(card, '9999')
    await cache(copy)

    const { map } = await canonicaliseCards([copy])

    const id = cardId(card.Set, card.Number)
    expect(map.get(cardId(set, '9999'))).toBe(reprintCanonicalId(id) ?? id)
  })
})
