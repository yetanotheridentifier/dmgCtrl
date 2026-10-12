import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ashSet from './fixtures/ashSet.json'
import ibhSet from './fixtures/ibhSet.json'
import type { SwuCard } from '../data/cards'
import { BUNDLED_SET_CODES, bundledCard, bundledSetCards } from '../data/bundledSets'
import { printedCardCount } from '../data/implementedCards'
import { SET_CODES } from '../bench/setPools'
import { normaliseCard } from '../engine/cardDb'
import { CARD_DATA_CORRECTIONS } from '../engine/cardDataCorrections'
import { UPGRADE_STAT_OVERRIDES } from '../engine/upgradeStatOverrides'

/**
 * The set snapshots the app ships: the same files the bench and the tests read as fixtures, loaded a
 * set at a time. They are what lets a first visit play with the card API unreachable, so these tests
 * read them with no cache and no network at all.
 */

const ASH = ashSet as unknown as SwuCard[]
const ART = 'https://cdn.swu-db.com/images/cards'

describe('the bundled sets', () => {
  it('cover every set the setup panel lists', () => {
    expect([...BUNDLED_SET_CODES].sort()).toEqual([...SET_CODES].sort())
  })

  it('hold every printed card of each set, so a generator never has to fetch one', async () => {
    for (const code of SET_CODES) {
      expect((await bundledSetCards(code)).length, code).toBe(printedCardCount(code))
    }
  })

  it('serve the fixture rows as they are, whatever case the set is named in', async () => {
    const cards = await bundledSetCards('ash')
    expect(cards).toHaveLength(ASH.length)
    expect(cards.map(c => c.Number)).toEqual(ASH.map(c => c.Number))
    expect(cards[0]).toMatchObject(ASH[0])
  })

  it('have nothing for a set that is not bundled', async () => {
    expect(await bundledSetCards('ZZZ')).toEqual([])
    expect(await bundledCard('ZZZ', '001')).toBeUndefined()
  })
})

describe('a bundled card', () => {
  it('is found by set and number', async () => {
    const vader = await bundledCard('sor', '010')
    expect(vader).toMatchObject({ Set: 'SOR', Number: '010', Name: 'Darth Vader', Type: 'Leader' })
  })

  it('is undefined for a number the set does not print as a Normal card', async () => {
    expect(await bundledCard('SOR', '999')).toBeUndefined()
    expect(await bundledCard('SOR', 'T01')).toBeUndefined()
  })

  /**
   * Deck lists pad every number and a few sets are filed unpadded (IBH and TS26), so either spelling
   * names the card. It comes back under the number its set uses, which is the id the engine knows.
   */
  it('answers a padded or an unpadded spelling of its number', async () => {
    const unpadded = (ibhSet as unknown as SwuCard[]).find(c => c.Number.length < 3)!
    const padded = unpadded.Number.padStart(3, '0')
    expect(padded).not.toBe(unpadded.Number)
    expect(await bundledCard('IBH', padded)).toMatchObject({ Name: unpadded.Name, Number: unpadded.Number })
    expect(await bundledCard('IBH', unpadded.Number)).toMatchObject({ Name: unpadded.Name, Number: unpadded.Number })
    expect(await bundledCard('SOR', '10')).toMatchObject({ Name: 'Darth Vader', Number: '010' })
  })

  /**
   * The snapshots carry no art fields. The card API files every card's art under its set and number,
   * and a leader's back under the same with `-b` (checked over all 2,579 rows of the eleven listings),
   * so the art is named here and still streams from the proxy.
   */
  it('names its art, and a leader its back as well', async () => {
    for (const card of await bundledSetCards('ASH')) {
      expect(card.FrontArt, card.Number).toBe(`${ART}/ASH/${card.Number}.png`)
      expect(card.BackArt, card.Number).toBe(card.Type === 'Leader' ? `${ART}/ASH/${card.Number}-b.png` : undefined)
    }
  })
})

/**
 * Corrections are applied by `normaliseCard`, keyed by card id, whichever source served the card. A
 * bundled card reaches the engine the same way, so the snapshot never has to be right about a value
 * the corrections table already overrides.
 */
describe('a bundled card, normalised', () => {
  it('carries every correction registered for a bundled set', async () => {
    const corrected = Object.keys(CARD_DATA_CORRECTIONS).filter(id => SET_CODES.includes(id.split('_')[0]))
    expect(corrected.length).toBeGreaterThan(10)
    for (const id of corrected) {
      const [set, number] = id.split('_')
      const card = await bundledCard(set, number)
      expect(card, id).toBeDefined()
      expect(normaliseCard(card!), id).toMatchObject(CARD_DATA_CORRECTIONS[id])
    }
  })

  it('carries the printed modifier of an upgrade the snapshot has no stats for', async () => {
    const blade = await bundledCard('ASH', '055')
    expect(blade!.Power).toBeUndefined()
    expect(normaliseCard(blade!)).toMatchObject({ power: UPGRADE_STAT_OVERRIDES.ASH_055.power, hp: UPGRADE_STAT_OVERRIDES.ASH_055.hp })
  })

  it('keeps its art through normalisation', async () => {
    const vader = normaliseCard((await bundledCard('SOR', '010'))!)
    expect(vader.frontArt).toBe(`${ART}/SOR/010.png`)
    expect(vader.backArt).toBe(`${ART}/SOR/010-b.png`)
  })
})

/**
 * A snapshot is tens of kilobytes and there are eleven of them. Imported statically, every one would
 * sit in the script the page needs before it can draw anything; loaded with `import()`, each is a
 * file of its own, fetched when its set is first asked for. Nothing the app ships may import one
 * statically: the bench and the tests may, since neither is in the deployed bundle.
 */
describe('the shipped modules', () => {
  const SRC = join(__dirname, '..')
  const shipped = (dir: string): string[] => readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return ['test', 'bench'].includes(path) ? [] : shipped(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })

  it('never import a set snapshot statically', () => {
    const files = shipped('.')
    expect(files.length).toBeGreaterThan(50)
    const offenders = files.filter(file => /^import\s[^\n]*Set\.json['"]/m.test(readFileSync(join(SRC, file), 'utf8')))
    expect(offenders).toEqual([])
  })
})
