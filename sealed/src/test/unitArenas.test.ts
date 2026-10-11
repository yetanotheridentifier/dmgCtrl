import { describe, it, expect } from 'vitest'
import { loadReport, replayUpTo } from './helpers/replayReport'
import { normaliseCard } from '../engine/cardDb'
import { cardId } from '../data/cards'
import { SET_CODES, poolFor } from '../bench/setPools'
import type { Arena } from '../engine/types'

/**
 * **A unit is played into the arena its card prints, whatever the source data says.**
 *
 * The arena comes straight from the source's `Arenas` field, and the source gets a few wrong: a
 * starfighter shipped as Ground deploys beside the infantry, is attacked by them and cannot reach the
 * ships it was printed to fight. `cardDataCorrections.ts` holds the fixes, and the checks below are
 * what finds the next one.
 */

const ALL_CARDS = poolFor(SET_CODES)
const UNITS = ALL_CARDS.filter(c => c.Type === 'Unit')
const traitsOf = (c: { Traits?: string[] }) => (c.Traits ?? []).map(t => t.trim().toUpperCase())
const idOf = (c: { Set: string; Number: string }) => cardId(c.Set, c.Number)

/** The ids of the units holding any of `traits` that the engine does not put in `arena`. */
function outside(arena: Arena, traits: string[], printedElsewhere: string[] = []): string[] {
  return UNITS
    .filter(c => traitsOf(c).some(t => traits.includes(t)))
    .filter(c => normaliseCard(c).arena !== arena)
    .map(idOf)
    .filter(id => !printedElsewhere.includes(id))
}

describe('the reported game: Kimogila Heavy Fighter played from hand', () => {
  /** Move 34 is the play; the report was filed with the fighter sitting in the ground arena. */
  it('enters the space arena', () => {
    const afterPlay = replayUpTo(loadReport('kimogilaArena'), 35, ALL_CARDS)
    const fighter = afterPlay.players.player.units.find(u => u.cardId === 'JTL_222')
    expect(fighter?.arena).toBe('space')
  })
})

describe('corrected arenas', () => {
  const arenaOf = (id: string) => normaliseCard(ALL_CARDS.find(c => idOf(c) === id)!).arena

  it('Kimogila Heavy Fighter (JTL_222) is a space unit (the source ships Ground)', () => {
    expect(arenaOf('JTL_222')).toBe('space')
  })

  it('41st Elite Corps (TWI_045) is a ground unit (the source ships Space)', () => {
    expect(arenaOf('TWI_045')).toBe('ground')
  })
})

/**
 * Traits that settle the arena across every bundled set. Each rule names the cards printed against
 * it, so a new exception is a decision made against the printed card and not a silent pass.
 */
describe('every bundled unit sits in the arena its traits print', () => {
  it('a Fighter or a Capital Ship is a space unit', () => {
    // Skyway Cloud Car is a Fighter printed in the ground arena.
    expect(outside('space', ['FIGHTER', 'CAPITAL SHIP'], ['JTL_220'])).toEqual([])
  })

  it('a Trooper, Walker, Tank or Speeder is a ground unit', () => {
    expect(outside('ground', ['TROOPER', 'WALKER', 'TANK', 'SPEEDER'])).toEqual([])
  })

  it('a space unit is a Vehicle or a Creature', () => {
    // Leia Organa (LOF) is printed in the space arena with neither trait.
    const printedInSpace = ['LOF_098']
    const afloat = UNITS
      .filter(c => normaliseCard(c).arena === 'space')
      .filter(c => !traitsOf(c).some(t => t === 'VEHICLE' || t === 'CREATURE'))
      .map(idOf)
      .filter(id => !printedInSpace.includes(id))
    expect(afloat).toEqual([])
  })

  it('every unit has an arena', () => {
    expect(UNITS.filter(c => normaliseCard(c).arena === undefined).map(idOf)).toEqual([])
  })
})
