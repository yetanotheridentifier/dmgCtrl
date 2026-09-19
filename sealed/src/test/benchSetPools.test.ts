import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { SET_PROGRESS } from '../data/implementedCards'
import {
  SEALED_MIN_CARDS, SEALED_SET_CODES, SET_CODES, fixtureFile, poolFor, resolveSealedSets, resolveSetCodes, toFixture,
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
    expect(SET_CODES).toHaveLength(11)
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
 * fewer than 200 cards is not designed for that: IBH's 51 cards built a coverage deck of 3. The rule is
 * a card count rather than a list, so a small product released later is left out without anyone
 * remembering to add it.
 */
describe('sealed sets', () => {
  it('leaves out every set below the minimum, and only those', () => {
    for (const code of SET_CODES) {
      expect(SEALED_SET_CODES.includes(code), code).toBe(poolFor([code]).length >= SEALED_MIN_CARDS)
    }
  })

  it('keeps the nine booster sets and leaves out TS26 and IBH', () => {
    expect(SEALED_MIN_CARDS).toBe(200)
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
    ]
    expect(toFixture(rows).map(c => c.Number)).toEqual(['010'])
  })

  it('collapses one card printed at several numbers in a set onto its lowest number', () => {
    // IBH prints single cards at up to three collector numbers: 104 slots, 51 cards.
    const rows = [apiRow({ Set: 'IBH', Number: '89' }), apiRow({ Set: 'IBH', Number: '70' }), apiRow({ Set: 'IBH', Number: '103' })]
    expect(toFixture(rows).map(c => c.Number)).toEqual(['70'])
  })

  it('keeps a card printed in two sets as two cards', () => {
    // Abilities register per id, so a cross-set reprint belongs to each set's own pool.
    expect(toFixture([apiRow({ Set: 'LAW' }), apiRow({ Set: 'SEC' })]).map(c => c.Set)).toEqual(['LAW', 'SEC'])
  })
})

describe('the bundled fixtures', () => {
  it.each(SET_PROGRESS.map(s => [s.code, s.total] as const))('%s matches the printed card counts', (code, total) => {
    const counts: Record<string, number> = {}
    for (const c of poolFor([code])) counts[c.Type] = (counts[c.Type] ?? 0) + 1
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
