import { describe, it, expect } from 'vitest'
import { describeAction } from '../utils/describeAction'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { PendingChoice } from '../engine/types'

/** The action-menu labels for pending "may…" choices, shown as buttons. */
describe('describeAction — pending choice labels', () => {
  const withChoice = (choice: PendingChoice, extraCards = {}) =>
    state({
      cards: { ...CARDS, ...extraCards },
      players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() },
      pendingChoices: [choice],
    })

  it('labels pay-or-exhaust accept and decline', () => {
    const s = withChoice({ kind: 'payOrExhaust', id: 'u1', controller: 'player', unitId: 'u1', cost: 3 })
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'u1' })).toBe('Pay 3')
    expect(describeAction(s, 'player', { type: 'skipTrigger', choiceId: 'u1' })).toBe("Don't pay (exhaust)")
  })

  it('labels may-play-top-free for a unit', () => {
    const s = withChoice(
      { kind: 'mayPlayTopFree', id: 'x', controller: 'player', unitId: 'x', cardId: 'TOPU' },
      { TOPU: card({ id: 'TOPU', name: 'Scout', type: 'unit', arena: 'ground', cost: 2 }) },
    )
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x' })).toBe('Play Scout free')
    expect(describeAction(s, 'player', { type: 'skipTrigger', choiceId: 'x' })).toBe("Don't play")
  })

  it('names the target when playing an upgrade free', () => {
    const s = withChoice(
      { kind: 'mayPlayTopFree', id: 'x', controller: 'player', unitId: 'x', cardId: 'TOPUP' },
      { TOPUP: card({ id: 'TOPUP', name: 'Blaster', type: 'upgrade', cost: 1 }) },
    )
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x', targetInstanceId: 'u1' })).toBe('Play Blaster free on TST_U1')
  })

  it('labels the DDC Defender damage-and-exhaust choice', () => {
    const s = withChoice({ kind: 'mayDamageExhaust', id: 'x', controller: 'player', unitId: 'u1', arena: 'ground' })
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x', targetInstanceId: 'u1' })).toBe('Deal 1 & exhaust TST_U1')
    expect(describeAction(s, 'player', { type: 'skipTrigger', choiceId: 'x' })).toBe('Decline')
  })
})
