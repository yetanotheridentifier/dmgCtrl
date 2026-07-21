import { describe, it, expect } from 'vitest'
import { describeAction, describeActionParts, partsText } from '../utils/describeAction'
import type { DescribePart } from '../utils/describeAction'
import type { Action } from '../engine/actions'
import { state, player, card, CARDS, ready, unit } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

const cardRefs = (parts: DescribePart[]) => parts.filter(p => typeof p !== 'string')

function board(): GameState {
  return state({
    cards: {
      ...CARDS,
      HAND_U: card({ id: 'HAND_U', name: 'Hand Unit', type: 'unit', cost: 1 }),
      MINE: card({ id: 'MINE', name: 'My Unit', type: 'unit', power: 2, hp: 3 }),
      THEIRS: card({ id: 'THEIRS', name: 'Their Unit', type: 'unit', power: 2, hp: 3 }),
    },
    players: {
      player: player({
        hand: ['HAND_U'],
        resources: ready(5),
        units: [unit('u1', 'MINE')],
      }),
      opponent: player({
        units: [unit('u2', 'THEIRS')],
      }),
    },
  })
}

/**
 * The rendered log and the action prompt need to know WHICH card each name refers to, so the
 * describe helpers emit tokens rather than a flat string. The string form is the join of those
 * tokens — that invariant is what lets un-converted branches fall back to plain text safely.
 */
describe('describeActionParts', () => {
  const s = board()
  const actions: Action[] = [
    { type: 'playUnit', handIndex: 0 },
    { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'u2' } },
    { type: 'attack', attackerId: 'u1', target: { kind: 'base' } },
    { type: 'deployLeader' },
    { type: 'resourceCard', handIndex: 0 },
    { type: 'pass' },
    { type: 'takeInitiative' },
    { type: 'mulligan' },
    { type: 'keepHand' },
    { type: 'skipResource' },
  ]

  it('joins back to exactly the string form, for every action', () => {
    for (const action of actions) {
      expect(partsText(describeActionParts(s, 'player', action)), action.type).toBe(describeAction(s, 'player', action))
    }
  })

  it('tags a played card with its id and controller', () => {
    const refs = cardRefs(describeActionParts(s, 'player', { type: 'playUnit', handIndex: 0 }))
    expect(refs).toEqual([{ cardId: 'HAND_U', controller: 'player', text: 'Hand Unit' }])
  })

  it('tags attacker and defender with the player who controls each', () => {
    const refs = cardRefs(describeActionParts(s, 'player', { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'u2' } }))
    expect(refs).toEqual([
      { cardId: 'THEIRS', controller: 'opponent', text: 'Their Unit' },
      { cardId: 'MINE', controller: 'player', text: 'My Unit' },
    ])
  })

  it('emits no card reference for an action that names no card', () => {
    expect(cardRefs(describeActionParts(s, 'player', { type: 'pass' }))).toEqual([])
  })

  /**
   * Hidden information (CR 1.17): an opponent's resource pick is private. A card token would
   * leak the identity through the hover zoom even though the text says "a card".
   */
  it('never tags a card in a redacted entry', () => {
    for (const action of [{ type: 'resourceCard' as const, handIndex: 0 }, { type: 'setupResource' as const, handIndex: 0 }]) {
      const parts = describeActionParts(s, 'player', action, { redact: true })
      expect(partsText(parts)).toBe('Resource a card')
      expect(cardRefs(parts)).toEqual([])
    }
  })
})
