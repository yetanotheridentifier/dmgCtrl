import { describe, it, expect } from 'vitest'
import { defeatUnit } from '../engine/combat'
import { captureUnit } from '../engine/effects'
import { registerCard } from '../engine/abilities'
import { resolve } from '../engine/resolve'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * The Bounty primitive (CR 13): "Bounty - <reward>. (When this unit is defeated or captured, your
 * opponent collects its bounty.)" Collected under the unit's own OPPONENT, at both points a Bountied
 * unit can leave play that way, always optional, each Bounty source independent.
 */
let calls = 0
registerCard('TST_BOUNTY', {
  abilities: [{ trigger: 'bounty', description: 'Draw a card (test).', effect: (s, ctx) => {
    calls++
    return { ...s, players: { ...s.players, [ctx.owner]: { ...s.players[ctx.owner], hand: [...s.players[ctx.owner].hand, 'DRAWN'] } } }
  } }],
})
registerCard('TST_BOUNTY2', {
  abilities: [{ trigger: 'bounty', description: 'Draw a card (test 2).', effect: (s, ctx) =>
    ({ ...s, players: { ...s.players, [ctx.owner]: { ...s.players[ctx.owner], hand: [...s.players[ctx.owner].hand, 'DRAWN2'] } } }) }],
})

const F = {
  ...CARDS,
  TST_BOUNTY: card({ id: 'TST_BOUNTY', name: 'Bountied Target', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2 }),
  TST_BOUNTY2: card({ id: 'TST_BOUNTY2', name: 'Bounty Upgrade', type: 'upgrade', cost: 1 }),
}
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const choice = (s: GameState) => s.pendingChoices?.[0]
const accept = (s: GameState) => resolve(s, { type: 'acceptChoice', choiceId: choice(s)!.id })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s)!.id })

describe('Bounty (CR 13)', () => {
  it('defeating a Bounty unit offers its OPPONENT a "collect this Bounty?" choice, not its own controller', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('tgt', 'TST_BOUNTY')] }),
      opponent: rich(),
    } })
    const defeated = defeatUnit(s, 'tgt')
    expect(choice(defeated)?.kind).toBe('mayCollectBounty')
    expect(choice(defeated)?.controller).toBe('opponent')
  })

  it('accepting runs the reward for the collecting opponent', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('tgt', 'TST_BOUNTY')] }),
      opponent: rich(),
    } })
    const done = accept(defeatUnit(s, 'tgt'))
    expect(done.players.opponent.hand).toContain('DRAWN')
  })

  it('collecting is optional: declining runs nothing', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('tgt', 'TST_BOUNTY')] }),
      opponent: rich(),
    } })
    const declined = skip(defeatUnit(s, 'tgt'))
    expect(declined.players.opponent.hand).not.toContain('DRAWN')
  })

  it('capturing a Bounty unit ALSO offers its opponent the collection (CR 13: defeated OR captured)', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('cap', 'TST_U1') /* vanilla capturer, capturing itself needs no ability */] }),
      opponent: rich({ units: [unit('tgt', 'TST_BOUNTY')] }),
    } })
    const captured = captureUnit(s, 'cap', 'tgt')
    expect(choice(captured)?.kind).toBe('mayCollectBounty')
    expect(choice(captured)?.controller).toBe('player')
    const done = accept(captured)
    expect(done.players.player.hand).toContain('DRAWN')
  })

  it('an upgrade carrying its own Bounty ability fires independently of the host\'s printed one', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('tgt', 'TST_BOUNTY', { upgrades: [{ cardId: 'TST_BOUNTY2', owner: 'player' }] })] }),
      opponent: rich(),
    } })
    let next = defeatUnit(s, 'tgt')
    // Two Bounty sources on the one unit are owed to the same controller at once, so CR 7.6.9 asks
    // which resolves first, same as any other batch of one player's abilities.
    expect(choice(next)?.kind).toBe('chooseNextTrigger')
    next = accept(next) // order: first candidate
    next = accept(next) // collect the first Bounty source
    next = accept(next) // collect the second Bounty source
    expect(next.players.opponent.hand).toContain('DRAWN')
    expect(next.players.opponent.hand).toContain('DRAWN2')
  })
})
