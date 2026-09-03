import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import { loadReport, replay } from './helpers/replayReport'
import { buildCardDb } from '../engine/cardDb'
import { unitHasKeyword } from '../engine/keywords'
import '../engine/cardDefinitions'
import type { SwuCard } from '../data/cards'

/**
 * **A keyword a card only GIVES to other units is not a keyword that card has.**
 *
 * The source data's `Keywords` array is a union over everything the card's text mentions, so a card
 * that hands a keyword out ships it as its own. `cardDataCorrections.ts` already strips the
 * *conditional* cases ("while X, this unit gains Y"); the granting ones were missed.
 *
 * Grand Admiral Sloane (ASH_007) reads "Overwhelm / Each **other** friendly unit gains Overwhelm and
 * Sentinel", and deployed as a Sentinel herself, which forces enemies in her arena to attack her.
 * The aura was never the problem: it excludes its own source, and the synthetic fixture in
 * `auras.test.ts` gives her no printed keywords, so nothing there could see it.
 *
 * The Twins (ASH_127) is the same defect, unreported: "You may give **another** friendly unit
 * Sentinel for this phase" and no keyword of its own.
 */

const CARDS = buildCardDb(ashSet as unknown as SwuCard[])
const keywordNames = (id: string) => (CARDS[id]?.keywords ?? []).map(k => k.name)

describe('keywords a card only grants to other units', () => {
  it('leaves Sloane (007) with her printed Overwhelm and no Sentinel', () => {
    expect(keywordNames('ASH_007')).toEqual(['Overwhelm'])
  })

  it('leaves The Twins (127) with no keywords at all', () => {
    expect(keywordNames('ASH_127')).toEqual([])
  })
})

/**
 * The reported game (#550), replayed to its last move: both leaders deploy, and Sloane's aura is
 * live over a board that already holds two other friendly units.
 */
describe('the reported game where a deployed Sloane was a Sentinel', () => {
  const end = replay(loadReport('sloaneSelfSentinel'))
  const units = end.players.player.units
  const sloane = units.find(u => u.isLeader)!
  const others = units.filter(u => !u.isLeader)

  it('deploys her as a unit alongside the units she buffs', () => {
    expect(sloane.cardId).toBe('ASH_007')
    expect(others.length).toBeGreaterThan(0)
  })

  it('does not make her a Sentinel', () => {
    expect(unitHasKeyword(end, sloane, 'Sentinel')).toBe(false)
  })

  it('keeps the Overwhelm printed on her deployed side', () => {
    expect(unitHasKeyword(end, sloane, 'Overwhelm')).toBe(true)
  })

  it('still gives every other friendly unit both keywords', () => {
    for (const u of others) {
      expect(unitHasKeyword(end, u, 'Sentinel'), u.cardId).toBe(true)
      expect(unitHasKeyword(end, u, 'Overwhelm'), u.cardId).toBe(true)
    }
  })
})
