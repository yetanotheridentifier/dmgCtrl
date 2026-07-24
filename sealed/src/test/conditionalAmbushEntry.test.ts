import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import '../engine/cardDefinitions' // side-effect: registers every implemented card
import { state, player, unit, card, CARDS, ready } from './helpers/engineFixtures'

/**
 * AT-ST Raider (ASH_098, #412): "While you control another non-unique unit, this unit gains Ambush."
 * Ambush must enter the unit READY so it can immediately attack, but `enterUnit` decided that at
 * construction time from a STATIC keyword check (`hasKeyword`, the card's printed keywords only),
 * before the new unit even exists in play. A CONDITIONAL Ambush grant needs the unit in play to
 * evaluate (`controlsAnother` looks the unit up by instance id), so it is invisible to that early
 * check and the unit was built exhausted regardless. The later LIVE check
 * (`unitHasKeyword(next, inPlay(), 'Ambush')`) correctly detects the conditional grant and raises the
 * ambush choice, but nothing ever un-exhausted the unit, so the choice existed with no way to answer
 * it (the ambush legal-move generator requires a ready unit, #390's ambushExhausted fix). Found via
 * the filed bug report (#412), replayed with the harness.
 */
describe('conditional Ambush enters the unit ready (AT-ST Raider, #412)', () => {
  const RAIDER = card({ id: 'ASH_098', name: 'AT-ST Raider', type: 'unit', arena: 'ground', cost: 4, power: 4, hp: 5, unique: false })
  const GRUNT = card({ id: 'GRUNT', name: 'Grunt', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1 })
  const ENEMY = card({ id: 'ENEMY', name: 'Enemy', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 3 })

  const board = () => state({
    phase: 'action',
    activePlayer: 'player',
    cards: { ...CARDS, ASH_098: RAIDER, GRUNT, ENEMY },
    players: {
      // Controls another non-unique unit (GRUNT), so the raider's condition is met.
      player: player({ hand: ['ASH_098'], resources: ready(5), units: [unit('g', 'GRUNT')], deck: ['GRUNT'] }),
      opponent: player({ units: [unit('e', 'ENEMY')], deck: ['ENEMY'] }),
    },
  })

  it('enters play ready, not exhausted', () => {
    const played = resolve(board(), { type: 'playUnit', handIndex: 0 })
    const raider = played.players.player.units.find(u => u.cardId === 'ASH_098')!
    expect(raider.exhausted).toBe(false)
  })

  it('raises an ambush choice the player can actually answer with an attack', () => {
    const played = resolve(board(), { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.[0].kind).toBe('ambush')
    const moves = legalMoves(played)
    expect(moves.some(m => m.type === 'attack')).toBe(true)
  })

  it('still enters exhausted when the condition is unmet (no other non-unique unit)', () => {
    const noGrunt = state({
      phase: 'action',
      activePlayer: 'player',
      cards: { ...CARDS, ASH_098: RAIDER, ENEMY },
      players: {
        player: player({ hand: ['ASH_098'], resources: ready(5), units: [], deck: ['GRUNT'] }),
        opponent: player({ units: [unit('e', 'ENEMY')], deck: ['ENEMY'] }),
      },
    })
    const played = resolve(noGrunt, { type: 'playUnit', handIndex: 0 })
    const raider = played.players.player.units.find(u => u.cardId === 'ASH_098')!
    expect(raider.exhausted).toBe(true)
    expect(played.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('the fix generalises: Mandalorian Flagship (ASH_113, same conditional-Ambush shape)', () => {
  const FLAGSHIP = card({ id: 'ASH_113', name: 'Mandalorian Flagship', type: 'unit', arena: 'space', cost: 5, power: 4, hp: 8, unique: true })
  const ENEMY = card({ id: 'ENEMY_S', name: 'Enemy Ship', type: 'unit', arena: 'space', cost: 1, power: 1, hp: 3 })

  it('enters ready when the controller controls a leader unit', () => {
    const board = state({
      phase: 'action',
      activePlayer: 'player',
      cards: { ...CARDS, ASH_113: FLAGSHIP, ENEMY_S: ENEMY },
      players: {
        player: player({ hand: ['ASH_113'], resources: ready(5), units: [unit('l', 'TST_L', { isLeader: true })], deck: ['ENEMY_S'] }),
        opponent: player({ units: [unit('e', 'ENEMY_S', { arena: 'space' })], deck: ['ENEMY_S'] }),
      },
    })
    const played = resolve(board, { type: 'playUnit', handIndex: 0 })
    const flagship = played.players.player.units.find(u => u.cardId === 'ASH_113')!
    expect(flagship.exhausted).toBe(false)
    expect(legalMoves(played).some(m => m.type === 'attack')).toBe(true)
  })
})
