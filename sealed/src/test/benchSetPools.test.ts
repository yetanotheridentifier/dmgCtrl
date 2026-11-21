import { describe, it, expect, vi, afterEach } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import ashSet from './fixtures/ashSet.json'
import { fromSwuApiRow, type SwuApiCard, type SwuCard } from '../data/cards'
import { SET_PROGRESS } from '../data/implementedCards'
import { CARD_DATA_CORRECTIONS } from '../engine/cardDataCorrections'
import {
  SEALED_MIN_CARDS, SEALED_SET_CODES, SET_CODES, artOffRule, fetchSwuApiSet, fillFromSwuApi, fixtureFile, poolFor,
  resolveSealedSets, resolveSetCodes, toFixture,
} from '../bench/setPools'

/**
 * The card pools the bench can draw on: one fixture per set, and the rules for naming a list of them.
 *
 * The fixtures are written by `--fixture` from the live card API, so these tests are what stand
 * between a changed API response and a silently different pool. The counts are checked against the
 * per-set totals the setup panel shows, which were recorded from the same listing: agreement confirms
 * the fixture was filtered the same way (Normal printings, one row per card, no tokens), not that the
 * listing itself is right.
 */

const ASH = ashSet as unknown as SwuCard[]

describe('set codes', () => {
  it('lists every set the setup panel counts, in its order', () => {
    expect(SET_CODES).toEqual(SET_PROGRESS.map(s => s.code))
    expect(SET_CODES).toHaveLength(12)
    expect(SET_CODES[0]).toBe('HMW')
  })

  it('resolves a request into the canonical order, whatever order it was typed in', () => {
    // A run should be a function of which sets it drew on, not of how they were typed: the order
    // decides which decks play first, and so which games open on which seat.
    expect(resolveSetCodes(['SEC', 'LAW'])).toEqual(['LAW', 'SEC'])
  })

  it('ignores case and repeats', () => {
    expect(resolveSetCodes(['law', 'LAW', 'Ash'])).toEqual(['ASH', 'LAW'])
  })

  it('expands all to every set', () => {
    expect(resolveSetCodes(['all'])).toEqual(SET_CODES)
  })

  it('refuses a set it has no pool for, naming it', () => {
    expect(() => resolveSetCodes(['LAW', 'XYZ'])).toThrow('Unknown set: XYZ')
  })

  it('refuses an empty request', () => {
    expect(() => resolveSetCodes([])).toThrow('at least one set')
  })
})

/**
 * Sets too small for sealed. A sealed deck is built from a pool opened from one set, and a product with
 * fewer than 150 cards is too small for that: IBH's 51 cards built a coverage deck of 3. The rule is
 * a card count rather than a list, so a small product released later is left out without anyone
 * remembering to add it, and a large one that was not designed for sealed (IC27, about 192 cards once
 * fully released) still qualifies.
 */
describe('sealed sets', () => {
  it('leaves out every set below the minimum, and only those', () => {
    for (const code of SET_CODES) {
      expect(SEALED_SET_CODES.includes(code), code).toBe(poolFor([code]).length >= SEALED_MIN_CARDS)
    }
  })

  it('sets the minimum at 150, between the largest small product and a full Icons release', () => {
    expect(SEALED_MIN_CARDS).toBe(150)
    expect(poolFor(['TS26']).length).toBeLessThan(SEALED_MIN_CARDS)
    expect(192).toBeGreaterThanOrEqual(SEALED_MIN_CARDS)
  })

  it('keeps the nine booster sets and leaves out TS26, IBH and IC27 while its fixture is short', () => {
    expect(SET_CODES).toContain('IC27')
    expect(poolFor(['IC27']).length).toBeLessThan(SEALED_MIN_CARDS)
    expect(SEALED_SET_CODES).toEqual(['HMW', 'ASH', 'LAW', 'SEC', 'LOF', 'JTL', 'TWI', 'SHD', 'SOR'])
  })

  it('expands all to the sealed sets', () => {
    expect(resolveSealedSets(['all'])).toEqual(SEALED_SET_CODES)
  })

  it('refuses a set too small for sealed by name, saying why', () => {
    expect(() => resolveSealedSets(['LAW', 'IBH'])).toThrow('IBH has 51 cards')
  })

  it('otherwise resolves as resolveSetCodes does', () => {
    expect(resolveSealedSets(['sec', 'law'])).toEqual(['LAW', 'SEC'])
    expect(() => resolveSealedSets(['XYZ'])).toThrow('Unknown set: XYZ')
  })
})

describe('toFixture', () => {
  /** A row as `cards/search?q=set:` returns it: aspects and traits wrapped, plus fields the engine never reads. */
  const apiRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    Set: 'LAW', Number: '010', Name: 'Test Unit', Subtitle: 'Of Tests', Type: 'Unit',
    Aspects: [{ S: 'Command' }, { S: 'Villainy' }], Traits: [{ S: 'IMPERIAL' }], Arenas: ['Ground'],
    cid: '123', Cost: '3', Power: '2', HP: '4', FrontText: 'Sentinel', DoubleSided: false,
    Rarity: 'Common', Unique: false, Keywords: ['Sentinel'], Artist: 'Someone', VariantType: 'Normal',
    MarketPrice: '0.10', FoilPrice: '', FrontArt: 'https://cdn.example/LAW/010.png', tcgplayerId: '1', LowPrice: '0.01',
    ...over,
  })

  it('reproduces the ASH fixture exactly, key order included', () => {
    // Fixtures are committed as written, so a change of shape or key order is a diff on every card.
    expect(JSON.stringify(toFixture(ASH))).toBe(JSON.stringify(ASH))
  })

  it('unwraps aspects and traits, and keeps only the fixture fields in the fixture order', () => {
    expect(JSON.stringify(toFixture([apiRow()]))).toBe(JSON.stringify([{
      Set: 'LAW', Number: '010', Name: 'Test Unit', Subtitle: 'Of Tests', Type: 'Unit', Cost: '3', Power: '2', HP: '4',
      Arenas: ['Ground'], Aspects: ['Command', 'Villainy'], Traits: ['IMPERIAL'], Keywords: ['Sentinel'],
      Unique: false, FrontText: 'Sentinel', Rarity: 'Common',
    }]))
  })

  it('omits a field the row does not carry rather than inventing one', () => {
    const [base] = toFixture([apiRow({ Type: 'Base', Traits: undefined, Keywords: undefined, Power: undefined })])
    expect('Traits' in base).toBe(false)
    expect('Keywords' in base).toBe(false)
    expect('Power' in base).toBe(false)
  })

  it('drops tokens and non-Normal printings', () => {
    const rows = [
      apiRow(),
      apiRow({ Number: '300', VariantType: 'Hyperspace' }),
      apiRow({ Number: 'T01', Name: 'Shield', Subtitle: undefined, Type: 'Token' }),
      // IC27's listing files its tokens by what they are, not as plain `Token`.
      apiRow({ Number: 'T02', Name: 'Experience', Subtitle: undefined, Type: 'Token Upgrade' }),
      apiRow({ Number: 'T03', Name: 'Clone Trooper', Subtitle: undefined, Type: 'Token Unit' }),
    ]
    expect(toFixture(rows).map(c => c.Number)).toEqual(['010'])
  })

  it('collapses one card printed at several numbers in a set onto its lowest number', () => {
    // IBH prints single cards at up to three collector numbers: 104 slots, 51 cards.
    const rows = [apiRow({ Set: 'IBH', Number: '89' }), apiRow({ Set: 'IBH', Number: '70' }), apiRow({ Set: 'IBH', Number: '103' })]
    expect(toFixture(rows).map(c => c.Number)).toEqual(['70'])
  })

  /**
   * A fixture keeps no art fields, and the app ships the fixtures: it names each card's art from its
   * set and number instead. That holds only while the card API files art that way, so writing a
   * fixture checks the listing it was written from and names any row that does not.
   */
  describe('the art the listing names', () => {
    const art = (path: string) => `https://cdn.swu-db.com/images/cards/${path}.png`

    it('is where the app looks for it: under the set and number, a leader\'s back with -b', () => {
      const rows = [
        apiRow({ FrontArt: art('LAW/010') }),
        apiRow({ Number: '005', Type: 'Leader', FrontArt: art('LAW/005'), BackArt: art('LAW/005-b') }),
      ]
      expect(artOffRule(rows)).toEqual([])
    })

    it('names a row filed anywhere else, or a back the app would not expect', () => {
      // Named apart, since rows that share a name are one card and a fixture keeps one of them.
      const rows = [
        apiRow({ FrontArt: art('LAW/010') }),
        apiRow({ Number: '011', Name: 'Filed Elsewhere', FrontArt: 'https://cdn.example/LAW/011.png' }),
        apiRow({ Number: '005', Name: 'Odd Back', Type: 'Leader', FrontArt: art('LAW/005'), BackArt: art('LAW/005-back') }),
        apiRow({ Number: '006', Name: 'No Back', Type: 'Leader', FrontArt: art('LAW/006') }),
        apiRow({ Number: '012', Name: 'Unit With A Back', FrontArt: art('LAW/012'), BackArt: art('LAW/012-b') }),
      ]
      expect(artOffRule(rows)).toEqual(['LAW_011', 'LAW_005', 'LAW_006', 'LAW_012'])
    })

    it('reads only the rows a fixture keeps', () => {
      const rows = [
        apiRow({ Number: '300', VariantType: 'Hyperspace', FrontArt: 'https://cdn.example/LAW/300.png' }),
        apiRow({ Number: 'T01', Name: 'Shield', Subtitle: undefined, Type: 'Token', FrontArt: 'https://cdn.example/LAW/T01.png' }),
      ]
      expect(artOffRule(rows)).toEqual([])
    })
  })

  it('keeps a card printed in two sets as two cards', () => {
    // Abilities register per id, so a cross-set reprint belongs to each set's own pool.
    expect(toFixture([apiRow({ Set: 'LAW' }), apiRow({ Set: 'SEC' })]).map(c => c.Set)).toEqual(['LAW', 'SEC'])
  })
})

describe('the bundled fixtures', () => {
  it.each(SET_PROGRESS.map(s => [s.code, s.total] as const))('%s matches the printed card counts', (code, total) => {
    const counts: Record<string, number> = {}
    // A card whose type the listing gets wrong is counted as the type it is printed with, which is
    // what the totals record (Snapshot Reflexes: listed in SOR as an event, printed as an upgrade).
    const printedType = (c: SwuCard): string => {
      const corrected = CARD_DATA_CORRECTIONS[`${c.Set}_${c.Number}`]?.type
      return corrected ? corrected[0].toUpperCase() + corrected.slice(1) : c.Type
    }
    for (const c of poolFor([code])) counts[printedType(c)] = (counts[printedType(c)] ?? 0) + 1
    const expected = Object.fromEntries(
      ([['Leader', total.leaders], ['Base', total.bases], ['Unit', total.units], ['Upgrade', total.upgrades], ['Event', total.events]] as const)
        .filter(([, n]) => n > 0),
    )
    expect(counts).toEqual(expected)
  })

  it.each(SET_CODES)('%s holds only its own set, already in fixture shape', code => {
    const pool = poolFor([code])
    expect(new Set(pool.map(c => c.Set))).toEqual(new Set([code]))
    expect(JSON.stringify(toFixture(pool))).toBe(JSON.stringify(pool))
  })

  /**
   * The deck generator reads a fixture's cost directly, and the engine's `cardDataCorrections` never
   * reaches it, so a wrong printed cost skews every curve built around the card. The card source once
   * shipped Moff Gideon at 8.
   */
  it('holds every HMW card once, all 272 of them, since the set prints no card twice', () => {
    const hmw = poolFor(['HMW'])
    expect(hmw).toHaveLength(272)
    expect(new Set(hmw.map(c => c.Number)).size).toBe(272)
  })

  it('holds Moff Gideon (ASH_097) at his printed cost of 3', () => {
    const gideon = poolFor(['ASH']).find(c => c.Number === '097')!
    expect(gideon.Name).toBe('Moff Gideon')
    expect(gideon.Cost).toBe('3')
  })

  it('names each fixture after its set code', () => {
    expect(fixtureFile('ASH')).toBe('src/test/fixtures/ashSet.json')
    expect(fixtureFile('TS26')).toBe('src/test/fixtures/ts26Set.json')
  })

  it('has a known set for every fixture on disk, so a fetched set cannot sit unused', () => {
    const onDisk = readdirSync(join(process.cwd(), 'src/test/fixtures')).filter(f => f.endsWith('Set.json'))
    const known = SET_CODES.map(code => fixtureFile(code).split('/').pop())
    expect(onDisk.sort()).toEqual(known.sort())
  })
})

describe('poolFor', () => {
  it('is the bundled ASH pool for ASH', () => {
    expect(poolFor(['ASH'])).toEqual(ASH)
  })

  it('joins several sets in canonical order', () => {
    const pool = poolFor(['LAW', 'ASH'])
    expect(pool).toHaveLength(poolFor(['ASH']).length + poolFor(['LAW']).length)
    expect(pool[0].Set).toBe('ASH')
    expect(pool[pool.length - 1].Set).toBe('LAW')
  })
})

/**
 * Filling a set from api.swuapi.com while swu-db lags. Three real IC27 rows as swuapi serves them
 * (trimmed to the fields read), and what the fixture must hold for each: swu-db's shape, spelling and
 * notation, so the engine and triage read a filled card exactly as they would read it from swu-db.
 */
describe('filling a fixture from swuapi.com', () => {
  const swuapi = (over: Partial<SwuApiCard> = {}): SwuApiCard => ({
    collector_number: 'IC27_013', name: 'Nute Gunray', subtitle: 'Ring Ring, Space Calling', type: 'Unit',
    aspects: ['Vigilance', 'Villainy'], traits: ['Separatist', 'Official'], arena: 'Ground', cost: 1, power: 1, hp: 4,
    upgrade_power: null, upgrade_hp: null,
    front_text: 'Each other friendly Separatist unit gains Restore 1. (When it attacks, heal 1 damage from your base.)',
    back_text: null, double_sided: false, rarity: 'Rare', unique_flag: true, keywords: ['Restore'], variant_type: 'Standard',
    front_image_url: 'https://cdn.starwarsunlimited.com//card_IC_27010013_EN_Nute_Gunray_b5b2b5de78.png',
    ...over,
  })
  const academyTraining = swuapi({
    collector_number: 'IC27_093', name: 'Academy Training', subtitle: null, type: 'Upgrade', aspects: ['Command'],
    traits: ['Learned'], arena: null, cost: 2, power: null, hp: null, upgrade_power: 2, upgrade_hp: 2, front_text: null,
    rarity: 'Common', unique_flag: false, keywords: [],
  })
  const kyloRen = swuapi({
    collector_number: 'IC27_003', name: 'Kylo Ren', subtitle: 'Supreme Leader', type: 'Leader', aspects: ['Command', 'Villainy'],
    traits: ['Force', 'First Order', 'Official'], cost: 5, power: 5, hp: 3,
    front_text: 'Action [Exhaust, discard a card from your hand]: Give an Experience token to a unit.',
    back_text: 'When Deployed: You may return a unit from your discard pile to your hand.', double_sided: true,
    rarity: 'Common', keywords: [],
  })

  it('writes a unit as swu-db does: padded number, text fields, traits in capitals', () => {
    expect(JSON.stringify(toFixture([fromSwuApiRow(swuapi())]))).toBe(JSON.stringify([{
      Set: 'IC27', Number: '013', Name: 'Nute Gunray', Subtitle: 'Ring Ring, Space Calling', Type: 'Unit',
      Cost: '1', Power: '1', HP: '4', Arenas: ['Ground'], Aspects: ['Vigilance', 'Villainy'], Traits: ['SEPARATIST', 'OFFICIAL'],
      Keywords: ['Restore'], Unique: true,
      FrontText: 'Each other friendly Separatist unit gains Restore 1. (When it attacks, heal 1 damage from your base.)',
      Rarity: 'Rare',
    }]))
  })

  it("takes an upgrade's printed modifiers from swuapi's upgrade fields", () => {
    const [card] = toFixture([fromSwuApiRow(academyTraining)])
    expect(card).toMatchObject({ Type: 'Upgrade', Cost: '2', Power: '2', HP: '2', Traits: ['LEARNED'] })
    expect('Keywords' in card).toBe(false)
    expect('FrontText' in card).toBe(false)
  })

  it("keeps a leader's back text and multi-word traits", () => {
    const [card] = toFixture([fromSwuApiRow(kyloRen)])
    expect(card.BackText).toBe('When Deployed: You may return a unit from your discard pile to your hand.')
    expect(card.Traits).toEqual(['FORCE', 'FIRST ORDER', 'OFFICIAL'])
  })

  it("writes a resource cost in swu-db's C=N notation, which the Smuggle and Piloting parser reads", () => {
    const card = fromSwuApiRow(swuapi({
      front_text: 'Action [1 resource, Exhaust, defeat a friendly unit]: Draw a card.',
      back_text: 'Smuggle [4 resources, Cunning]',
    }))
    expect(card.FrontText).toBe('Action [C=1, Exhaust, defeat a friendly unit]: Draw a card.')
    expect(card.BackText).toBe('Smuggle [C=4, Cunning]')
  })

  it('reads only Standard printings as the Normal row, and tokens as tokens', () => {
    const rows = [
      fromSwuApiRow(swuapi()),
      fromSwuApiRow(swuapi({ variant_type: 'Hyperspace', collector_number: 'IC27_213' })),
      fromSwuApiRow(swuapi({ collector_number: 'IC27_T002', name: 'Shield', subtitle: null, type: 'Token Upgrade' })),
    ]
    expect(toFixture(rows).map(c => c.Number)).toEqual(['013'])
  })

  describe('fillFromSwuApi', () => {
    /** swu-db's own row for a card both sources serve, which disagrees with swuapi's (IC27's Rex does). */
    const swuDbRex = { Set: 'IC27', Number: '041', Name: 'Captain Rex', Subtitle: 'Unwavering Belief', Type: 'Unit', VariantType: 'Normal' }
    const swuApiRex = fromSwuApiRow(swuapi({ collector_number: 'IC27_041', name: 'Captain Rex', subtitle: 'Staunch Advocate' }))

    it("keeps every swu-db row as it is and adds only the cards swu-db does not serve", () => {
      const filled = fillFromSwuApi([swuDbRex], [swuApiRex, fromSwuApiRow(swuapi())])
      expect(filled).toEqual([swuDbRex, fromSwuApiRow(swuapi())])
    })

    it('matches a card by its set and number, whichever source pads it', () => {
      const unpadded = { ...swuDbRex, Number: '41' }
      expect(fillFromSwuApi([unpadded], [swuApiRex])).toEqual([unpadded])
    })

    it('adds nothing for a set swu-db serves in full', () => {
      expect(fillFromSwuApi([swuDbRex], [swuApiRex])).toEqual([swuDbRex])
    })
  })

  describe('fetchSwuApiSet', () => {
    afterEach(() => { vi.unstubAllGlobals() })

    /** swuapi's cursor paging repeats and drops rows (619 rows against a total of 568), so the set is paged by offset. */
    it('pages by offset until the stated total, and maps each row', async () => {
      const page = (offset: number, cards: SwuApiCard[]) => ({ cards, pagination: { limit: 2, offset, total: 3, next_cursor: 'ignored' } })
      const urls: string[] = []
      vi.stubGlobal('fetch', vi.fn((url: string) => {
        urls.push(url)
        const offset = Number(new URL(url).searchParams.get('offset'))
        const body = offset === 0 ? page(0, [swuapi(), academyTraining]) : page(2, [kyloRen])
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
      }))
      const cards = await fetchSwuApiSet('ic27', 2)
      expect(cards.map(c => c.Number)).toEqual(['013', '093', '003'])
      expect(urls.every(u => u.includes('set=IC27') && u.includes('variant=all') && !u.includes('after='))).toBe(true)
      expect(urls).toHaveLength(2)
    })

    it('fails naming the set when swuapi answers with an error', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })))
      await expect(fetchSwuApiSet('IC27')).rejects.toThrow('IC27 could not be fetched from swuapi.com (503)')
    })
  })
})
